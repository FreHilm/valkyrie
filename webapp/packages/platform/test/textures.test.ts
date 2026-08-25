/**
 * Tests for the board's texture cache (T-018).
 *
 * `ContentData.FileToTexture` decodes on the main thread every time it is
 * asked, with no cache at all. Here decoding is off-thread and cached, so what
 * is asserted is the caching: that shared art decodes once, that a broken
 * reference is asked for once and leaves a gap rather than stopping the quest,
 * and that eviction releases memory the collector will not.
 */

import { describe, expect, it } from 'vitest'

import { TextureCache } from '../src/textures.js'
import type { Crop } from '../src/textures.js'

/** A stand-in bitmap that records being closed. */
function bitmap(label: string, width = 1, height = 1) {
  return {
    label,
    width,
    height,
    closed: false,
    close(): void {
      this.closed = true
    },
  } as unknown as ImageBitmap & {
    label: string
    closed: boolean
  }
}

function cache(
  files: Record<string, string>,
  options: { limit?: number; failDecode?: boolean } = {},
) {
  const reads: string[] = []
  const decodes: { size: number; crop?: Crop }[] = []
  const instance = new TextureCache({
    read: async (path) => {
      reads.push(path)
      const content = files[path]
      return content === undefined ? null : new TextEncoder().encode(content)
    },
    createBitmap: async (blob, crop) => {
      decodes.push(crop === undefined ? { size: blob.size } : { size: blob.size, crop })
      if (options.failDecode === true) throw new Error('undecodable')
      return bitmap(`${blob.size}${crop === undefined ? '' : `#${crop.x}`}`)
    },
    ...(options.limit === undefined ? {} : { limit: options.limit }),
  })
  return { instance, reads, decodes }
}

describe('TextureCache', () => {
  it('loads an image', async () => {
    const { instance, reads } = cache({ 'img/tile': 'tile-bytes' })

    expect(await instance.load('img/tile')).not.toBeNull()
    expect(reads).toEqual(['img/tile'])
  })

  it('decodes shared art once', async () => {
    // Twenty tiles from one sheet is normal; decoding each time would be
    // twenty copies of a multi-megabyte image.
    const { instance, reads, decodes } = cache({ 'img/sheet': 'bytes' })
    await instance.load('img/sheet')
    await instance.load('img/sheet')

    expect(reads).toHaveLength(1)
    expect(decodes).toHaveLength(1)
  })

  it('decodes once when two callers race for the same image', async () => {
    const { instance, decodes } = cache({ 'img/sheet': 'bytes' })
    const [a, b] = await Promise.all([instance.load('img/sheet'), instance.load('img/sheet')])

    expect(decodes).toHaveLength(1)
    expect(a).toBe(b)
  })

  it('keeps crops of one sheet apart', async () => {
    // Tokens are rectangles within a shared sheet, so the crop is part of the
    // identity — caching by path alone would give every token the same art.
    const { instance, decodes } = cache({ 'img/sheet': 'bytes' })
    const first = await instance.load('img/sheet', { x: 0, y: 0, width: 64, height: 64 })
    const second = await instance.load('img/sheet', { x: 64, y: 0, width: 64, height: 64 })

    expect(decodes).toHaveLength(2)
    expect(first).not.toBe(second)
  })

  it('passes the crop through to the decoder', async () => {
    const { instance, decodes } = cache({ 'img/sheet': 'bytes' })
    await instance.load('img/sheet', { x: 12, y: 34, width: 56, height: 78 })

    expect(decodes[0]?.crop).toEqual({ x: 12, y: 34, width: 56, height: 78 })
  })

  it('returns null for a missing file rather than throwing', async () => {
    // A scenario referring to art the player does not own should leave a gap,
    // not stop the quest.
    const { instance } = cache({})

    expect(await instance.load('img/absent')).toBeNull()
  })

  it('asks for a missing file only once', async () => {
    const { instance, reads } = cache({})
    await instance.load('img/absent')
    await instance.load('img/absent')

    expect(reads).toHaveLength(1)
  })

  it('returns null when the bytes cannot be decoded', async () => {
    const { instance } = cache({ 'img/corrupt': 'bytes' }, { failDecode: true })

    expect(await instance.load('img/corrupt')).toBeNull()
  })

  it('survives a reader that throws', async () => {
    const instance = new TextureCache({
      read: () => Promise.reject(new Error('disk gone')),
      createBitmap: async () => bitmap('never'),
    })

    expect(await instance.load('img/tile')).toBeNull()
  })

  describe('eviction', () => {
    it('keeps only as much decoded data as the limit allows', async () => {
      // Counting images is not a bound: a Mansions tile is 2048x2048, which is
      // 17 MB decoded, so a limit of 128 images permits over two gigabytes and
      // the tab dies.
      const { instance } = cache({ a: '1', b: '2', c: '3' }, { limit: 8 })
      await instance.load('a')
      await instance.load('b')
      await instance.load('c')

      expect(instance.resident).toBeLessThanOrEqual(8)
      expect(instance.size).toBe(2)
    })

    it('evicts one big image where it would keep many small ones', async () => {
      const big = new TextureCache({
        read: async () => new Uint8Array([1]),
        createBitmap: async () => bitmap('big', 64, 64),
        limit: 64 * 64 * 4,
      })
      await big.load('a')
      await big.load('b')

      expect(big.size).toBe(1)
    })

    it('evicts the least recently used, not the oldest loaded', async () => {
      const { instance, decodes } = cache({ a: '1', b: '22', c: '333' }, { limit: 8 })
      await instance.load('a')
      await instance.load('b')
      await instance.load('a') // 'a' is now the most recent
      await instance.load('c') // evicts 'b'
      await instance.load('a')

      // 'a' never had to be decoded again.
      expect(decodes.filter((d) => d.size === 1)).toHaveLength(1)
    })

    it('closes an evicted bitmap, which the collector will not', async () => {
      const closed: unknown[] = []
      const instance = new TextureCache({
        read: async () => new Uint8Array([1]),
        createBitmap: async () =>
          ({ width: 1, height: 1, close: () => closed.push(1) }),
        // One 1x1 bitmap is four bytes, so this holds exactly one.
        limit: 4,
      })
      await instance.load('a')
      await instance.load('b')

      expect(closed).toHaveLength(1)
    })

    it('releases everything on clear', async () => {
      const closed: unknown[] = []
      const instance = new TextureCache({
        read: async () => new Uint8Array([1]),
        createBitmap: async () =>
          ({ width: 1, height: 1, close: () => closed.push(1) }),
      })
      await instance.load('a')
      await instance.load('b')
      instance.clear()

      expect(closed).toHaveLength(2)
      expect(instance.size).toBe(0)
    })

    it('re-reads after a clear', async () => {
      const { instance, reads } = cache({ a: '1' })
      await instance.load('a')
      instance.clear()
      await instance.load('a')

      expect(reads).toHaveLength(2)
    })
  })
})
