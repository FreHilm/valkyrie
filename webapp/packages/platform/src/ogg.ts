/**
 * Ogg container muxing and Vorbis header construction.
 *
 * This exists to answer the question in the T-020 notes: whether the 26,669
 * lines of vendored `.NET Ogg Vorbis Encoder` under
 * `libraries/FFGAppImport/AssetImport/oggencoder/` are needed in the web port.
 *
 * They are not. `FSBExport.WriteFile` never encodes any audio — FSB5 stores
 * Vorbis packets with their three headers stripped, and the audio packets are
 * copied through verbatim (`stream.ReadBytes(packetSize)`). The encoder is used
 * for exactly three things: building the identification header, building the
 * comment header, and Ogg page framing. That is what is here, in ~200 lines,
 * verified byte-for-byte against the original by
 * `tools/differential/ogg`.
 *
 * The setup header is not built at all in either implementation: it is one of
 * three fixed blobs looked up by CRC in `OggVorbisHeader.cs`, which is data
 * rather than code and carries across unchanged.
 */

const VORBIS = 'vorbis'
/** The C# writes this vendor string, and it lands in every produced file. */
export const VENDOR_STRING = 'OggVorbisEncoder'

/** Writes least-significant-bit-first, as `EncodeBuffer` does. */
class BitWriter {
  private readonly bytes: number[] = []
  private bitCount = 0

  write(value: number, bits: number): void {
    for (let i = 0; i < bits; i++) {
      const bit = (value >>> i) & 1
      const index = this.bitCount >> 3
      if (index >= this.bytes.length) this.bytes.push(0)
      if (bit === 1) this.bytes[index] = (this.bytes[index] ?? 0) | (1 << (this.bitCount & 7))
      this.bitCount++
    }
  }

  writeString(text: string): void {
    for (let i = 0; i < text.length; i++) this.write(text.charCodeAt(i), 8)
  }

  toBytes(): Uint8Array {
    return Uint8Array.from(this.bytes)
  }
}

export interface VorbisInfo {
  channels: number
  sampleRate: number
  /** `VorbisInfo.BitRateNominal`, which FSBExport leaves at 0. */
  bitRateNominal?: number
  /** `CodecSetup.BlockSizes`; FSBExport uses 256 and 2048. */
  blockSize0?: number
  blockSize1?: number
}

/** `Encoding.Log`: the index of the highest set bit, or 0. */
function log2Floor(value: number): number {
  let result = 0
  let v = value
  while (v > 0) {
    result++
    v >>>= 1
  }
  return result
}

/** The Vorbis identification header, packet 0. */
export function buildInfoPacket(info: VorbisInfo): Uint8Array {
  const buffer = new BitWriter()
  buffer.write(0x01, 8)
  buffer.writeString(VORBIS)

  buffer.write(0x00, 32)
  buffer.write(info.channels, 8)
  buffer.write(info.sampleRate, 32)

  buffer.write(0, 32)
  buffer.write(info.bitRateNominal ?? 0, 32)
  buffer.write(0, 32)

  buffer.write(log2Floor((info.blockSize0 ?? 256) - 1), 4)
  buffer.write(log2Floor((info.blockSize1 ?? 2048) - 1), 4)
  buffer.write(1, 1)
  return buffer.toBytes()
}

/**
 * The Vorbis comment header, packet 1.
 *
 * Note the C# writes `comment.Length` — a UTF-16 code-unit count — as the byte
 * length. For the ASCII `LOOP_START=…` tags FSBExport emits they agree; for a
 * non-ASCII comment the C# would write a wrong length and produce a corrupt
 * header. The port measures actual UTF-8 bytes.
 */
export function buildCommentPacket(comments: readonly string[]): Uint8Array {
  const buffer = new BitWriter()
  const encoder = new TextEncoder()

  buffer.write(0x03, 8)
  buffer.writeString(VORBIS)

  buffer.write(VENDOR_STRING.length, 32)
  buffer.writeString(VENDOR_STRING)

  buffer.write(comments.length, 32)
  for (const comment of comments) {
    if (comment.length === 0) {
      buffer.write(0, 32)
      continue
    }
    const bytes = encoder.encode(comment)
    buffer.write(bytes.length, 32)
    for (const byte of bytes) buffer.write(byte, 8)
  }

  buffer.write(1, 1)
  return buffer.toBytes()
}

/** The Ogg framing CRC: polynomial 0x04c11db7, no reflection, no final xor. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let value = i << 24
    for (let bit = 0; bit < 8; bit++) {
      value = (value & 0x80000000) !== 0 ? ((value << 1) ^ 0x04c11db7) >>> 0 : (value << 1) >>> 0
    }
    table[i] = value >>> 0
  }
  return table
})()

function crc32(...blocks: Uint8Array[]): number {
  let register = 0
  for (const block of blocks) {
    for (const byte of block) {
      const index = ((register >>> 24) & 0xff) ^ byte
      register = (((register << 8) >>> 0) ^ (CRC_TABLE[index] ?? 0)) >>> 0
    }
  }
  return register >>> 0
}

export interface OggPage {
  header: Uint8Array
  body: Uint8Array
}

export interface OggPacketIn {
  data: Uint8Array
  granulePosition: number
  endOfStream?: boolean
}

/**
 * Ogg bitstream muxer, following `OggStream.cs` — which is itself libogg.
 *
 * The two behaviours that are easy to get wrong and that the differential
 * harness pins: the first page carries the identification packet **alone**,
 * and a packet whose length is an exact multiple of 255 needs a trailing
 * zero-length segment so the reader knows it ended.
 */
export class OggStream {
  private readonly lacingValues: number[] = []
  private readonly granuleValues: number[] = []
  private body: number[] = []
  private granulePosition = 0
  private pageNumber = 0
  private writesHaveStarted = false
  private finished = false

  constructor(private readonly serialNumber: number) {}

  packetIn(packet: OggPacketIn): void {
    const bytes = packet.data.length
    // Matches `(int)(bytes / 255f + 1)`: a 255-byte packet yields two lacing
    // values, the second of them zero.
    const lacingCount = Math.trunc(bytes / 255 + 1)

    for (const byte of packet.data) this.body.push(byte)

    const start = this.lacingValues.length
    for (let i = 0; i < lacingCount - 1; i++) {
      this.lacingValues.push(255)
      this.granuleValues.push(this.granulePosition)
    }
    this.lacingValues.push(bytes % 255)
    this.granuleValues.push(packet.granulePosition)
    this.granulePosition = packet.granulePosition

    // 0x100 marks the first segment of a packet: its absence means the page
    // begins mid-packet, which sets the "continued" header flag.
    this.lacingValues[start] = (this.lacingValues[start] ?? 0) | 0x100

    if (packet.endOfStream === true) this.finished = true
  }

  /** Emits a page if one is due, or `null`. `force` flushes what is buffered. */
  pageOut(force: boolean): OggPage | null {
    const bufferSize = 4096
    const maxValues = Math.min(this.lacingValues.length, 255)
    if (maxValues === 0) return null

    let vals = 0
    let granulePosition = -1
    let shouldFlush = force

    if (!this.writesHaveStarted) {
      // The identification packet must be alone on the first page.
      granulePosition = 0
      for (vals = 0; vals < maxValues; vals++) {
        if (((this.lacingValues[vals] ?? 0) & 0xff) < 255) {
          vals++
          break
        }
      }
    } else {
      let accumulated = 0
      let packetsDone = 0
      let packetsJustDone = 0
      for (vals = 0; vals < maxValues; vals++) {
        if (accumulated > bufferSize && packetsJustDone >= 4) {
          shouldFlush = true
          break
        }
        accumulated += (this.lacingValues[vals] ?? 0) & 0xff
        if (((this.lacingValues[vals] ?? 0) & 0xff) < 255) {
          granulePosition = this.granuleValues[vals] ?? 0
          packetsJustDone = ++packetsDone
        } else {
          packetsJustDone = 0
        }
      }
      if (vals === 255) shouldFlush = true
    }

    if (!shouldFlush) return null

    const header = new Uint8Array(vals + 27)
    header.set([0x4f, 0x67, 0x67, 0x53], 0)
    header[4] = 0

    let flags = 0
    if (((this.lacingValues[0] ?? 0) & 0x100) === 0) flags |= 0x01
    if (!this.writesHaveStarted) flags |= 0x02
    if (this.finished && this.lacingValues.length === vals) flags |= 0x04
    header[5] = flags

    this.writesHaveStarted = true

    writeInt64LE(header, 6, granulePosition)
    writeInt32LE(header, 14, this.serialNumber)
    writeInt32LE(header, 18, this.pageNumber++)

    let bodyBytes = 0
    header[26] = vals & 0xff
    for (let i = 0; i < vals; i++) {
      const value = (this.lacingValues[i] ?? 0) & 0xff
      header[i + 27] = value
      bodyBytes += value
    }

    const body = Uint8Array.from(this.body.slice(0, bodyBytes))
    const checksum = crc32(header, body)
    header[22] = checksum & 0xff
    header[23] = (checksum >>> 8) & 0xff
    header[24] = (checksum >>> 16) & 0xff
    header[25] = (checksum >>> 24) & 0xff

    this.lacingValues.splice(0, vals)
    this.granuleValues.splice(0, vals)
    this.body = this.body.slice(bodyBytes)

    return { header, body }
  }
}

function writeInt32LE(target: Uint8Array, offset: number, value: number): void {
  let remaining = value
  for (let i = 0; i < 4; i++) {
    target[offset + i] = remaining & 0xff
    remaining >>= 8
  }
}

function writeInt64LE(target: Uint8Array, offset: number, value: number): void {
  let remaining = BigInt(value)
  for (let i = 0; i < 8; i++) {
    target[offset + i] = Number(remaining & 0xffn)
    remaining >>= 8n
  }
}
