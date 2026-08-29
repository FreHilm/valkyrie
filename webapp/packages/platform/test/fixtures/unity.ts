/**
 * Synthetic Unity assets, so the import pipeline is testable without a
 * licensed FFG install.
 *
 * The differential harnesses verify against real content, but they only run
 * where someone owns the game. These fixtures keep the same code paths covered
 * for everyone else — including the D2E layout, which cannot be verified here
 * at all.
 */

/** Little-endian byte builder with Unity's 4-byte alignment. */
export class Builder {
  private readonly bytes: number[] = []

  u8(value: number): this {
    this.bytes.push(value & 0xff)
    return this
  }

  bool(value: boolean): this {
    return this.u8(value ? 1 : 0)
  }

  i16(value: number): this {
    this.bytes.push(value & 0xff, (value >>> 8) & 0xff)
    return this
  }

  i32(value: number): this {
    this.bytes.push(
      value & 0xff,
      (value >>> 8) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 24) & 0xff,
    )
    return this
  }

  f32(value: number): this {
    const view = new DataView(new ArrayBuffer(4))
    view.setFloat32(0, value, true)
    for (let i = 0; i < 4; i++) this.u8(view.getUint8(i))
    return this
  }

  i64(value: number): this {
    const view = new DataView(new ArrayBuffer(8))
    view.setBigInt64(0, BigInt(value), true)
    for (let i = 0; i < 8; i++) this.u8(view.getUint8(i))
    return this
  }

  raw(data: Uint8Array | readonly number[]): this {
    for (const byte of data) this.u8(byte)
    return this
  }

  /** Length-prefixed and padded to 4, as Unity writes strings. */
  alignedString(text: string): this {
    const encoded = new TextEncoder().encode(text)
    this.i32(encoded.length).raw(encoded)
    return this.align()
  }

  u8Array(data: Uint8Array | readonly number[]): this {
    return this.i32(data.length).raw(data)
  }

  align(): this {
    while (this.bytes.length % 4 !== 0) this.u8(0)
    return this
  }

  build(): Uint8Array {
    return Uint8Array.from(this.bytes)
  }
}

/** A Texture2D body for Unity 2022.3, in the field order the reader expects. */
export function texture2DBody(options: {
  name: string
  width: number
  height: number
  format: number
  payload: Uint8Array
  streamPath?: string
  streamOffset?: number
  streamSize?: number
}): Uint8Array {
  const b = new Builder()
  b.alignedString(options.name)
  b.i32(0).bool(false).bool(false).align() // Texture base

  b.i32(options.width)
  b.i32(options.height)
  b.i32(options.payload.length) // m_CompleteImageSize
  b.i32(0) // m_MipsStripped
  b.i32(options.format)
  b.i32(1) // m_MipCount

  b.bool(true) // m_IsReadable
  b.bool(false) // m_IsPreProcessed
  b.bool(false).align() // m_IgnoreMipmapLimit (2022.2+)
  b.alignedString('') // m_MipmapLimitGroupName
  b.bool(false) // m_StreamingMipmaps
  b.align()
  b.i32(0) // m_StreamingMipmapsPriority

  b.i32(1) // m_ImageCount
  b.i32(2) // m_TextureDimension
  b.i32(1).i32(1).f32(0).i32(0).i32(0).i32(0) // GLTextureSettings
  b.i32(0) // m_LightmapFormat
  b.i32(0) // m_ColorSpace
  b.u8Array([]).align() // m_PlatformBlob

  if (options.streamPath === undefined) {
    b.i32(options.payload.length).raw(options.payload)
  } else {
    b.i32(0) // zero size means the pixels are streamed
    b.i64(options.streamOffset ?? 0)
    b.i32(options.streamSize ?? options.payload.length)
    b.alignedString(options.streamPath)
  }

  return b.build()
}

/** An AudioClip body. Unity 5.0 and up share this layout. */
export function audioClipBody(options: {
  name: string
  channels: number
  frequency: number
  compressionFormat: number
  payload: Uint8Array
  streamPath?: string
  streamOffset?: number
}): Uint8Array {
  const b = new Builder()
  b.alignedString(options.name)

  b.i32(0) // m_LoadType
  b.i32(options.channels)
  b.i32(options.frequency)
  b.i32(16) // m_BitsPerSample
  b.f32(1) // m_Length
  b.bool(false).align() // m_IsTrackerFormat
  b.i32(0) // m_SubsoundIndex
  b.bool(false).bool(false).bool(false).align() // preload / background / legacy3D

  b.alignedString(options.streamPath ?? '')
  b.i64(options.streamOffset ?? 0)
  b.i64(options.payload.length)
  b.i32(options.compressionFormat)
  if (options.streamPath === undefined) b.raw(options.payload)

  return b.build()
}

/** A TextAsset body. */
export function textAssetBody(name: string, payload: Uint8Array): Uint8Array {
  return new Builder().alignedString(name).u8Array(payload).build()
}

/**
 * A minimal but structurally valid sfnt.
 *
 * `signature` picks TrueType, CFF or a collection; `padding` grows the file
 * without changing its table directory, so a test can make one big enough to
 * pass the reader's size floor. The single table is `cmap`, and its offset and
 * length are real, because the reader checks exactly that.
 */
export function fontFile(
  options: {
    signature?: number
    padding?: number
    covers?: readonly [number, number]
    /** Which cmap subtable format to write the coverage as. Default 4. */
    cmapFormat?: 4 | 12
    /** Points the cmap table record past the end of the data. */
    danglingCmap?: boolean
  } = {},
): Uint8Array {
  const signature = options.signature ?? 0x00010000
  const padding = options.padding ?? 8192

  const b = new Builder()
  const beU32 = (value: number): void => {
    b.u8(value >>> 24)
      .u8(value >>> 16)
      .u8(value >>> 8)
      .u8(value)
  }
  const beU16 = (value: number): void => {
    b.u8(value >>> 8).u8(value)
  }

  beU32(signature)
  if (signature === 0x74746366) {
    // A collection: a face count and one offset, which is as far as the reader
    // reads before accepting it.
    beU32(1)
    beU32(1)
    beU32(16)
    for (let i = 0; i < padding; i++) b.u8(0)
    return b.build()
  }

  // A cmap with one format-4 subtable covering the requested range, when one
  // is asked for. `coversCodepoints` reads exactly this and nothing else.
  const cmap: number[] = []
  if (options.covers !== undefined) {
    const [from, to] = options.covers
    const push16 = (value: number): void => {
      cmap.push((value >>> 8) & 0xff, value & 0xff)
    }
    const push32 = (value: number): void => {
      cmap.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff)
    }
    push16(0) // version
    push16(1) // one encoding record
    push16(3) // platform: Windows
    push16(10) // encoding: UCS-4
    push32(12) // offset to the subtable

    if ((options.cmapFormat ?? 4) === 12) {
      // Format 12: 32-bit groups, which is how a font covering anything above
      // the BMP has to spell its coverage.
      push16(12)
      push16(0) // reserved
      push32(28) // length
      push32(0) // language
      push32(1) // one group
      push32(from)
      push32(to)
      push32(1) // startGlyphID
    } else {
      push16(4) // format
      push16(24) // length
      push16(0) // language
      push16(4) // segCountX2: two segments
      push16(4) // searchRange
      push16(1) // entrySelector
      push16(0) // rangeShift
      push16(to) // endCode[0]
      push16(0xffff) // endCode[1], the required terminator
      push16(0) // reservedPad
      push16(from) // startCode[0]
      push16(0xffff) // startCode[1]
    }
  }

  const tables = cmap.length > 0 ? 2 : 1
  const directoryEnd = 12 + tables * 16
  beU16(tables)
  beU16(16 * tables) // searchRange
  beU16(0) // entrySelector
  beU16(0) // rangeShift

  if (cmap.length > 0) {
    b.raw(new TextEncoder().encode('cmap'))
    beU32(0)
    beU32(options.danglingCmap === true ? 0x7fffffff : directoryEnd)
    beU32(cmap.length)
  }
  b.raw(new TextEncoder().encode('glyf'))
  beU32(0) // checksum
  beU32(directoryEnd + cmap.length)
  beU32(padding) // length

  b.raw(cmap)
  for (let i = 0; i < padding; i++) b.u8(0)
  return b.build()
}

/**
 * A `Font` body shaped like the real thing: a name, a preamble of whatever
 * length, then the length-prefixed font, then trailing fields.
 *
 * `preamble` is the part the reader deliberately does not parse — in a real
 * install it is 80 bytes for one face and 6,452 for another — so a test can
 * set it to whatever it needs to prove the search does not depend on it.
 */
export function fontBody(options: {
  name: string
  font: Uint8Array
  preamble?: number
  trailing?: number
}): Uint8Array {
  const b = new Builder()
  b.alignedString(options.name)
  for (let i = 0; i < (options.preamble ?? 24); i++) b.u8(0x7f)
  b.u8Array(options.font)
  for (let i = 0; i < (options.trailing ?? 12); i++) b.u8(0x7f)
  return b.build()
}

export interface FixtureObject {
  classId: number
  body: Uint8Array
}

/** Wraps object bodies in a SerializedFile container (format version 22). */
export function serializedFile(
  objects: readonly FixtureObject[],
  unityVersion = '2022.3.62f2',
): Uint8Array {
  const meta = new Builder()
  meta.raw(new TextEncoder().encode(`${unityVersion}\0`))
  meta.i32(19) // target platform
  meta.u8(0) // enableTypeTree = false

  meta.i32(objects.length)
  for (const object of objects) {
    meta.i32(object.classId)
    meta.u8(0) // m_IsStrippedType
    meta.i16(0) // m_ScriptTypeIndex
    meta.raw(new Uint8Array(16)) // m_OldTypeHash
  }

  meta.i32(objects.length)
  let running = 0
  const starts: number[] = []
  objects.forEach((object, index) => {
    meta.align()
    meta.i64(index + 1) // pathId
    meta.i64(running)
    meta.i32(object.body.length)
    meta.i32(index) // typeID
    starts.push(running)
    running += object.body.length
    while (running % 8 !== 0) running++
  })

  meta.i32(0) // script count
  meta.i32(0) // external count

  const metadata = meta.build()
  const headerSize = 48
  const dataOffset = headerSize + metadata.length
  const total = dataOffset + running

  const bytes = new Uint8Array(total)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, metadata.length, false)
  view.setUint32(4, total, false)
  view.setUint32(8, 22, false)
  view.setUint32(12, dataOffset, false)
  view.setUint8(16, 0)
  view.setUint32(20, metadata.length, false)
  view.setBigInt64(24, BigInt(total), false)
  view.setBigInt64(32, BigInt(dataOffset), false)

  bytes.set(metadata, headerSize)
  objects.forEach((object, index) => {
    bytes.set(object.body, dataOffset + (starts[index] ?? 0))
  })
  return bytes
}

/**
 * A minimal FSB5 container with one Vorbis sample.
 *
 * The header is bit-packed: the low bit of the first word says whether extra
 * header chunks follow, bits 1..4 index the sample rate, bits 5+ hold the
 * channel count, and the rest is an offset in 32-byte units. Each extra chunk
 * announces whether another follows.
 */
export function fsb5(options: {
  channels?: number
  /** Index into the rate table; 8 is 44100. */
  frequencyIndex?: number
  crc32?: number
  loopStart?: number
  loopEnd?: number
  /** Vorbis packets, each written with a 16-bit length prefix. */
  packets: readonly Uint8Array[]
}): Uint8Array {
  const channels = options.channels ?? 1
  const frequencyIndex = options.frequencyIndex ?? 8
  const hasLoop = options.loopStart !== undefined && options.loopEnd !== undefined

  const body = new Builder()
  for (const packet of options.packets) {
    body.i16(packet.length).raw(packet)
  }
  body.i16(0) // terminator
  const data = body.build()

  const headers = new Builder()
  // type: bit0 = extra headers follow, bits1-4 = rate index, bits5+ = channels-1
  const type = 1 | (frequencyIndex << 1) | ((channels - 1) << 5)
  headers.i32(type) // offset is zero, so nothing above bit 7
  headers.i32(0) // unknown

  const chunk = (last: boolean, kind: number, payload: readonly number[]): void => {
    // The length counts the payload only; the kind byte is not included.
    const length = payload.length
    headers.u8((last ? 0 : 1) | ((length & 0x7f) << 1))
    headers.u8((length >>> 7) & 0xff)
    headers.u8((length >>> 15) & 0xff)
    headers.u8(kind)
    headers.raw(payload)
  }

  const le32 = (value: number): number[] => [
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]

  if (hasLoop) {
    chunk(false, 0x06, [...le32(options.loopStart ?? 0), ...le32(options.loopEnd ?? 0)])
  }
  chunk(true, 0x16, le32(options.crc32 ?? 0))

  headers.i32(0) // size word: zero means "to the end of the data"
  const sampleHeaders = headers.build()

  const out = new Builder()
  out.raw(new TextEncoder().encode('FSB5'))
  out.i32(1) // version
  out.i32(1) // sample count
  out.i32(sampleHeaders.length)
  out.i32(0) // name table size
  out.i32(data.length)
  out.i32(15) // FMOD_SOUND_FORMAT_VORBIS
  out.raw(new Uint8Array(8)) // zero
  out.raw(new Uint8Array(16)) // hash
  out.raw(new Uint8Array(8)) // dummy
  out.raw(sampleHeaders)
  out.raw(data)
  return out.build()
}

/** The CRC32 of the setup header the shipped MoM audio almost always uses. */
export const KNOWN_SETUP_CRC = 3605052372
