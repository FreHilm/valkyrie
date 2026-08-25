/**
 * Tests for the AssetBundle reader and LZ4 decompressor (T-023).
 *
 * The real assurance is `tools/differential/bundle`, which reads the content
 * cache a licensed Mansions of Madness install downloads and matches all 916
 * objects against AssetStudio — through LZ4, the bundle container and the
 * SerializedFile reader, comparing payload hashes. These cover the shapes that
 * corpus does not reach, and the failure paths.
 */

import { describe, expect, it } from 'vitest'

import { Lz4Error, decompressLz4Block } from '../src/lz4.js'
import {
  Compression,
  UnityBundleError,
  isUnityBundle,
  readBundle,
  readBundleHeader,
} from '../src/unityBundle.js'

/** Builds an LZ4 block: a token, literals, then an optional match. */
function lz4Sequence(literals: number[], match?: { offset: number; length: number }): number[] {
  const literalToken = Math.min(literals.length, 15)
  const matchExtra = match === undefined ? 0 : match.length - 4
  const matchToken = Math.min(matchExtra, 15)
  const out = [(literalToken << 4) | matchToken]

  if (literals.length >= 15) {
    let remaining = literals.length - 15
    while (remaining >= 255) {
      out.push(255)
      remaining -= 255
    }
    out.push(remaining)
  }
  out.push(...literals)

  if (match !== undefined) {
    out.push(match.offset & 0xff, (match.offset >>> 8) & 0xff)
    if (matchExtra >= 15) {
      let remaining = matchExtra - 15
      while (remaining >= 255) {
        out.push(255)
        remaining -= 255
      }
      out.push(remaining)
    }
  }
  return out
}

describe('decompressLz4Block', () => {
  it('copies a literal-only block', () => {
    const block = Uint8Array.from(lz4Sequence([1, 2, 3, 4]))

    expect([...decompressLz4Block(block, 4)]).toEqual([1, 2, 3, 4])
  })

  it('resolves a back-reference', () => {
    // Four literals, then a four-byte match four bytes back.
    const block = Uint8Array.from([
      ...lz4Sequence([1, 2, 3, 4], { offset: 4, length: 4 }),
      ...lz4Sequence([9]),
    ])

    expect([...decompressLz4Block(block, 9)]).toEqual([1, 2, 3, 4, 1, 2, 3, 4, 9])
  })

  /**
   * An overlapping match, where the offset is shorter than the length, is how
   * LZ4 encodes a run. A bulk copy would read the bytes as they were before
   * the copy started and produce the wrong output.
   */
  it('handles an overlapping match as a repeating run', () => {
    const block = Uint8Array.from([
      ...lz4Sequence([7], { offset: 1, length: 5 }),
      ...lz4Sequence([0]),
    ])

    expect([...decompressLz4Block(block, 7)]).toEqual([7, 7, 7, 7, 7, 7, 0])
  })

  it('reads an extended literal length', () => {
    const literals = Array.from({ length: 300 }, (_, i) => i & 0xff)
    const block = Uint8Array.from(lz4Sequence(literals))

    expect([...decompressLz4Block(block, 300)]).toEqual(literals)
  })

  it('reads an extended match length', () => {
    const block = Uint8Array.from([
      ...lz4Sequence([5], { offset: 1, length: 30 }),
      ...lz4Sequence([1]),
    ])
    const out = decompressLz4Block(block, 32)

    expect(out).toHaveLength(32)
    expect([...out.slice(0, 31)]).toEqual(Array.from({ length: 31 }, () => 5))
  })

  it('reports a size that does not match what was produced', () => {
    expect(() => decompressLz4Block(Uint8Array.from(lz4Sequence([1, 2])), 99)).toThrow(Lz4Error)
  })

  it('refuses a match reaching before the start of the block', () => {
    const block = Uint8Array.from([...lz4Sequence([1], { offset: 8, length: 4 })])

    expect(() => decompressLz4Block(block, 5)).toThrow(/before the start/)
  })

  it('refuses a zero match offset', () => {
    const block = Uint8Array.from([(1 << 4) | 0, 1, 0, 0])

    expect(() => decompressLz4Block(block, 5)).toThrow(/offset of zero/)
  })

  it('refuses a literal run that runs past the end', () => {
    expect(() => decompressLz4Block(Uint8Array.from([0xf0, 1, 2]), 20)).toThrow(/past the end/)
  })
})

/** Builds a minimal uncompressed UnityFS bundle around one file. */
function bundle(files: { path: string; data: Uint8Array }[]): Uint8Array {
  const out: number[] = []
  const beU32 = (v: number): void =>
    out.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff)
  const beU16 = (v: number): void => out.push((v >>> 8) & 0xff, v & 0xff)
  const beI64 = (v: number): void => {
    beU32(Math.floor(v / 2 ** 32))
    beU32(v >>> 0)
  }
  const text = (s: string): void => {
    for (const c of s) out.push(c.charCodeAt(0))
    out.push(0)
  }

  const storage: number[] = []
  const nodes: { offset: number; size: number; path: string }[] = []
  for (const file of files) {
    nodes.push({ offset: storage.length, size: file.data.length, path: file.path })
    storage.push(...file.data)
  }

  // Block list: 16-byte hash, block count, one block, node count, nodes.
  const info: number[] = []
  const infoBeU32 = (v: number): void =>
    info.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff)
  info.push(...new Array<number>(16).fill(0))
  infoBeU32(1)
  infoBeU32(storage.length) // uncompressed size
  infoBeU32(storage.length) // compressed size
  info.push(0, 0) // flags: uncompressed
  infoBeU32(nodes.length)
  for (const node of nodes) {
    infoBeU32(Math.floor(node.offset / 2 ** 32))
    infoBeU32(node.offset >>> 0)
    infoBeU32(Math.floor(node.size / 2 ** 32))
    infoBeU32(node.size >>> 0)
    infoBeU32(0) // flags
    for (const c of node.path) info.push(c.charCodeAt(0))
    info.push(0)
  }

  text('UnityFS')
  beU32(8) // version
  text('5.x.x')
  text('2022.3.62f2')
  beI64(0) // size, unused here
  beU32(info.length) // compressedBlocksInfoSize
  beU32(info.length) // uncompressedBlocksInfoSize
  beU32(0x40) // flags: uncompressed, block list inline
  while (out.length % 16 !== 0) out.push(0) // version >= 7 aligns to 16
  out.push(...info)
  out.push(...storage)

  void beU16
  return Uint8Array.from(out)
}

describe('isUnityBundle', () => {
  it('recognises a bundle', () => {
    expect(isUnityBundle(bundle([{ path: 'CAB-x', data: Uint8Array.from([1]) }]))).toBe(true)
  })

  it.each([
    ['an asset file', new Uint8Array(64)],
    ['something too short', Uint8Array.from([1, 2])],
  ])('rejects %s', (_name, bytes) => {
    expect(isUnityBundle(bytes)).toBe(false)
  })
})

describe('readBundleHeader', () => {
  it('reads the header, which is big-endian throughout', () => {
    const header = readBundleHeader(bundle([{ path: 'CAB-x', data: Uint8Array.from([1, 2]) }]))

    expect(header).toMatchObject({
      signature: 'UnityFS',
      version: 8,
      unityRevision: '2022.3.62f2',
    })
  })

  it('names a signature it does not handle', () => {
    const bytes = new TextEncoder().encode('UnityWeb\0')

    expect(() => readBundleHeader(bytes)).toThrow(/Unsupported bundle signature: UnityWeb/)
  })
})

describe('readBundle', () => {
  it('returns each file the directory names', () => {
    const entries = readBundle(
      bundle([
        { path: 'CAB-one', data: Uint8Array.from([1, 2, 3]) },
        { path: 'CAB-one.resource', data: Uint8Array.from([4, 5]) },
      ]),
    )

    expect(entries.map((e) => e.path)).toEqual(['CAB-one', 'CAB-one.resource'])
    expect([...(entries[0]?.data ?? [])]).toEqual([1, 2, 3])
    expect([...(entries[1]?.data ?? [])]).toEqual([4, 5])
  })

  it('handles a bundle with no files', () => {
    expect(readBundle(bundle([]))).toEqual([])
  })

  // LZMA and LZHAM appear in no bundle measured, so they are named rather than
  // guessed at — a wrong decompressor would produce plausible-looking garbage.
  it('names an unsupported compression rather than guessing', () => {
    const bytes = bundle([{ path: 'CAB-x', data: Uint8Array.from([1]) }])
    const view = new DataView(bytes.buffer)
    // The flags sit just before the 16-byte alignment padding.
    let offset = 0
    while (bytes[offset] !== 0) offset++
    offset += 1 + 4
    while (bytes[offset] !== 0) offset++
    offset += 1
    while (bytes[offset] !== 0) offset++
    offset += 1 + 8 + 4 + 4
    view.setUint32(offset, 0x40 | Compression.LZMA, false)

    expect(() => readBundle(bytes)).toThrow(/LZMA compression, which is not supported/)
  })

  it('reports a block list that runs before the start of the file', () => {
    const bytes = bundle([{ path: 'CAB-x', data: Uint8Array.from([1]) }])
    const view = new DataView(bytes.buffer)
    let offset = 0
    while (bytes[offset] !== 0) offset++
    offset += 1 + 4
    while (bytes[offset] !== 0) offset++
    offset += 1
    while (bytes[offset] !== 0) offset++
    offset += 1 + 8
    view.setUint32(offset, 0xffffff, false) // compressedBlocksInfoSize
    view.setUint32(offset + 8, 0x80, false) // BlocksInfoAtTheEnd

    expect(() => readBundle(bytes)).toThrow(UnityBundleError)
  })
})
