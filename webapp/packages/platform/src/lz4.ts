/**
 * LZ4 block decompression.
 *
 * Unity compresses AssetBundle storage blocks with LZ4. A real Mansions of
 * Madness content cache holds 5,373 LZ4 blocks against 770 uncompressed ones,
 * so this is the common case rather than an edge one.
 *
 * This is the *block* format, not the framed one: no magic, no checksums, just
 * a sequence of literals and back-references, with the uncompressed length
 * known in advance from the bundle's block table.
 *
 * Written rather than taken from a dependency because it is about fifty lines
 * and because it can be verified exhaustively — `tools/differential/bundle`
 * checks it against the real decompressor over every block in the cache.
 */

export class Lz4Error extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Lz4Error'
  }
}

/**
 * Decompresses one LZ4 block.
 *
 * `uncompressedSize` comes from the container. The result is exactly that
 * long; anything else means the input is corrupt and is reported rather than
 * returned short.
 */
export function decompressLz4Block(input: Uint8Array, uncompressedSize: number): Uint8Array {
  const output = new Uint8Array(uncompressedSize)
  let source = 0
  let destination = 0

  while (source < input.length) {
    const token = input[source++] ?? 0

    // High nibble: literal run length, extended by 255-valued bytes.
    let literalLength = token >>> 4
    if (literalLength === 0x0f) {
      let extra: number
      do {
        extra = input[source++] ?? 0
        literalLength += extra
      } while (extra === 0xff && source < input.length)
    }

    if (source + literalLength > input.length || destination + literalLength > output.length) {
      throw new Lz4Error('Literal run runs past the end of the block')
    }
    output.set(input.subarray(source, source + literalLength), destination)
    source += literalLength
    destination += literalLength

    // The final sequence is literals only, with no match to follow.
    if (source >= input.length) break

    const offset = (input[source] ?? 0) | ((input[source + 1] ?? 0) << 8)
    source += 2
    if (offset === 0) throw new Lz4Error('Match offset of zero')
    if (offset > destination) throw new Lz4Error('Match reaches before the start of the block')

    // Low nibble: match length, biased by the four-byte minimum.
    let matchLength = token & 0x0f
    if (matchLength === 0x0f) {
      let extra: number
      do {
        extra = input[source++] ?? 0
        matchLength += extra
      } while (extra === 0xff && source < input.length)
    }
    matchLength += 4

    if (destination + matchLength > output.length) {
      throw new Lz4Error('Match runs past the end of the block')
    }

    // Copied one byte at a time on purpose: an overlapping match, where the
    // offset is shorter than the length, is how LZ4 encodes runs, and a bulk
    // copy would read the pre-copy bytes instead of the ones just written.
    let from = destination - offset
    for (let i = 0; i < matchLength; i++) {
      output[destination++] = output[from++] ?? 0
    }
  }

  if (destination !== uncompressedSize) {
    throw new Lz4Error(`Expected ${uncompressedSize} bytes, produced ${destination}`)
  }
  return output
}
