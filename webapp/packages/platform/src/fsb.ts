/**
 * FSB5 → Ogg Vorbis.
 *
 * Port of `libraries/FFGAppImport/AssetImport/FSBExport.cs`. FMOD's FSB5
 * container stores Vorbis audio packets with their three headers stripped, so
 * playing one back means rebuilding the identification and comment headers,
 * finding the setup header, and framing the whole thing into Ogg pages.
 *
 * The framing and header construction live in `ogg.ts` and were verified
 * byte-for-byte against the vendored 26,669-line .NET encoder (T-020). This
 * module is the FSB half: parsing the container and walking its packets.
 */

import { OggStream, buildCommentPacket, buildInfoPacket } from './ogg.js'
import { vorbisSetupHeader } from './vorbisSetupHeaders.js'

/** `FSBExport.FSBAudioFormat`. Only Vorbis is supported, as in the C#. */
export const FsbFormat = { VORBIS: 15 } as const

export class FsbError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FsbError'
  }
}

/** Sample rates FSB5 encodes as a 4-bit index. */
const FREQUENCIES = [4000, 8000, 11000, 12000, 16000, 22050, 24000, 32000, 44100, 48000, 96000]

export interface FsbSample {
  channels: number
  frequency: number
  loopStart: number
  loopEnd: number
  /** CRC32 identifying which setup header the stream needs. */
  crc32: number
  /** Offset and length of this sample's packet data within the file. */
  dataOffset: number
  dataSize: number
}

export interface FsbFile {
  samples: FsbSample[]
}

/**
 * Parses an FSB5 container.
 *
 * The sample headers are a bit-packed format: the low bits of the first word
 * hold flags and the frequency index, and the rest is an offset in 32-byte
 * units. Extra header chunks follow, each announcing whether another follows.
 */
export function readFsb(bytes: Uint8Array): FsbFile {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.byteLength < 60) throw new FsbError('Too short to be an FSB5 file')

  const magic = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0)
  if (magic !== 'FSB5') throw new FsbError('Not an FSB5 file')

  view.getUint32(4, true) // version
  const sampleCount = view.getUint32(8, true)
  const sampleHeadersSize = view.getUint32(12, true)
  const nameTableSize = view.getUint32(16, true)
  const dataSize = view.getUint32(20, true)
  const mode = view.getUint32(24, true)

  if (mode !== FsbFormat.VORBIS) {
    throw new FsbError(`Unsupported FSB audio format: ${mode}`)
  }

  // 8 bytes of zero, 16 of hash, 8 of dummy follow the mode.
  let position = 28 + 8 + 16 + 8
  const nameOffset = position + sampleHeadersSize
  const baseOffset = nameOffset + nameTableSize

  const samples: FsbSample[] = []

  for (let i = 0; i < sampleCount; i++) {
    const raw = view.getUint32(position, true)
    position += 4

    let extraHeaders = (raw & 0x01) !== 0
    const type = raw & ((1 << 7) - 1)
    const offset = (raw >>> 7) * 0x20

    let channels = (type >>> 5) + 1
    let frequency = FREQUENCIES[(type >>> 1) & 0x0f] ?? 44100
    let loopStart = 0
    let loopEnd = 0
    let crc32 = 0

    view.getUint32(position, true) // unknown
    position += 4

    while (extraHeaders) {
      let byte = bytes[position++] ?? 0
      extraHeaders = (byte & 0x01) !== 0
      let extraLength = byte >>> 1
      extraLength += (bytes[position++] ?? 0) << 7
      extraLength += (bytes[position++] ?? 0) << 15
      byte = bytes[position++] ?? 0

      if (byte === 0x02) {
        channels = bytes[position++] ?? 0
        extraLength -= 1
      } else if (byte === 0x04) {
        frequency = view.getUint32(position, true)
        position += 4
        extraLength -= 4
      } else if (byte === 0x06) {
        loopStart = view.getUint32(position, true)
        loopEnd = view.getUint32(position + 4, true)
        position += 8
        extraLength -= 8
      } else if (byte === 0x16) {
        crc32 = view.getUint32(position, true)
        position += 4
        extraLength -= 4
      }
      position += extraLength
    }

    const nextHeader = position

    // The size word is the *end* of this sample, in 32-byte units.
    let end = view.getUint32(position, true)
    end = end === 0 ? dataSize + baseOffset : (end >>> 7) * 0x20 + baseOffset
    if (end < 0 || end > bytes.byteLength) end = bytes.byteLength

    const dataOffset = baseOffset + offset
    samples.push({
      channels,
      frequency,
      loopStart,
      loopEnd,
      crc32,
      dataOffset,
      dataSize: end - dataOffset,
    })

    position = nextHeader
  }

  return { samples }
}

/**
 * Rebuilds one FSB5 sample into a playable Ogg Vorbis stream.
 *
 * Returns null when the sample's setup header is not one of the three known
 * ones — the same limit the C# has ("Only support header CRC 3605052372 for
 * now"), reported rather than producing a file that will not decode.
 */
export function fsbSampleToOgg(
  bytes: Uint8Array,
  sample: FsbSample,
  serialNumber = 1,
): Uint8Array | null {
  const setup = vorbisSetupHeader(sample.crc32)
  if (setup === null) return null

  const stream = new OggStream(serialNumber)
  const comments: string[] = []
  if (sample.loopStart > 0 && sample.loopEnd > 0) {
    comments.push(`LOOP_START=${sample.loopStart}`, `LOOP_END=${sample.loopEnd}`)
  }

  stream.packetIn({
    data: buildInfoPacket({ channels: sample.channels, sampleRate: sample.frequency }),
    granulePosition: 0,
  })
  stream.packetIn({ data: buildCommentPacket(comments), granulePosition: 0 })
  stream.packetIn({ data: setup, granulePosition: 0 })

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const end = Math.min(sample.dataOffset + sample.dataSize, bytes.byteLength)

  // Each packet is length-prefixed with a 16-bit count.
  const packets: Uint8Array[] = []
  let position = sample.dataOffset
  while (position + 2 <= end) {
    const size = view.getUint16(position, true)
    if (size === 0) break
    position += 2
    if (position + size > end) break
    packets.push(bytes.subarray(position, position + size))
    position += size
  }
  if (packets.length === 0) return null

  const pages: Uint8Array[] = []
  let granulePosition = 0
  let previousSamples = 0

  packets.forEach((packet, index) => {
    // Bit 1 of the first byte selects the long block, which is how the
    // granule position advances without decoding the audio.
    const noSamples = ((packet[0] ?? 0) & 2) !== 0 ? 2048 : 256
    if (previousSamples !== 0) {
      granulePosition += Math.trunc((previousSamples + noSamples) / 4)
    }
    previousSamples = noSamples

    stream.packetIn({
      data: packet,
      granulePosition,
      endOfStream: index === packets.length - 1,
    })

    const page = stream.pageOut(true)
    if (page !== null) pages.push(page.header, page.body)
  })

  const total = pages.reduce((sum, block) => sum + block.length, 0)
  const joined = new Uint8Array(total)
  let at = 0
  for (const block of pages) {
    joined.set(block, at)
    at += block.length
  }
  return joined
}

/** The first sample of an FSB, which is what a Unity AudioClip holds. */
export function fsbToOgg(bytes: Uint8Array): Uint8Array | null {
  const file = readFsb(bytes)
  const sample = file.samples[0]
  return sample === undefined ? null : fsbSampleToOgg(bytes, sample)
}
