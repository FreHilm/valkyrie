/**
 * `UnityFS` AssetBundle reader.
 *
 * Current FFG builds do not ship their game content inside the install. Mansions
 * of Madness 2.1.6 downloads it on first run and caches it separately — on
 * macOS, `~/Library/Caches/com.fantasyflightgames.mom`, 413 MB across 38
 * bundles — and that is where the `Localization_*` text lives. MoM base content
 * references 3,725 `{ffg:…}` keys, so without this the game renders raw keys.
 *
 * A bundle is a header, a list of storage blocks, and a directory of files
 * carved out of the concatenated blocks. The files inside are ordinary
 * `SerializedFile`s, which `unityAssets.ts` already reads.
 *
 * Unlike the asset files, a bundle header is **big-endian throughout**.
 */

import { decompressLz4Block } from './lz4.js'

export class UnityBundleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnityBundleError'
  }
}

/** `ArchiveFlags`. */
const FLAG_COMPRESSION_MASK = 0x3f
const FLAG_BLOCKS_INFO_AT_END = 0x80
const FLAG_BLOCK_INFO_PADDING = 0x200

/** `CompressionType`. */
export const Compression = {
  NONE: 0,
  LZMA: 1,
  LZ4: 2,
  LZ4HC: 3,
  LZHAM: 4,
} as const

const COMPRESSION_NAMES: Record<number, string> = {
  0: 'none',
  1: 'LZMA',
  2: 'LZ4',
  3: 'LZ4HC',
  4: 'LZHAM',
}

export interface BundleHeader {
  signature: string
  version: number
  unityVersion: string
  unityRevision: string
  size: number
  compressedBlocksInfoSize: number
  uncompressedBlocksInfoSize: number
  flags: number
}

export interface BundleEntry {
  /** Path within the bundle, usually a `CAB-…` name. */
  path: string
  data: Uint8Array
}

/** Big-endian reader, which is what a bundle header uses. */
class BigEndianReader {
  offset = 0
  private readonly view: DataView

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  u8(): number {
    return this.bytes[this.offset++] ?? 0
  }

  u16(): number {
    const value = this.view.getUint16(this.offset, false)
    this.offset += 2
    return value
  }

  u32(): number {
    const value = this.view.getUint32(this.offset, false)
    this.offset += 4
    return value
  }

  i32(): number {
    const value = this.view.getInt32(this.offset, false)
    this.offset += 4
    return value
  }

  i64(): number {
    const value = this.view.getBigInt64(this.offset, false)
    this.offset += 8
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(-Number.MAX_SAFE_INTEGER)) {
      throw new UnityBundleError(`Offset out of range: ${value}`)
    }
    return Number(value)
  }

  bytesOf(count: number): Uint8Array {
    if (count < 0 || this.offset + count > this.bytes.byteLength) {
      throw new UnityBundleError(`Read of ${count} bytes runs past the end of the bundle`)
    }
    const slice = this.bytes.subarray(this.offset, this.offset + count)
    this.offset += count
    return slice
  }

  stringToNull(): string {
    const start = this.offset
    while (this.offset < this.bytes.byteLength && this.bytes[this.offset] !== 0) this.offset++
    const text = new TextDecoder().decode(this.bytes.subarray(start, this.offset))
    this.offset++
    return text
  }

  /** `EndianBinaryReader.AlignStream(n)`: round the position up to a multiple. */
  align(alignment: number): void {
    const remainder = this.offset % alignment
    if (remainder !== 0) this.offset += alignment - remainder
  }
}

/** Whether a file looks like a Unity AssetBundle. */
export function isUnityBundle(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength > 8 &&
    new TextDecoder().decode(bytes.subarray(0, 7)) === 'UnityFS' &&
    bytes[7] === 0
  )
}

export function readBundleHeader(bytes: Uint8Array): BundleHeader {
  const reader = new BigEndianReader(bytes)
  const signature = reader.stringToNull()
  if (signature !== 'UnityFS') {
    throw new UnityBundleError(`Unsupported bundle signature: ${signature}`)
  }

  const version = reader.u32()
  const unityVersion = reader.stringToNull()
  const unityRevision = reader.stringToNull()
  const size = reader.i64()
  const compressedBlocksInfoSize = reader.u32()
  const uncompressedBlocksInfoSize = reader.u32()
  const flags = reader.u32()

  return {
    signature,
    version,
    unityVersion,
    unityRevision,
    size,
    compressedBlocksInfoSize,
    uncompressedBlocksInfoSize,
    flags,
  }
}

/**
 * Reads every file out of a bundle.
 *
 * Uncompressed and LZ4 blocks are handled — a real Mansions of Madness cache
 * holds 5,373 LZ4 blocks and 770 uncompressed. LZMA and LZHAM are not: no
 * bundle measured uses them, so the code would have nothing to verify it. An
 * unsupported type is named in the error rather than guessed at.
 */
export function readBundle(bytes: Uint8Array): BundleEntry[] {
  const reader = new BigEndianReader(bytes)
  const header = readBundleHeader(bytes)
  reader.offset = 0
  reader.stringToNull()
  reader.u32()
  reader.stringToNull()
  reader.stringToNull()
  reader.i64()
  reader.u32()
  reader.u32()
  reader.u32()

  if (header.version >= 7) reader.align(16)

  // The block list either sits inline or at the very end of the file.
  let blocksInfo: Uint8Array
  if ((header.flags & FLAG_BLOCKS_INFO_AT_END) !== 0) {
    const start = bytes.byteLength - header.compressedBlocksInfoSize
    if (start < 0) throw new UnityBundleError('Block list runs before the start of the bundle')
    blocksInfo = bytes.subarray(start, start + header.compressedBlocksInfoSize)
  } else {
    blocksInfo = reader.bytesOf(header.compressedBlocksInfoSize)
  }

  const info = new BigEndianReader(
    decompress(
      blocksInfo,
      header.uncompressedBlocksInfoSize,
      header.flags & FLAG_COMPRESSION_MASK,
      'the block list',
    ),
  )
  info.bytesOf(16) // uncompressed data hash

  const blockCount = info.i32()
  const blocks: { uncompressedSize: number; compressedSize: number; flags: number }[] = []
  for (let i = 0; i < blockCount; i++) {
    blocks.push({
      uncompressedSize: info.u32(),
      compressedSize: info.u32(),
      flags: info.u16(),
    })
  }

  const nodeCount = info.i32()
  const nodes: { offset: number; size: number; flags: number; path: string }[] = []
  for (let i = 0; i < nodeCount; i++) {
    nodes.push({
      offset: info.i64(),
      size: info.i64(),
      flags: info.u32(),
      path: info.stringToNull(),
    })
  }

  if ((header.flags & FLAG_BLOCK_INFO_PADDING) !== 0) reader.align(16)

  // The blocks concatenate into one buffer that the directory indexes into.
  const total = blocks.reduce((sum, block) => sum + block.uncompressedSize, 0)
  const storage = new Uint8Array(total)
  let written = 0

  for (const block of blocks) {
    const raw = reader.bytesOf(block.compressedSize)
    storage.set(
      decompress(
        raw,
        block.uncompressedSize,
        block.flags & FLAG_COMPRESSION_MASK,
        'a storage block',
      ),
      written,
    )
    written += block.uncompressedSize
  }

  return nodes.map((node) => ({
    path: node.path,
    data: storage.subarray(node.offset, node.offset + node.size),
  }))
}

function decompress(
  data: Uint8Array,
  uncompressedSize: number,
  compression: number,
  what: string,
): Uint8Array {
  if (compression === Compression.NONE) return data
  if (compression === Compression.LZ4 || compression === Compression.LZ4HC) {
    return decompressLz4Block(data, uncompressedSize)
  }

  const name = COMPRESSION_NAMES[compression] ?? String(compression)
  throw new UnityBundleError(
    `${what} uses ${name} compression, which is not supported. ` +
      'No bundle measured uses it; add a decompressor when a build needs one.',
  )
}
