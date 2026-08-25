/**
 * `RemoteContentPackTests.cs` migrated by name, plus the parsing behaviour the
 * C# suite never covers — which is most of it. The behaviour here is pinned by
 * `tools/differential/remote`, which runs the unmodified C# over the same
 * inputs including the two real manifests.
 */

import { describe, expect, it } from 'vitest'

import {
  EPOCH_UNSET,
  RemoteContentPack,
  parseManifestDate,
} from '../src/content/RemoteContentPack.js'

const pack = (fields: Record<string, string>): RemoteContentPack =>
  new RemoteContentPack('test', fields)

describe('RemoteContentPackTests.cs', () => {
  it('GetTitle_ReturnsUserLanguage_WhenAvailable', () => {
    const rcp = pack({ 'name.English': 'Test Title', 'name.German': 'Test Titel' })

    expect(rcp.getTitle('German')).toBe('Test Titel')
  })

  it('GetTitle_ReturnsDefaultLanguage_WhenUserLanguageMissing', () => {
    const rcp = pack({ 'name.English': 'Test Title' })

    expect(rcp.getTitle('German')).toBe('Test Title')
  })

  it('GetTitle_ReturnsFirstAvailable_WhenUserAndDefaultMissing', () => {
    // The C# sets languages_name directly, bypassing the default-language
    // guard that Populate applies — so this asserts GetTitle, not parsing.
    const rcp = pack({})
    rcp.languagesName = new Map([['Spanish', 'Titulo de prueba']])

    expect(rcp.getTitle('German')).toBe('Titulo de prueba')
  })

  it('GetTitle_ReturnsEmpty_WhenNoLanguages', () => {
    expect(pack({}).getTitle('German')).toBe('')
  })

  it('GetDescription_ReturnsUserLanguage_WhenAvailable', () => {
    const rcp = pack({
      'description.English': 'Description',
      'description.German': 'Beschreibung',
    })

    expect(rcp.getDescription('German')).toBe('Beschreibung')
  })
})

describe('the default-language guard', () => {
  // Populate skips the whole loop unless name.English is present, so a pack
  // translated into German but not English gets no names at all.
  it('drops every name when the default language is absent', () => {
    const rcp = pack({ 'name.German': 'Titel', 'name.Spanish': 'Titulo' })

    expect(rcp.languagesName.size).toBe(0)
    expect(rcp.getTitle('German')).toBe('')
  })

  it('keeps every name once the default language is present', () => {
    const rcp = pack({ 'name.English': 'Title', 'name.German': 'Titel' })

    expect([...rcp.languagesName.keys()]).toEqual(['English', 'German'])
  })

  it('applies independently to names and descriptions', () => {
    const rcp = pack({ 'name.English': 'Title', 'description.German': 'Beschreibung' })

    expect(rcp.languagesName.size).toBe(1)
    expect(rcp.languagesDescription.size).toBe(0)
  })

  it('accepts an empty default name as present', () => {
    const rcp = pack({ 'name.English': '', 'name.German': 'Titel' })

    expect(rcp.getTitle('English')).toBe('')
    expect(rcp.getTitle('German')).toBe('Titel')
  })
})

describe('populate', () => {
  it('rewrites backslashes in the image path', () => {
    expect(pack({ image: 'img\\icons\\pack.png' }).image).toBe('img/icons/pack.png')
  })

  it('leaves image null when the manifest names none', () => {
    expect(pack({}).image).toBeNull()
  })

  it('defaults the string fields to empty', () => {
    const rcp = pack({})

    expect(rcp.type).toBe('')
    expect(rcp.version).toBe('')
    expect(rcp.packageUrl).toBe('')
    expect(rcp.latestUpdate).toBe(EPOCH_UNSET)
  })

  it('is always valid, as the C# unconditionally returns true', () => {
    expect(pack({}).valid).toBe(true)
  })

  it('reads a real manifest entry', () => {
    const rcp = pack({
      type: 'D2ECustom',
      defaultlanguage: 'English',
      image: 'contentpackicon.png',
      version: '1.1',
      'name.English': 'DooM',
      'description.English': 'DooM conversion kit.',
      url: 'https://raw.githubusercontent.com/Neuntoter82/Doom_2016_Mod/main/',
      latest_update: '2026-03-07T05:32:25Z',
    })

    expect(rcp.getTitle('English')).toBe('DooM')
    expect(rcp.latestUpdate).toBe('2026-03-07T05:32:25.000Z')
    expect(rcp.packageUrl).toBe('https://raw.githubusercontent.com/Neuntoter82/Doom_2016_Mod/main/')
  })
})

describe('parseManifestDate (DEVIATION)', () => {
  it.each([
    ['2026-03-07T05:32:25Z', '2026-03-07T05:32:25.000Z'],
    ['2026-03-07T05:32:25.123Z', '2026-03-07T05:32:25.123Z'],
    ['2026-03-07T05:32:25+02:00', '2026-03-07T03:32:25.000Z'],
    ['2026-03-07', '2026-03-07T00:00:00.000Z'],
    ['2026-03-07T05:32:25', '2026-03-07T05:32:25.000Z'],
    ['2026-03-07 05:32:25', '2026-03-07T05:32:25.000Z'],
    ['   2026-03-07T05:32:25Z   ', '2026-03-07T05:32:25.000Z'],
  ])('reads %s as UTC', (input, expected) => {
    expect(parseManifestDate(input)).toBe(expected)
  })

  // The C# reads this by machine culture: July 3 on en-US, March 7 on de-DE.
  // There is no single behaviour to match, so an ambiguous date is refused.
  it('refuses an ambiguous slash date', () => {
    expect(parseManifestDate('07/03/2026')).toBeNull()
    expect(pack({ latest_update: '07/03/2026' }).latestUpdate).toBe(EPOCH_UNSET)
  })

  it.each(['not a date', '', '2026-13-45T99:99:99Z', '2026'])('refuses %s', (input) => {
    expect(parseManifestDate(input)).toBeNull()
  })
})
