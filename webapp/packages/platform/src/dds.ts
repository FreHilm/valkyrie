/**
 * DDS parsing and block decompression, for the FFG asset import.
 *
 * `FetchContent.ExportTexture` writes Unity's raw texture data into a DDS
 * container with a hand-built header. Browsers cannot decode DDS, so the
 * import has to do it: parse the header, decompress the blocks, and hand back
 * RGBA the browser can put on a canvas or re-encode.
 *
 * Which formats matter is measured rather than assumed. A real Mansions of
 * Madness 2.1.6 install (Unity 2022.3.62f2) holds 733 textures:
 *
 *     DXT5    355     DXT1    300     RGBA32   66
 *     Alpha8    8     RGB24     4
 *
 * The task notes and the ADR both expected PVR as well; PVR is the mobile
 * build's format and does not appear in a desktop install. The PVR path is
 * therefore not implemented here — see docs/ffg-import.md.
 */

/** `Texture2D.m_TextureFormat` values that appear in a desktop install. */
export const TextureFormat = {
  Alpha8: 1,
  RGB24: 3,
  RGBA32: 4,
  ARGB32: 5,
  BGRA32: 14,
  DXT1: 10,
  DXT5: 12,
} as const

export interface DdsImage {
  width: number
  height: number
  /** FourCC when block-compressed ("DXT1"/"DXT5"), or "" when uncompressed. */
  fourCC: string
  /** Straight RGBA, 4 bytes per pixel, top-left origin. */
  rgba: Uint8Array
}

const DDS_MAGIC = 0x20534444
/** Offsets into the 124-byte header, past the 4-byte magic. */
const HEADER_SIZE = 124

export class DdsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DdsError'
  }
}

/**
 * Decodes a DDS file to RGBA.
 *
 * Only the top mip level is decoded — the app draws sprites at their native
 * size and never samples a mip chain.
 */
export function decodeDds(bytes: Uint8Array): DdsImage {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.byteLength < 4 + HEADER_SIZE) throw new DdsError('Too short to be a DDS file')
  if (view.getUint32(0, true) !== DDS_MAGIC) throw new DdsError('Not a DDS file')

  const height = view.getUint32(12, true)
  const width = view.getUint32(16, true)

  // The DDS_PIXELFORMAT block starts at absolute offset 76: the 4-byte magic
  // plus 72 bytes of header before it. Its own dwSize comes first, so the
  // flags are at +4 and the FourCC at +8.
  const PF = 76
  const pfFlags = view.getUint32(PF + 4, true)
  const fourCCValue = view.getUint32(PF + 8, true)
  const rgbBitCount = view.getUint32(PF + 12, true)
  const masks = {
    r: view.getUint32(PF + 16, true),
    g: view.getUint32(PF + 20, true),
    b: view.getUint32(PF + 24, true),
    a: view.getUint32(PF + 28, true),
  }

  const data = bytes.subarray(4 + HEADER_SIZE)
  const DDPF_FOURCC = 0x4

  if ((pfFlags & DDPF_FOURCC) !== 0) {
    const fourCC = String.fromCharCode(
      fourCCValue & 0xff,
      (fourCCValue >>> 8) & 0xff,
      (fourCCValue >>> 16) & 0xff,
      (fourCCValue >>> 24) & 0xff,
    )
    if (fourCC === 'DXT1') return { width, height, fourCC, rgba: decodeDxt1(data, width, height) }
    if (fourCC === 'DXT5') return { width, height, fourCC, rgba: decodeDxt5(data, width, height) }
    throw new DdsError(`Unsupported compressed format: ${fourCC}`)
  }

  return {
    width,
    height,
    fourCC: '',
    rgba: decodeUncompressed(data, width, height, rgbBitCount, masks),
  }
}

/** Expands a 5- or 6-bit channel to 8 bits by replicating its high bits. */
function expand5(value: number): number {
  return (value << 3) | (value >>> 2)
}
function expand6(value: number): number {
  return (value << 2) | (value >>> 4)
}

/**
 * The four colours of a BC1-style colour block.
 *
 * Held as plain numbers rather than arrays: this runs once per 4x4 block over
 * hundreds of megabytes, and array indexing under `noUncheckedIndexedAccess`
 * adds an undefined check to every read that can never fire.
 */
interface ColourBlock {
  r0: number
  g0: number
  b0: number
  r1: number
  g1: number
  b1: number
  r2: number
  g2: number
  b2: number
  r3: number
  g3: number
  b3: number
  a3: number
}

/**
 * Reads the shared 8-byte colour half of a BC1 or BC3 block.
 *
 * `forceFourColour` is what distinguishes them: in BC1 the endpoint order
 * selects the mode, and when `color0 <= color1` the fourth index is
 * transparent black. A BC3 block's colour half is always in four-colour mode.
 * Getting that backwards is the classic BC1 bug, and it only shows on textures
 * that actually use the punch-through mode.
 */
function readColourBlock(view: DataView, offset: number, forceFourColour: boolean): ColourBlock {
  const c0 = view.getUint16(offset, true)
  const c1 = view.getUint16(offset + 2, true)

  const r0 = expand5(c0 >>> 11)
  const g0 = expand6((c0 >>> 5) & 0x3f)
  const b0 = expand5(c0 & 0x1f)
  const r1 = expand5(c1 >>> 11)
  const g1 = expand6((c1 >>> 5) & 0x3f)
  const b1 = expand5(c1 & 0x1f)

  if (c0 > c1 || forceFourColour) {
    return {
      r0,
      g0,
      b0,
      r1,
      g1,
      b1,
      r2: (2 * r0 + r1) / 3,
      g2: (2 * g0 + g1) / 3,
      b2: (2 * b0 + b1) / 3,
      r3: (r0 + 2 * r1) / 3,
      g3: (g0 + 2 * g1) / 3,
      b3: (b0 + 2 * b1) / 3,
      a3: 255,
    }
  }

  return {
    r0,
    g0,
    b0,
    r1,
    g1,
    b1,
    r2: (r0 + r1) / 2,
    g2: (g0 + g1) / 2,
    b2: (b0 + b1) / 2,
    r3: 0,
    g3: 0,
    b3: 0,
    a3: 0,
  }
}

/** Writes one pixel from a colour block, given its 2-bit index. */
function putColour(
  rgba: Uint8Array,
  at: number,
  block: ColourBlock,
  index: number,
  alpha: number,
): void {
  if (index === 0) {
    rgba[at] = block.r0
    rgba[at + 1] = block.g0
    rgba[at + 2] = block.b0
  } else if (index === 1) {
    rgba[at] = block.r1
    rgba[at + 1] = block.g1
    rgba[at + 2] = block.b1
  } else if (index === 2) {
    rgba[at] = block.r2
    rgba[at + 1] = block.g2
    rgba[at + 2] = block.b2
  } else {
    rgba[at] = block.r3
    rgba[at + 1] = block.g3
    rgba[at + 2] = block.b3
  }
  rgba[at + 3] = alpha
}

/** BC1. Eight bytes per 4x4 block: two endpoints, then sixteen 2-bit indices. */
export function decodeDxt1(data: Uint8Array, width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4)
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const blocksWide = Math.max(1, (width + 3) >> 2)
  const blocksHigh = Math.max(1, (height + 3) >> 2)

  for (let by = 0; by < blocksHigh; by++) {
    for (let bx = 0; bx < blocksWide; bx++) {
      const offset = (by * blocksWide + bx) * 8
      if (offset + 8 > data.byteLength) continue

      const block = readColourBlock(view, offset, false)
      const indices = view.getUint32(offset + 4, true)

      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px
          const y = by * 4 + py
          if (x >= width || y >= height) continue

          const index = (indices >>> (2 * (py * 4 + px))) & 0x3
          putColour(rgba, (y * width + x) * 4, block, index, index === 3 ? block.a3 : 255)
        }
      }
    }
  }
  return rgba
}

/**
 * BC3: an 8-byte interpolated-alpha block, then a BC1 colour block that is
 * always in four-colour mode regardless of endpoint order.
 */
export function decodeDxt5(data: Uint8Array, width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4)
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const blocksWide = Math.max(1, (width + 3) >> 2)
  const blocksHigh = Math.max(1, (height + 3) >> 2)
  const alpha = new Uint8Array(8)

  for (let by = 0; by < blocksHigh; by++) {
    for (let bx = 0; bx < blocksWide; bx++) {
      const offset = (by * blocksWide + bx) * 16
      if (offset + 16 > data.byteLength) continue

      const a0 = view.getUint8(offset)
      const a1 = view.getUint8(offset + 1)
      alpha[0] = a0
      alpha[1] = a1
      if (a0 > a1) {
        for (let i = 1; i < 7; i++) alpha[i + 1] = ((7 - i) * a0 + i * a1) / 7
      } else {
        for (let i = 1; i < 5; i++) alpha[i + 1] = ((5 - i) * a0 + i * a1) / 5
        alpha[6] = 0
        alpha[7] = 255
      }

      // Six bytes of 3-bit indices, as two 24-bit little-endian halves.
      const alphaLow =
        view.getUint8(offset + 2) |
        (view.getUint8(offset + 3) << 8) |
        (view.getUint8(offset + 4) << 16)
      const alphaHigh =
        view.getUint8(offset + 5) |
        (view.getUint8(offset + 6) << 8) |
        (view.getUint8(offset + 7) << 16)

      const block = readColourBlock(view, offset + 8, true)
      const indices = view.getUint32(offset + 12, true)

      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px
          const y = by * 4 + py
          if (x >= width || y >= height) continue

          const pixel = py * 4 + px
          const index = (indices >>> (2 * pixel)) & 0x3
          const alphaIndex =
            pixel < 8 ? (alphaLow >>> (3 * pixel)) & 0x7 : (alphaHigh >>> (3 * (pixel - 8))) & 0x7

          putColour(rgba, (y * width + x) * 4, block, index, alpha[alphaIndex] as number)
        }
      }
    }
  }
  return rgba
}

/** Bit position and width of a channel mask, for the uncompressed formats. */
function maskInfo(mask: number): { shift: number; scale: number } {
  if (mask === 0) return { shift: 0, scale: 0 }
  let shift = 0
  let value = mask
  while ((value & 1) === 0) {
    value >>>= 1
    shift++
  }
  let bits = 0
  while ((value & 1) === 1) {
    value >>>= 1
    bits++
  }
  return { shift, scale: bits === 0 ? 0 : 255 / ((1 << bits) - 1) }
}

function decodeUncompressed(
  data: Uint8Array,
  width: number,
  height: number,
  rgbBitCount: number,
  masks: { r: number; g: number; b: number; a: number },
): Uint8Array {
  const bytesPerPixel = rgbBitCount >>> 3
  if (bytesPerPixel < 1 || bytesPerPixel > 4) {
    throw new DdsError(`Unsupported bit count: ${rgbBitCount}`)
  }

  const rgba = new Uint8Array(width * height * 4)
  const info = {
    r: maskInfo(masks.r),
    g: maskInfo(masks.g),
    b: maskInfo(masks.b),
    a: maskInfo(masks.a),
  }

  for (let i = 0; i < width * height; i++) {
    const at = i * bytesPerPixel
    if (at + bytesPerPixel > data.byteLength) break

    let pixel = 0
    for (let byte = 0; byte < bytesPerPixel; byte++) {
      pixel |= (data[at + byte] ?? 0) << (8 * byte)
    }
    pixel >>>= 0

    const out = i * 4
    rgba[out] = channel(pixel, masks.r, info.r)
    rgba[out + 1] = channel(pixel, masks.g, info.g)
    rgba[out + 2] = channel(pixel, masks.b, info.b)
    rgba[out + 3] = masks.a === 0 ? 255 : channel(pixel, masks.a, info.a)
  }
  return rgba
}

function channel(pixel: number, mask: number, info: { shift: number; scale: number }): number {
  if (mask === 0) return 0
  return Math.round(((pixel & mask) >>> info.shift) * info.scale)
}

/**
 * Decodes a Unity texture payload straight to RGBA.
 *
 * The Unity build routes textures through a DDS container: `ExportTexture`
 * builds a header, swaps R and B so the bytes suit DDS's BGRA convention, and
 * writes a file that Unity then reads back. The web port has no reason to do
 * any of that — it reads the payload out of the asset file and decodes it
 * here, so the swizzle and the round trip both disappear.
 *
 * Formats are Unity's `TextureFormat` values. The five in this list are what a
 * real Mansions of Madness install contains; anything else throws with the
 * value, so an unexpected format is reported rather than silently mangled.
 */
export function decodeUnityTexture(
  format: number,
  width: number,
  height: number,
  data: Uint8Array,
): Uint8Array {
  if (width === 0 || height === 0) return new Uint8Array(0)

  switch (format) {
    case TextureFormat.DXT1:
      return decodeDxt1(data, width, height)
    case TextureFormat.DXT5:
      return decodeDxt5(data, width, height)
    case TextureFormat.RGBA32:
      return expandChannels(data, width, height, 4, [0, 1, 2, 3])
    case TextureFormat.ARGB32:
      return expandChannels(data, width, height, 4, [1, 2, 3, 0])
    case TextureFormat.BGRA32:
      return expandChannels(data, width, height, 4, [2, 1, 0, 3])
    case TextureFormat.RGB24:
      return expandChannels(data, width, height, 3, [0, 1, 2, -1])
    case TextureFormat.Alpha8:
      return expandChannels(data, width, height, 1, [-1, -1, -1, 0])
    default:
      throw new DdsError(`Unsupported Unity texture format: ${format}`)
  }
}

/**
 * Rearranges interleaved channels into RGBA.
 *
 * `order` gives the source index for each of R, G, B, A; `-1` means the
 * channel is absent, which reads as 0 for colour and 255 for alpha.
 */
function expandChannels(
  data: Uint8Array,
  width: number,
  height: number,
  stride: number,
  order: readonly [number, number, number, number],
): Uint8Array {
  const rgba = new Uint8Array(width * height * 4)

  for (let i = 0; i < width * height; i++) {
    const from = i * stride
    const to = i * 4
    if (from + stride > data.byteLength) break

    for (let channel = 0; channel < 4; channel++) {
      const source = order[channel] ?? -1
      if (source === -1) {
        rgba[to + channel] = channel === 3 ? 255 : 0
      } else {
        rgba[to + channel] = data[from + source] ?? 0
      }
    }
  }
  return rgba
}
