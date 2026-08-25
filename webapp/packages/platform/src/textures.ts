/**
 * Loading content images for the board.
 *
 * Content declares an image by path and, for tokens, a rectangle within a
 * sprite sheet — `x`, `y`, `width` and `height` in `TokenData`. Dozens of
 * tokens share one sheet, so cropping and caching are the whole job.
 *
 * `ContentData.FileToTexture` in the C# reads a file, decodes it and builds a
 * Unity `Texture2D` on the main thread every time it is asked. Here decoding
 * happens off the main thread through `createImageBitmap`, and every result is
 * cached, because a scenario asks for the same tile art on every redraw.
 */

/** A rectangle within a sprite sheet. */
export interface Crop {
  x: number
  y: number
  width: number
  height: number
}

/** Reads the bytes behind a resolved content path. */
export type TextureReader = (path: string) => Promise<Uint8Array | null>

/** What the browser gives back; `ImageBitmap` in practice. */
export type Texture = ImageBitmap

export interface TextureCacheOptions {
  read: TextureReader
  /**
   * `createImageBitmap`, injected so the cache can be tested without a
   * browser. The crop arguments are the same ones the platform takes.
   */
  createBitmap?: (blob: Blob, crop?: Crop) => Promise<Texture>
  /**
   * How much decoded image data to keep, in bytes.
   *
   * Counting images rather than bytes is not a bound at all: a Mansions tile
   * is 2048x2048, which is 17 MB decoded, so a limit of 128 images permits
   * over two gigabytes and the browser tab simply dies. Decoded size is what
   * costs memory, so decoded size is what is capped.
   */
  limit?: number
}

/** 192 MB of decoded images: roughly a screen of tiles with room to spare. */
const DEFAULT_LIMIT = 192 * 1024 * 1024

/** RGBA, which is what a decoded bitmap costs however it was compressed. */
function bytesOf(bitmap: Texture): number {
  return bitmap.width * bitmap.height * 4
}

async function defaultCreateBitmap(blob: Blob, crop?: Crop): Promise<Texture> {
  if (crop === undefined) return createImageBitmap(blob)
  return createImageBitmap(blob, crop.x, crop.y, crop.width, crop.height)
}

/**
 * Decoded content images, kept by path and crop.
 *
 * Least-recently-used eviction: the board redraws from the same handful of
 * images, so the ones in view stay resident while a scenario that has moved on
 * releases the rooms behind it.
 */
export class TextureCache {
  private readonly read: TextureReader
  private readonly createBitmap: (blob: Blob, crop?: Crop) => Promise<Texture>
  private readonly limit: number

  /** Insertion order is the LRU order; a hit re-inserts. */
  private readonly cached = new Map<string, Texture>()
  /** In-flight loads, so two board items sharing art decode once. */
  private readonly pending = new Map<string, Promise<Texture | null>>()
  /** Paths already known to be missing, so a broken reference is asked once. */
  private readonly missing = new Set<string>()
  /** Decoded bytes resident, which is what the limit bounds. */
  private bytes = 0

  constructor(options: TextureCacheOptions) {
    this.read = options.read
    this.createBitmap = options.createBitmap ?? defaultCreateBitmap
    this.limit = options.limit ?? DEFAULT_LIMIT
  }

  /**
   * Loads an image, cropping it when the content declares a rectangle.
   *
   * Returns null for a path that cannot be read or decoded. A scenario
   * referring to art the player does not own should leave a gap on the board,
   * not stop the quest.
   */
  async load(path: string, crop?: Crop): Promise<Texture | null> {
    const key = cacheKey(path, crop)
    if (this.missing.has(key)) return null

    const hit = this.cached.get(key)
    if (hit !== undefined) {
      // Re-insert so the most recently used is last.
      this.cached.delete(key)
      this.cached.set(key, hit)
      return hit
    }

    const inFlight = this.pending.get(key)
    if (inFlight !== undefined) return inFlight

    const load = this.decode(path, crop, key)
    this.pending.set(key, load)
    try {
      return await load
    } finally {
      this.pending.delete(key)
    }
  }

  private async decode(path: string, crop: Crop | undefined, key: string): Promise<Texture | null> {
    let bytes: Uint8Array | null
    try {
      bytes = await this.read(path)
    } catch {
      bytes = null
    }
    if (bytes === null) {
      this.missing.add(key)
      return null
    }

    let bitmap: Texture
    try {
      // A copy, because the blob must own its buffer: the caller's array may
      // be a view into a larger one the filesystem reuses.
      bitmap = await this.createBitmap(new Blob([new Uint8Array(bytes)]), crop)
    } catch {
      this.missing.add(key)
      return null
    }

    this.store(key, bitmap)
    return bitmap
  }

  private store(key: string, bitmap: Texture): void {
    this.cached.set(key, bitmap)
    this.bytes += bytesOf(bitmap)
    while (this.bytes > this.limit && this.cached.size > 1) {
      const oldest = this.cached.keys().next()
      if (oldest.done === true) break
      const evicted = this.cached.get(oldest.value)
      this.cached.delete(oldest.value)
      if (evicted !== undefined) this.bytes -= bytesOf(evicted)
      // Decoded bitmaps hold memory outside the JS heap, so releasing them is
      // not something the collector will do on its own.
      evicted?.close?.()
    }
  }

  /** How many decoded images are resident. */
  get size(): number {
    return this.cached.size
  }

  /** Decoded bytes resident. */
  get resident(): number {
    return this.bytes
  }

  /** Releases everything, for a quest that has ended. */
  clear(): void {
    for (const bitmap of this.cached.values()) bitmap.close?.()
    this.cached.clear()
    this.missing.clear()
    this.bytes = 0
  }
}

function cacheKey(path: string, crop?: Crop): string {
  if (crop === undefined) return path
  return `${path}#${crop.x},${crop.y},${crop.width},${crop.height}`
}
