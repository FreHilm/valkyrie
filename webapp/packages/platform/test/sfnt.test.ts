/**
 * Tests for the `cmap` reader that decides which imported fonts are worth
 * keeping.
 *
 * The stakes are asymmetric, and the tests are weighted to match. A false
 * negative drops the one face that carries the game's icons and the port
 * silently falls back to naming them. A false positive keeps a 16 MB Korean
 * fallback nobody will open. So both directions are covered, but the
 * "must not lose the real font" cases come first.
 */

import { describe, expect, it } from 'vitest'

import { coversCodepoints } from '../src/sfnt.js'
import { fontFile } from './fixtures/unity.js'

/** The range the game writes its icons in. */
const ICONS: [number, number] = [0xf200, 0xf20f]

describe('coversCodepoints', () => {
  it('finds a range a font covers exactly', () => {
    const font = fontFile({ covers: [0xf200, 0xf20f] })

    expect(coversCodepoints(font, ...ICONS)).toBe(true)
  })

  it('finds a range a font covers as part of a wider one', () => {
    // A face carrying the whole private-use area still carries the icons.
    const font = fontFile({ covers: [0xe000, 0xf8ff] })

    expect(coversCodepoints(font, ...ICONS)).toBe(true)
  })

  it('finds an overlap at either edge', () => {
    expect(coversCodepoints(fontFile({ covers: [0xf000, 0xf200] }), ...ICONS)).toBe(true)
    expect(coversCodepoints(fontFile({ covers: [0xf20f, 0xf300] }), ...ICONS)).toBe(true)
  })

  it('says no to a font that stops just short', () => {
    expect(coversCodepoints(fontFile({ covers: [0x0020, 0xf1ff] }), ...ICONS)).toBe(false)
  })

  it('says no to a font that starts just past', () => {
    expect(coversCodepoints(fontFile({ covers: [0xf210, 0xf8ff] }), ...ICONS)).toBe(false)
  })

  it('says no to an ordinary text font', () => {
    // Five of the six faces in a Mansions install look like this.
    expect(coversCodepoints(fontFile({ covers: [0x0020, 0x024f] }), ...ICONS)).toBe(false)
  })

  it('is not fooled by the terminator segment every cmap ends with', () => {
    // Format 4 requires a final segment of 0xFFFF..0xFFFF, which maps nothing.
    // Counting it as coverage would make every font on earth answer true for
    // any range reaching that far — so the query has to reach that far to
    // prove it does not.
    const font = fontFile({ covers: [0x0020, 0x007e] })

    expect(coversCodepoints(font, 0xfff0, 0xffff)).toBe(false)
    expect(coversCodepoints(font, 0x0020, 0x007e)).toBe(true)
  })

  describe('a font that spells its coverage in 32-bit groups', () => {
    // Format 12 is what a face reaching past the BMP has to use, and the CJK
    // fallback in a Mansions install is one. Nothing here can assume format 4.
    it('finds a covered range', () => {
      const font = fontFile({ covers: [0xf200, 0xf20f], cmapFormat: 12 })

      expect(coversCodepoints(font, ...ICONS)).toBe(true)
    })

    it('says no to one it does not cover', () => {
      const font = fontFile({ covers: [0x4e00, 0x9fff], cmapFormat: 12 })

      expect(coversCodepoints(font, ...ICONS)).toBe(false)
    })
  })

  it('says no when the cmap record points outside the file', () => {
    // A directory that lies is a font this cannot read, and reading on from a
    // bogus offset is how a parser walks off the end of a buffer.
    const font = fontFile({ covers: [0xf200, 0xf20f], danglingCmap: true })

    expect(coversCodepoints(font, ...ICONS)).toBe(false)
  })

  it('says no to a font with no character map at all', () => {
    expect(coversCodepoints(fontFile(), ...ICONS)).toBe(false)
  })

  it('says no rather than throwing on bytes that are not a font', () => {
    expect(coversCodepoints(Uint8Array.from([1, 2, 3]), ...ICONS)).toBe(false)
    expect(coversCodepoints(new Uint8Array(0), ...ICONS)).toBe(false)
  })

  it('says no rather than throwing on a truncated font', () => {
    const font = fontFile({ covers: [0xf200, 0xf20f] })

    expect(coversCodepoints(font.subarray(0, 20), ...ICONS)).toBe(false)
  })
})
