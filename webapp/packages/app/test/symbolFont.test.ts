/**
 * @vitest-environment happy-dom
 *
 * Loading the game's symbol font out of the player's own import.
 *
 * The face is not in this repository and never will be — it is a commercial
 * font, and the copy the port uses is the one embedded in the player's install.
 * So these tests care about one thing above all: what happens when it is not
 * there. A first run, an import made before fonts were extracted, a corrupt
 * file — each has to come back false rather than throw, because the caller's
 * fallback is legible and an exception here would take the quest down with it.
 */

import { describe, expect, it, vi } from 'vitest'

import { MemoryFileSystem, StoragePaths, combine } from '@valkyrie/platform'
import { SYMBOL_FAMILY, SYMBOL_RANGE, TEXT_FAMILY, loadSymbolFont } from '../src/symbolFont.js'

const paths = new StoragePaths({ appData: '/appdata', content: '/content', temp: '/tmp' }, 'MoM')
const fontsPath = combine(paths.importPath, 'fonts')

/** A stand-in for `FontFace`, which happy-dom does not implement. */
function fakeFontFace(options: { fails?: boolean } = {}) {
  const made: { family: string; descriptors: FontFaceDescriptors }[] = []
  const construct = (
    family: string,
    _source: BufferSource,
    descriptors: FontFaceDescriptors,
  ): FontFace =>
    ({
      family,
      load: options.fails
        ? () => Promise.reject(new Error('not a font'))
        : () => Promise.resolve(undefined as unknown as FontFace),
      ...(made.push({ family, descriptors }), {}),
    }) as unknown as FontFace
  return { construct, made }
}

async function withFont(
  files: Record<string, Uint8Array>,
  options: { fails?: boolean } = {},
): Promise<{
  loaded: boolean
  added: unknown[]
  made: { family: string; descriptors: FontFaceDescriptors }[]
}> {
  const fs = new MemoryFileSystem()
  for (const [name, bytes] of Object.entries(files)) {
    await fs.createDirectory(fontsPath)
    await fs.writeBytes(combine(fontsPath, name), bytes)
  }
  const added: unknown[] = []
  const { construct, made } = fakeFontFace(options)
  const fonts = { add: (face: unknown) => added.push(face) } as unknown as FontFaceSet

  const loaded = await loadSymbolFont({ fs, paths, fonts, construct })
  return { loaded, added, made }
}

const SOME_FONT = Uint8Array.from([0x00, 0x01, 0x00, 0x00, 1, 2, 3, 4])

describe('loadSymbolFont', () => {
  it('loads the face the game draws its icons with', async () => {
    const { loaded } = await withFont({ 'MADGaramondPro.ttf': SOME_FONT })

    expect(loaded).toBe(true)
  })

  it('registers the icons and the letterforms as two faces', async () => {
    // One file, two families. The icons are confined to their range so a page
    // can ask for them without also getting the type; the type is registered
    // whole, because it is what the game sets its dialogs in.
    const { made, added } = await withFont({ 'MADGaramondPro.ttf': SOME_FONT })

    expect(added).toHaveLength(2)
    expect(made.map((f) => f.family)).toEqual([SYMBOL_FAMILY, TEXT_FAMILY])
    expect(made[0]?.descriptors.unicodeRange).toBe(SYMBOL_RANGE)
    // Unrestricted: a range here would leave the prose in the fallback.
    expect(made[1]?.descriptors.unicodeRange).toBeUndefined()
  })

  it('lets prose show in the fallback while the face arrives', async () => {
    // `block` on the icons, because a blank box says nothing; `swap` on the
    // text, because a sentence in the wrong serif still reads.
    const { made } = await withFont({ 'MADGaramondPro.ttf': SOME_FONT })

    expect(made[0]?.descriptors.display).toBe('block')
    expect(made[1]?.descriptors.display).toBe('swap')
  })

  it('registers neither face when the file will not parse', async () => {
    const { loaded, added } = await withFont({ 'MADGaramondPro.ttf': SOME_FONT }, { fails: true })

    expect(loaded).toBe(false)
    expect(added).toHaveLength(0)
  })

  it('covers the expansion marks that sit outside the main range', () => {
    // `characterMap` puts {MAD27} and {MAD28} at U+F480 and U+F481, away from
    // the rest. A range stopping at F20F leaves those two as blank boxes
    // beside neighbours that draw.
    expect(SYMBOL_RANGE).toContain('U+F480-F481')
    // And stops short of the ligatures at U+FB00, which are type, not icons.
    expect(SYMBOL_RANGE).not.toContain('FB0')
  })

  it('confines the face to the icon range', async () => {
    // The same file carries a full set of letterforms. Without this the family
    // would quietly become the page's text font wherever it is named.
    const { made } = await withFont({ 'MADGaramondPro.ttf': SOME_FONT })

    expect(made[0]?.descriptors.unicodeRange).toBe(SYMBOL_RANGE)
    expect(made[0]?.descriptors.display).toBe('block')
  })

  it('registers it under the name the stylesheet uses', async () => {
    const { made } = await withFont({ 'MADGaramondPro.ttf': SOME_FONT })

    expect(made[0]?.family).toBe(SYMBOL_FAMILY)
  })

  it('says no when the player has not imported the game', async () => {
    const { loaded, added } = await withFont({})

    expect(loaded).toBe(false)
    expect(added).toHaveLength(0)
  })

  it('says no when the import predates fonts being extracted', async () => {
    // An import made before this existed has img, audio and text but no fonts
    // directory at all. It must degrade, not throw.
    const fs = new MemoryFileSystem()
    await fs.createDirectory(combine(paths.importPath, 'img'))

    await expect(loadSymbolFont({ fs, paths })).resolves.toBe(false)
  })

  it('says no when the file is there but will not parse', async () => {
    const { loaded, added } = await withFont({ 'MADGaramondPro.ttf': SOME_FONT }, { fails: true })

    expect(loaded).toBe(false)
    expect(added).toHaveLength(0)
  })

  it('tries the other spellings an install may use', async () => {
    const { loaded } = await withFont({ 'MAD Garamond Pro.ttf': SOME_FONT })

    expect(loaded).toBe(true)
  })

  it('does not take a font that carries no icons', async () => {
    // Five of the six fonts in a Mansions install have nothing in the range.
    // Loading one would register a family that draws blank boxes.
    const { loaded } = await withFont({
      'LiberationSans.ttf': SOME_FONT,
      'NotoSansCJKkr-Regular.otf': SOME_FONT,
    })

    expect(loaded).toBe(false)
  })

  it('never throws, whatever the filesystem does', async () => {
    const fs = {
      readBytes: vi.fn().mockRejectedValue(new Error('storage is gone')),
    } as unknown as MemoryFileSystem

    await expect(loadSymbolFont({ fs, paths })).resolves.toBe(false)
  })
})
