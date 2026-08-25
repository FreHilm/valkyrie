/**
 * Reading a directory the user picked, as an asset source.
 *
 * The import needs the Unity data folder of a licensed install. In the Unity
 * build that is a path it already knows; in a browser the only way to read
 * outside the origin's own storage is a directory the user hands over through
 * `showDirectoryPicker`, which grants read access to that directory alone.
 *
 * Nothing here writes, and nothing here leaves the machine: the handle is used
 * to read asset files, which the import decodes into browser storage.
 */

/** The slice of `FileSystemDirectoryHandle` this needs. */
export interface PickedDirectory {
  name: string
  entries(): AsyncIterableIterator<[string, PickedEntry]>
  getDirectoryHandle(name: string): Promise<PickedDirectory>
  getFileHandle(name: string): Promise<PickedFile>
}

export interface PickedFile {
  kind: 'file'
  getFile(): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; size: number }>
}

export type PickedEntry = PickedFile | (PickedDirectory & { kind: 'directory' })

export interface PickedSourceOptions {
  /** Only files whose name matches are listed. */
  accept?: (name: string) => boolean
  /**
   * Descend into subdirectories. On by default: the download cache nests its
   * bundles two levels deep, and a flat walk finds none of them.
   */
  recursive?: boolean
}

/**
 * An `AssetSource` over a picked directory.
 *
 * Names are relative to the picked directory, so a caller sees the same shape
 * it would from a path on disk.
 */
export class PickedDirectorySource {
  private listing: string[] | null = null

  constructor(
    private readonly directory: PickedDirectory,
    private readonly options: PickedSourceOptions = {},
  ) {}

  /** The directory's own name, for telling the user what was opened. */
  get name(): string {
    return this.directory.name
  }

  async list(): Promise<string[]> {
    if (this.listing !== null) return this.listing
    const found: string[] = []
    await this.walk(this.directory, '', found)
    found.sort()
    this.listing = found
    return found
  }

  private async walk(directory: PickedDirectory, prefix: string, into: string[]): Promise<void> {
    for await (const [name, entry] of directory.entries()) {
      const path = prefix.length === 0 ? name : `${prefix}/${name}`
      if (entry.kind === 'directory') {
        if (this.options.recursive !== false) await this.walk(entry, path, into)
        continue
      }
      if (this.options.accept?.(name) === false) continue
      into.push(path)
    }
  }

  async read(name: string): Promise<Uint8Array> {
    const parts = name.split('/')
    const fileName = parts.pop()
    if (fileName === undefined) throw new Error(`Not a file: ${name}`)

    let directory = this.directory
    for (const part of parts) directory = await directory.getDirectoryHandle(part)

    const handle = await directory.getFileHandle(fileName)
    const file = await handle.getFile()
    return new Uint8Array(await file.arrayBuffer())
  }

  /** Total bytes, for showing how much is about to be read. */
  async size(): Promise<number> {
    let total = 0
    for (const name of await this.list()) {
      const parts = name.split('/')
      const fileName = parts.pop()
      if (fileName === undefined) continue
      let directory = this.directory
      for (const part of parts) directory = await directory.getDirectoryHandle(part)
      const handle = await directory.getFileHandle(fileName)
      total += (await handle.getFile()).size
    }
    return total
  }
}

/** Whether this browser can open a directory at all. */
export function canPickDirectory(): boolean {
  return typeof globalThis !== 'undefined' && 'showDirectoryPicker' in globalThis
}

/**
 * Files an FFG import might read.
 *
 * This used to be a tight allow-list of the install's container names, which
 * silently excluded the downloaded content cache: its bundles are nested two
 * directories deep and every one of them is called `__data`. That cost 425 of
 * 1,158 textures — most of the board art — and the import reported success.
 *
 * The importer already skips anything it cannot parse
 * (`ffgImport.ts:244`), so the safe filter is a wide one: exclude what is
 * obviously not an asset, and let the reader decide about the rest.
 */
export function isUnityAsset(name: string): boolean {
  const file = name.slice(name.lastIndexOf('/') + 1)

  // The download cache names every bundle `__data`, beside an `__info`.
  if (file === '__data') return true
  if (file === '__info') return false

  // Managed assemblies and native libraries are large and never assets.
  if (/\.(dll|so|dylib|exe|config|info|json|xml|txt)$/i.test(file)) return false

  return true
}

/**
 * Several picked directories presented as one source.
 *
 * Current builds keep almost nothing in the install: Mansions 2.1.6 downloads
 * its scenarios, its text and most of its board art on first run. Importing
 * only the install yields images and audio but no localisation — and a third
 * of the textures missing, with the import reporting success.
 *
 * Later sources win a name clash, matching `sourceOver` in the import tool, so
 * downloaded content overrides whatever shipped.
 */
export class CompositeAssetSource {
  private index: Map<string, PickedDirectorySource> | null = null

  constructor(private readonly sources: readonly PickedDirectorySource[]) {}

  async list(): Promise<string[]> {
    return [...(await this.build()).keys()].sort()
  }

  async read(name: string): Promise<Uint8Array> {
    const source = (await this.build()).get(name)
    if (source === undefined) throw new Error(`No such asset: ${name}`)
    return source.read(name)
  }

  private async build(): Promise<Map<string, PickedDirectorySource>> {
    if (this.index !== null) return this.index
    const index = new Map<string, PickedDirectorySource>()
    for (const source of this.sources) {
      for (const name of await source.list()) index.set(name, source)
    }
    this.index = index
    return index
  }
}
