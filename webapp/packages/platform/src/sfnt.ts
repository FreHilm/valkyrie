/**
 * Just enough of a font's character map to answer one question: does this face
 * carry the game's icons?
 *
 * A Mansions install embeds six fonts, and one of them — the Korean fallback —
 * is 16 MB. The port needs exactly one thing from any of them: the private-use
 * range the quest text writes its icons in. Importing the rest would spend
 * tens of megabytes of a player's storage on faces nothing will ever ask for.
 *
 * So this reads the `cmap` table and nothing else. It is not a font parser and
 * should not become one.
 */

/** The two `cmap` subtable formats a modern font uses for Unicode. */
const FORMAT_SEGMENTED = 4
const FORMAT_SEGMENTED_LONG = 12

/**
 * Whether the face covers any codepoint in `[from, to]`.
 *
 * Returns false rather than throwing for anything it cannot read: a font this
 * cannot make sense of is one the caller should skip, and an exception here
 * would fail an import over a file that is merely unusual.
 */
export function coversCodepoints(data: Uint8Array, from: number, to: number): boolean {
  try {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const cmap = findTable(view, data.length, 'cmap')
    if (cmap === null) return false

    const subtables = view.getUint16(cmap + 2, false)
    for (let i = 0; i < subtables; i++) {
      const record = cmap + 4 + i * 8
      if (record + 8 > data.length) return false
      const offset = cmap + view.getUint32(record + 4, false)
      if (offset + 4 > data.length) continue
      if (subtableCovers(view, data.length, offset, from, to)) return true
    }
  } catch {
    // A malformed table is a font to skip, not an import to fail.
    return false
  }
  return false
}

/** Locates a table in the sfnt directory by its four-character tag. */
function findTable(view: DataView, length: number, tag: string): number | null {
  if (length < 12) return null
  const wanted =
    (tag.charCodeAt(0) << 24) |
    (tag.charCodeAt(1) << 16) |
    (tag.charCodeAt(2) << 8) |
    tag.charCodeAt(3)

  const tables = view.getUint16(4, false)
  for (let i = 0; i < tables; i++) {
    const record = 12 + i * 16
    if (record + 16 > length) return null
    if (view.getUint32(record, false) >>> 0 === wanted >>> 0) {
      const offset = view.getUint32(record + 8, false)
      return offset < length ? offset : null
    }
  }
  return null
}

/** Whether one `cmap` subtable maps anything in the range. */
function subtableCovers(
  view: DataView,
  length: number,
  offset: number,
  from: number,
  to: number,
): boolean {
  const format = view.getUint16(offset, false)

  if (format === FORMAT_SEGMENTED) {
    const segmentsX2 = view.getUint16(offset + 6, false)
    const segments = segmentsX2 / 2
    const endAt = offset + 14
    const startAt = endAt + segmentsX2 + 2
    if (startAt + segmentsX2 > length) return false

    for (let s = 0; s < segments; s++) {
      const end = view.getUint16(endAt + s * 2, false)
      const start = view.getUint16(startAt + s * 2, false)
      // The final segment is the required 0xFFFF terminator, not coverage.
      if (start === 0xffff && end === 0xffff) continue
      if (start <= to && end >= from) return true
    }
    return false
  }

  if (format === FORMAT_SEGMENTED_LONG) {
    const groups = view.getUint32(offset + 12, false)
    for (let g = 0; g < groups; g++) {
      const at = offset + 16 + g * 12
      if (at + 12 > length) return false
      const start = view.getUint32(at, false)
      const end = view.getUint32(at + 4, false)
      if (start <= to && end >= from) return true
    }
    return false
  }

  // Formats 0, 2, 6 and 13 exist but none of them is used for a private-use
  // range in a font a Unity game ships, so an unrecognised one is "no".
  return false
}
