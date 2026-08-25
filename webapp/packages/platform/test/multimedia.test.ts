/**
 * Migrated 1:1 from `FindLocalisedMultimediaFileTests.cs`, keeping the C#
 * names so the conformance ledger can match them.
 *
 * The C# fixture writes into a real temp directory; these use the in-memory
 * filesystem instead, which is what makes them run in a browser too.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { findLocalisedMultimediaFile } from '../src/multimedia.js'
import type { LocalisationContext } from '../src/multimedia.js'
import { MemoryFileSystem } from '../src/filesystem.js'
import { combine } from '../src/path.js'

const SOURCE = '/quests/MyScenario'

let fs: MemoryFileSystem

beforeEach(() => {
  fs = new MemoryFileSystem()
})

const createFile = async (relativePath: string): Promise<void> => {
  await fs.writeText(combine(SOURCE, relativePath), '')
}

const call = (
  name: string,
  currentLang: string,
  fallbackLang: string | null,
  editMode = false,
): Promise<string> => {
  const context: LocalisationContext = { currentLang, fallbackLang, editMode }
  return findLocalisedMultimediaFile(fs, name, SOURCE, context)
}

describe('FindLocalisedMultimediaFileTests.cs', () => {
  it('Returns_CurrentLanguagePath_WhenFileExistsThere', async () => {
    await createFile('German/Tile.png')

    expect(await call('Tile.png', 'German', 'English')).toBe(`${SOURCE}/German/Tile.png`)
  })

  it('Returns_FallbackLanguagePath_WhenCurrentLangMissingButFallbackExists', async () => {
    await createFile('English/Tile.png')

    expect(await call('Tile.png', 'German', 'English')).toBe(`${SOURCE}/English/Tile.png`)
  })

  it('Returns_RootPath_WhenNoLanguageSubfolderFileExists', async () => {
    await createFile('Tile.png')

    expect(await call('Tile.png', 'German', 'English')).toBe(`${SOURCE}/Tile.png`)
  })

  it('Returns_RootPath_WhenNoFilesExistAtAll', async () => {
    // The composed path comes back even though nothing is there — callers
    // report the missing file themselves.
    expect(await call('Missing.png', 'German', 'English')).toBe(`${SOURCE}/Missing.png`)
  })

  it('Returns_RootPath_WhenEditModeIsTrue_EvenIfLanguageFileExists', async () => {
    await createFile('German/Tile.png')

    expect(await call('Tile.png', 'German', 'English', true)).toBe(`${SOURCE}/Tile.png`)
  })

  it('CurrentLanguage_TakesPriority_OverFallbackLanguage', async () => {
    await createFile('German/Tile.png')
    await createFile('English/Tile.png')

    expect(await call('Tile.png', 'German', 'English')).toBe(`${SOURCE}/German/Tile.png`)
  })

  it('Returns_RootPath_WhenFallbackLangIsEmpty', async () => {
    await createFile('English/Tile.png')

    expect(await call('Tile.png', 'German', '')).toBe(`${SOURCE}/Tile.png`)
  })

  it('Returns_RootPath_WhenFallbackLangEqualsCurrentLang', async () => {
    await createFile('German/Tile.png')

    expect(await call('Tile.png', 'French', 'French')).toBe(`${SOURCE}/Tile.png`)
  })

  it('Returns_FallbackLanguagePath_WhenFallbackLangIsNull', async () => {
    // Named for the null case; null is treated as empty, so no fallback pass.
    await createFile('English/Tile.png')

    expect(await call('Tile.png', 'German', null)).toBe(`${SOURCE}/Tile.png`)
  })

  it('Supports_RelativeSubfolderInName', async () => {
    await createFile('German/images/BgTile.png')

    expect(await call('images/BgTile.png', 'German', 'English')).toBe(
      `${SOURCE}/German/images/BgTile.png`,
    )
  })

  it('Supports_LanguageFolderInsideSubfolder', async () => {
    await createFile('image/map.png')
    await createFile('image/German/map.png')

    expect(await call('image/map.png', 'German', 'English')).toBe(`${SOURCE}/image/German/map.png`)
  })

  it('Fallback_LanguageFolderInsideSubfolder_IsUsed_WhenCurrentMissing', async () => {
    await createFile('image/English/map.png')

    expect(await call('image/map.png', 'German', 'English')).toBe(`${SOURCE}/image/English/map.png`)
  })

  it('EditMode_Ignores_LanguageFolderInsideSubfolder', async () => {
    await createFile('image/German/map.png')
    await createFile('image/map.png')

    expect(await call('image/map.png', 'German', 'English', true)).toBe(`${SOURCE}/image/map.png`)
  })
})

describe('resolution order', () => {
  it('prefers the scenario-root language folder over the one in the subfolder', async () => {
    await createFile('German/image/map.png')
    await createFile('image/German/map.png')

    expect(await call('image/map.png', 'German', 'English')).toBe(`${SOURCE}/German/image/map.png`)
  })

  it('prefers the current language in a subfolder over the fallback at the root', async () => {
    await createFile('image/German/map.png')
    await createFile('English/image/map.png')

    expect(await call('image/map.png', 'German', 'English')).toBe(`${SOURCE}/image/German/map.png`)
  })

  it('accepts a Windows-separated name, as the ini parser produces on Windows', async () => {
    await createFile('German/images/BgTile.png')

    expect(await call('images\\BgTile.png', 'German', 'English')).toBe(
      `${SOURCE}/German/images/BgTile.png`,
    )
  })
})
