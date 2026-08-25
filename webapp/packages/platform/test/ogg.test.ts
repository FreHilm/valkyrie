/**
 * Tests for the Ogg muxer (T-020).
 *
 * The real assurance is `tools/differential/ogg`, which compares this against
 * the vendored encoder byte for byte. These cover the shape of the output and
 * the two deviations, so a reader can see what it produces without running
 * dotnet.
 */

import { describe, expect, it } from 'vitest'

import { OggStream, VENDOR_STRING, buildCommentPacket, buildInfoPacket } from '../src/ogg.js'

const ascii = (bytes: Uint8Array, start: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(start, start + length))

describe('buildInfoPacket', () => {
  it('starts with the identification packet type and the vorbis marker', () => {
    const packet = buildInfoPacket({ channels: 2, sampleRate: 44100 })

    expect(packet[0]).toBe(0x01)
    expect(ascii(packet, 1, 6)).toBe('vorbis')
  })

  it('carries the channel count and sample rate', () => {
    const packet = buildInfoPacket({ channels: 2, sampleRate: 44100 })
    const view = new DataView(packet.buffer, packet.byteOffset)

    expect(packet[11]).toBe(2)
    expect(view.getUint32(12, true)).toBe(44100)
  })

  it('is the 30 bytes a Vorbis identification header should be', () => {
    expect(buildInfoPacket({ channels: 1, sampleRate: 8000 })).toHaveLength(30)
  })
})

describe('buildCommentPacket', () => {
  it('starts with the comment packet type and the vendor string', () => {
    const packet = buildCommentPacket([])

    expect(packet[0]).toBe(0x03)
    expect(ascii(packet, 1, 6)).toBe('vorbis')
    expect(ascii(packet, 11, VENDOR_STRING.length)).toBe(VENDOR_STRING)
  })

  it('writes the loop tags FSBExport emits', () => {
    const packet = buildCommentPacket(['LOOP_START=1000', 'LOOP_END=200000'])
    const text = ascii(packet, 0, packet.length)

    expect(text).toContain('LOOP_START=1000')
    expect(text).toContain('LOOP_END=200000')
  })

  // The C# writes comment.Length, a UTF-16 code-unit count, as a byte count.
  it('measures a comment in UTF-8 bytes (DEVIATION)', () => {
    const packet = buildCommentPacket(['TITLE=café'])
    const view = new DataView(packet.buffer, packet.byteOffset)
    const lengthAt = 7 + 4 + VENDOR_STRING.length + 4

    expect(view.getUint32(lengthAt, true)).toBe(new TextEncoder().encode('TITLE=café').length)
  })
})

describe('OggStream', () => {
  const packet = (length: number, first = 0): Uint8Array => {
    const bytes = new Uint8Array(length)
    bytes[0] = first
    return bytes
  }

  it('puts the identification packet alone on the first page', () => {
    const stream = new OggStream(1)
    stream.packetIn({
      data: buildInfoPacket({ channels: 2, sampleRate: 44100 }),
      granulePosition: 0,
    })
    stream.packetIn({ data: packet(100), granulePosition: 0 })

    const page = stream.pageOut(true)

    expect(page?.body).toHaveLength(30)
    // 0x02 is the beginning-of-stream flag.
    expect(page?.header[5]).toBe(0x02)
  })

  it('writes the OggS capture pattern and the serial number', () => {
    const stream = new OggStream(0x12345678)
    stream.packetIn({ data: packet(10), granulePosition: 0 })
    const page = stream.pageOut(true)

    expect(ascii(page?.header ?? new Uint8Array(), 0, 4)).toBe('OggS')
    const view = new DataView((page?.header ?? new Uint8Array()).buffer)
    expect(view.getUint32(14, true)).toBe(0x12345678)
  })

  it('marks the last page end-of-stream', () => {
    const stream = new OggStream(1)
    stream.packetIn({ data: packet(10), granulePosition: 0 })
    stream.pageOut(true)
    stream.packetIn({ data: packet(10), granulePosition: 5, endOfStream: true })
    const page = stream.pageOut(true)

    expect((page?.header[5] ?? 0) & 0x04).toBe(0x04)
  })

  // A packet that is an exact multiple of 255 needs a trailing zero segment,
  // or a reader cannot tell it ended. The mutation test for this is in the
  // differential harness.
  it.each([
    [254, 1],
    [255, 2],
    [256, 2],
    [510, 3],
  ])('laces a %s-byte packet into %s segments', (size, segments) => {
    const stream = new OggStream(1)
    stream.packetIn({ data: packet(size), granulePosition: 0 })
    const page = stream.pageOut(true)

    expect(page?.header[26]).toBe(segments)
  })

  it('returns null when there is nothing buffered', () => {
    expect(new OggStream(1).pageOut(true)).toBeNull()
  })

  it('numbers pages in sequence', () => {
    const stream = new OggStream(1)
    const numbers: number[] = []
    for (let i = 0; i < 3; i++) {
      stream.packetIn({ data: packet(10), granulePosition: i })
      const page = stream.pageOut(true)
      const view = new DataView((page?.header ?? new Uint8Array()).buffer)
      numbers.push(view.getUint32(18, true))
    }

    expect(numbers).toEqual([0, 1, 2])
  })
})
