/**
 * Tests for the DDS/DXT decoder (T-001, T-014).
 *
 * The bulk of the assurance is `tools/differential/dds`, which decodes 468
 * real textures from a licensed Mansions of Madness install and compares them
 * against Pillow pixel for pixel. These cover the shapes that corpus does not
 * reach — and one of them exists precisely because a mutation test showed the
 * real content never exercises it.
 */

import { describe, expect, it } from 'vitest'

import {
  DdsError,
  TextureFormat,
  decodeDds,
  decodeDxt1,
  decodeDxt5,
  decodeUnityTexture,
} from '../src/dds.js'

/** Builds a DDS file around a payload. */
function dds(options: {
  width: number
  height: number
  payload: Uint8Array
  fourCC?: string
  bitCount?: number
  masks?: [number, number, number, number]
}): Uint8Array {
  const bytes = new Uint8Array(128 + options.payload.length)
  const view = new DataView(bytes.buffer)

  view.setUint32(0, 0x20534444, true)
  view.setUint32(4, 124, true)
  view.setUint32(12, options.height, true)
  view.setUint32(16, options.width, true)

  if (options.fourCC !== undefined) {
    view.setUint32(76 + 4, 0x4, true)
    const cc = options.fourCC
    view.setUint32(
      76 + 8,
      cc.charCodeAt(0) |
        (cc.charCodeAt(1) << 8) |
        (cc.charCodeAt(2) << 16) |
        (cc.charCodeAt(3) << 24),
      true,
    )
  } else {
    view.setUint32(76 + 4, 0x41, true)
    view.setUint32(76 + 12, options.bitCount ?? 32, true)
    const [r, g, b, a] = options.masks ?? [0x00ff0000, 0x0000ff00, 0x000000ff, 0xff000000]
    view.setUint32(76 + 16, r, true)
    view.setUint32(76 + 20, g, true)
    view.setUint32(76 + 24, b, true)
    view.setUint32(76 + 28, a, true)
  }

  bytes.set(options.payload, 128)
  return bytes
}

/** One BC1 block: two endpoints and sixteen 2-bit indices. */
function bc1Block(c0: number, c1: number, indices: number): Uint8Array {
  const block = new Uint8Array(8)
  const view = new DataView(block.buffer)
  view.setUint16(0, c0, true)
  view.setUint16(2, c1, true)
  view.setUint32(4, indices, true)
  return block
}

const RED_565 = 0xf800
const BLUE_565 = 0x001f

describe('decodeDds', () => {
  it('rejects something that is not a DDS file', () => {
    expect(() => decodeDds(new Uint8Array(200))).toThrow(DdsError)
  })

  it('rejects a file too short to hold a header', () => {
    expect(() => decodeDds(new Uint8Array(8))).toThrow(/Too short/)
  })

  it('rejects a compressed format it cannot decode', () => {
    expect(() =>
      decodeDds(dds({ width: 4, height: 4, fourCC: 'DXT3', payload: new Uint8Array(16) })),
    ).toThrow(/Unsupported compressed format: DXT3/)
  })

  // Three textures in a real install are header-only, and the C# writes them
  // out anyway. Decoding must yield nothing rather than throwing.
  it('decodes a header-only texture to an empty image', () => {
    const image = decodeDds(
      dds({ width: 0, height: 0, fourCC: 'DXT5', payload: new Uint8Array(0) }),
    )

    expect(image.rgba).toHaveLength(0)
  })

  it('reads dimensions and FourCC from the header', () => {
    const image = decodeDds(
      dds({ width: 4, height: 4, fourCC: 'DXT1', payload: bc1Block(RED_565, BLUE_565, 0) }),
    )

    expect(image).toMatchObject({ width: 4, height: 4, fourCC: 'DXT1' })
  })
})

describe('decodeDxt1', () => {
  it('decodes the first endpoint colour', () => {
    const rgba = decodeDxt1(bc1Block(RED_565, BLUE_565, 0), 4, 4)

    expect([...rgba.slice(0, 4)]).toEqual([255, 0, 0, 255])
  })

  it('decodes the second endpoint colour', () => {
    // Every index 1.
    const rgba = decodeDxt1(bc1Block(RED_565, BLUE_565, 0x55555555), 4, 4)

    expect([...rgba.slice(0, 4)]).toEqual([0, 0, 255, 255])
  })

  /**
   * The mode bit. When `color0 > color1` there are four opaque colours; when
   * not, index 3 is transparent black.
   *
   * A mutation test on the real 468-texture corpus showed **zero** failures
   * for getting this comparison wrong — the content simply never pairs equal
   * endpoints with index 3. That is a gap in the corpus, not evidence the
   * branch is unused, so it is pinned here directly.
   */
  it('treats index 3 as opaque in four-colour mode', () => {
    // c0 > c1, every index 3.
    const rgba = decodeDxt1(bc1Block(RED_565, BLUE_565, 0xffffffff), 4, 4)

    expect(rgba[3]).toBe(255)
  })

  it('treats index 3 as transparent in three-colour mode', () => {
    // c0 < c1, every index 3.
    const rgba = decodeDxt1(bc1Block(BLUE_565, RED_565, 0xffffffff), 4, 4)

    expect([...rgba.slice(0, 4)]).toEqual([0, 0, 0, 0])
  })

  it('is in three-colour mode when the endpoints are equal', () => {
    const rgba = decodeDxt1(bc1Block(RED_565, RED_565, 0xffffffff), 4, 4)

    expect([...rgba.slice(0, 4)]).toEqual([0, 0, 0, 0])
  })

  it('expands 5-bit channels by replicating their high bits', () => {
    // 0x1f is full red in 5 bits, which must reach 255 rather than 248.
    const rgba = decodeDxt1(bc1Block(0xf800, 0x0000, 0), 4, 4)

    expect(rgba[0]).toBe(255)
  })

  it('ignores pixels outside a partial block', () => {
    const rgba = decodeDxt1(bc1Block(RED_565, BLUE_565, 0), 2, 2)

    expect(rgba).toHaveLength(2 * 2 * 4)
  })

  it('tolerates truncated data rather than reading past the end', () => {
    expect(() => decodeDxt1(new Uint8Array(3), 4, 4)).not.toThrow()
  })
})

describe('decodeDxt5', () => {
  /** A BC3 block: 8 bytes of alpha, then a BC1 colour block. */
  function bc3Block(a0: number, a1: number, alphaIndices: bigint, colour: Uint8Array): Uint8Array {
    const block = new Uint8Array(16)
    block[0] = a0
    block[1] = a1
    for (let i = 0; i < 6; i++) {
      block[2 + i] = Number((alphaIndices >> BigInt(8 * i)) & 0xffn)
    }
    block.set(colour, 8)
    return block
  }

  it('takes alpha from the alpha block, not the colour block', () => {
    const rgba = decodeDxt5(bc3Block(0x40, 0xff, 0n, bc1Block(RED_565, BLUE_565, 0)), 4, 4)

    expect([...rgba.slice(0, 4)]).toEqual([255, 0, 0, 0x40])
  })

  it('uses the second alpha endpoint for index 1', () => {
    // Every 3-bit alpha index 1: 0b001 repeated.
    const indices = 0o1111111111111111n & 0xffffffffffffn
    const rgba = decodeDxt5(bc3Block(0x40, 0xff, indices, bc1Block(RED_565, BLUE_565, 0)), 4, 4)

    expect(rgba[3]).toBe(0xff)
  })

  /**
   * The colour half of a BC3 block is always in four-colour mode, even when
   * `color0 <= color1` — where the same bytes in a BC1 block would mean
   * punch-through transparency.
   */
  it('never uses punch-through in the colour half', () => {
    const rgba = decodeDxt5(bc3Block(0xff, 0xff, 0n, bc1Block(BLUE_565, RED_565, 0xffffffff)), 4, 4)

    expect(rgba[3]).toBe(0xff)
    expect([...rgba.slice(0, 3)]).not.toEqual([0, 0, 0])
  })

  it('tolerates truncated data', () => {
    expect(() => decodeDxt5(new Uint8Array(5), 4, 4)).not.toThrow()
  })
})

describe('uncompressed formats', () => {
  it('decodes BGRA32 through its channel masks', () => {
    // One pixel, stored blue-green-red-alpha.
    const payload = Uint8Array.from([0x11, 0x22, 0x33, 0x44])
    const image = decodeDds(dds({ width: 1, height: 1, payload }))

    expect([...image.rgba]).toEqual([0x33, 0x22, 0x11, 0x44])
  })

  it('decodes 24-bit colour with no alpha channel as opaque', () => {
    const payload = Uint8Array.from([0x11, 0x22, 0x33])
    const image = decodeDds(
      dds({
        width: 1,
        height: 1,
        payload,
        bitCount: 24,
        masks: [0x00ff0000, 0x0000ff00, 0x000000ff, 0],
      }),
    )

    expect([...image.rgba]).toEqual([0x33, 0x22, 0x11, 255])
  })

  it('decodes Alpha8 as black with the byte as alpha', () => {
    const payload = Uint8Array.from([0x00, 0x7f, 0xff, 0x10])
    const image = decodeDds(
      dds({ width: 4, height: 1, payload, bitCount: 8, masks: [0, 0, 0, 0xff] }),
    )

    expect([...image.rgba.slice(0, 8)]).toEqual([0, 0, 0, 0x00, 0, 0, 0, 0x7f])
  })

  it('rejects a bit count it cannot handle', () => {
    expect(() =>
      decodeDds(dds({ width: 1, height: 1, payload: new Uint8Array(8), bitCount: 64 })),
    ).toThrow(/Unsupported bit count/)
  })
})

describe('decodeUnityTexture', () => {
  // The direct path, which the import uses. It avoids the DDS round trip and
  // the R/B swap the C# needs to satisfy DDS's BGRA convention.
  it('decodes RGBA32 in Unity order, with no channel swap', () => {
    const rgba = decodeUnityTexture(TextureFormat.RGBA32, 1, 1, Uint8Array.from([1, 2, 3, 4]))

    expect([...rgba]).toEqual([1, 2, 3, 4])
  })

  it('decodes BGRA32 into RGBA', () => {
    const rgba = decodeUnityTexture(TextureFormat.BGRA32, 1, 1, Uint8Array.from([1, 2, 3, 4]))

    expect([...rgba]).toEqual([3, 2, 1, 4])
  })

  it('decodes ARGB32 into RGBA', () => {
    const rgba = decodeUnityTexture(TextureFormat.ARGB32, 1, 1, Uint8Array.from([1, 2, 3, 4]))

    expect([...rgba]).toEqual([2, 3, 4, 1])
  })

  it('decodes RGB24 as opaque', () => {
    const rgba = decodeUnityTexture(TextureFormat.RGB24, 1, 1, Uint8Array.from([1, 2, 3]))

    expect([...rgba]).toEqual([1, 2, 3, 255])
  })

  it('decodes Alpha8 as black with the byte as alpha', () => {
    const rgba = decodeUnityTexture(TextureFormat.Alpha8, 2, 1, Uint8Array.from([0x40, 0xff]))

    expect([...rgba]).toEqual([0, 0, 0, 0x40, 0, 0, 0, 0xff])
  })

  it('decodes a DXT1 block', () => {
    const block = Uint8Array.from([0x00, 0xf8, 0x1f, 0x00, 0, 0, 0, 0])
    const rgba = decodeUnityTexture(TextureFormat.DXT1, 4, 4, block)

    expect(rgba).toHaveLength(4 * 4 * 4)
    expect([...rgba.slice(0, 4)]).toEqual([255, 0, 0, 255])
  })

  it('decodes a DXT5 block', () => {
    const block = new Uint8Array(16)
    block[0] = 0xff
    block.set([0x00, 0xf8, 0x1f, 0x00], 8)
    const rgba = decodeUnityTexture(TextureFormat.DXT5, 4, 4, block)

    expect([...rgba.slice(0, 4)]).toEqual([255, 0, 0, 255])
  })

  it('returns nothing for a zero-sized texture', () => {
    expect(decodeUnityTexture(TextureFormat.DXT5, 0, 0, new Uint8Array(0))).toHaveLength(0)
  })

  it('names the format it cannot handle, rather than mangling it', () => {
    expect(() => decodeUnityTexture(99, 4, 4, new Uint8Array(16))).toThrow(
      /Unsupported Unity texture format: 99/,
    )
  })

  it('stops at the end of a truncated payload', () => {
    const rgba = decodeUnityTexture(TextureFormat.RGBA32, 4, 4, Uint8Array.from([1, 2, 3, 4]))

    expect(rgba).toHaveLength(4 * 4 * 4)
    expect([...rgba.slice(0, 4)]).toEqual([1, 2, 3, 4])
    expect([...rgba.slice(4, 8)]).toEqual([0, 0, 0, 0])
  })
})
