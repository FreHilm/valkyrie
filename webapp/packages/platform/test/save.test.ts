/**
 * Tests for save/load (T-015).
 *
 * The version-comparison half of `SaveLoadTests.cs` was migrated with
 * `VersionManager` in T-010; the path and gating cases are here, plus the
 * envelope handling the C# suite does not reach.
 */

import { describe, expect, it } from 'vitest'
import { zipSync } from 'fflate'
import { versionNewer, versionNewerOrEqual } from '@valkyrie/core'

import { MemoryFileSystem, StoragePaths } from '../src/filesystem.js'
import {
  MIN_VALKYRIE_VERSION,
  SaveError,
  checkSaveVersion,
  deleteSave,
  expandPacks,
  exportFilename,
  exportSave,
  importSave,
  listSaves,
  loadSave,
  parseSaveTime,
  readSaveMetadata,
  saveExists,
  saveFilePath,
  writeSave,
} from '../src/save.js'
import type { SaveContext } from '../src/save.js'
import { combine } from '../src/path.js'

const encoder = new TextEncoder()

const paths = new StoragePaths({ appData: '/app', content: '/content', temp: '/tmp' }, 'D2E')

const SAVE_INI_TEXT = `[Quest]
path=/quests/MyQuest/quest.ini
originalpath=/quests/MyQuest
questname=The Deep Vault
valkyrie=2.5.0
time=2026-03-07T05:32:25Z

[Packs]
base=
FA=

[Log]
quest0=You enter the vault.
editor1=Debug note
`

function saveArchive(ini = SAVE_INI_TEXT, extra: Record<string, string> = {}): Uint8Array {
  return zipSync({
    'save.ini': encoder.encode(ini),
    'image.png': encoder.encode('PNG'),
    'quest/quest.ini': encoder.encode('[Quest]\nname=The Deep Vault\n'),
    ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, encoder.encode(v)])),
  })
}

async function makeContext(
  saves: Record<number, Uint8Array> = {},
  currentVersion = '2.5.0',
): Promise<{ context: SaveContext; fs: MemoryFileSystem }> {
  const fs = new MemoryFileSystem()
  const context: SaveContext = { fs, paths, currentVersion }
  for (const [slot, bytes] of Object.entries(saves)) {
    await fs.writeBytes(saveFilePath(paths, Number(slot)), bytes)
  }
  return { context, fs }
}

describe('SaveLoadTests.cs', () => {
  it('MinValkyieVersion_HasExpectedValue', () => {
    expect(MIN_VALKYRIE_VERSION).toBe('0.7.3')
  })

  it('MinValkyieVersion_IsNotEmpty', () => {
    expect(MIN_VALKYRIE_VERSION.length).toBeGreaterThan(0)
  })

  it('MinValkyieVersion_HasExpectedFormat', () => {
    expect(MIN_VALKYRIE_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('MinValkyieVersion_ComponentsAreParsableAsIntegers', () => {
    for (const part of MIN_VALKYRIE_VERSION.split('.')) {
      expect(Number.isInteger(Number(part))).toBe(true)
    }
  })

  it('SaveFilePath_Format_ContainsSaveDirectory', () => {
    expect(saveFilePath(paths, 1)).toContain('/Save/')
  })

  it('SaveFilePath_AutoSaveNumber_UsesAutoPrefix', () => {
    expect(saveFilePath(paths, 0)).toBe('/app/D2E/Save/saveAuto.vSave')
  })

  it('SaveFilePath_NumberedSave_UsesNumberAsString', () => {
    expect(saveFilePath(paths, 1)).toBe('/app/D2E/Save/save1.vSave')
  })

  it('SaveFilePath_HigherNumberedSave_UsesNumberAsString', () => {
    expect(saveFilePath(paths, 3)).toBe('/app/D2E/Save/save3.vSave')
  })

  // These duplicate VersionManagerTests, which T-010 migrated. Repeated here
  // under their SaveLoadTests names so the conformance ledger accounts for
  // every case rather than assuming the overlap covers them.
  it('VersionNewer_NewerMajorVersion_ReturnsTrue', () => {
    expect(versionNewer('1.0.0', '2.0.0')).toBe(true)
  })

  it('VersionNewer_NewerMinorVersion_ReturnsTrue', () => {
    expect(versionNewer('1.0.0', '1.1.0')).toBe(true)
  })

  it('VersionNewer_NewerPatchVersion_ReturnsTrue', () => {
    expect(versionNewer('1.0.0', '1.0.1')).toBe(true)
  })

  it('VersionNewer_SameVersion_ReturnsFalse', () => {
    expect(versionNewer('1.0.0', '1.0.0')).toBe(false)
  })

  it('VersionNewer_OlderVersion_ReturnsFalse', () => {
    expect(versionNewer('2.0.0', '1.0.0')).toBe(false)
  })

  it('VersionNewer_EmptyNewVersion_ReturnsFalse', () => {
    expect(versionNewer('1.0.0', '')).toBe(false)
  })

  it('VersionNewer_EmptyOldVersion_ReturnsTrue', () => {
    expect(versionNewer('', '1.0.0')).toBe(true)
  })

  it('VersionNewer_DifferentComponentCount_ReturnsTrue', () => {
    expect(versionNewer('1.0.0', '1.0')).toBe(true)
  })

  it('VersionNewerOrEqual_SameVersion_ReturnsTrue', () => {
    expect(versionNewerOrEqual('1.5.3', '1.5.3')).toBe(true)
  })

  it('VersionNewerOrEqual_NewerVersion_ReturnsTrue', () => {
    expect(versionNewerOrEqual('1.0.0', '1.0.1')).toBe(true)
  })

  it('VersionNewerOrEqual_OlderVersion_ReturnsFalse', () => {
    expect(versionNewerOrEqual('1.0.1', '1.0.0')).toBe(false)
  })

  it('VersionNewerOrEqual_VersionWithExtraCharacters_StillCompares', () => {
    expect(versionNewerOrEqual('1.0.0', '1.0.1-beta')).toBe(true)
  })

  it('VersionNewerOrEqual_MinValkyieVersion_ChecksCorrectly', () => {
    expect(versionNewerOrEqual(MIN_VALKYRIE_VERSION, MIN_VALKYRIE_VERSION)).toBe(true)
  })

  it('MinVersion_IsOlderThanCurrentVersion', () => {
    expect(checkSaveVersion(MIN_VALKYRIE_VERSION, '2.5.0')).toBeNull()
  })

  it('FutureVersion_WouldBeRejected', () => {
    expect(checkSaveVersion('99.0.0', '2.5.0')).toBe('future-version')
  })

  it('OldVersion_BelowMinimum_WouldBeRejected', () => {
    expect(checkSaveVersion('0.7.2', '2.5.0')).toBe('unsupported-version')
  })

  it('MinVersion_ExactMatch_WouldBeAccepted', () => {
    expect(checkSaveVersion(MIN_VALKYRIE_VERSION, '2.5.0')).toBeNull()
  })
})

describe('readSaveMetadata', () => {
  it('reads the quest name, time and thumbnail', async () => {
    const { context } = await makeContext({ 0: saveArchive() })
    const meta = await readSaveMetadata(context, 0)

    expect(meta.valid).toBe(true)
    expect(meta.questName).toBe('The Deep Vault')
    expect(meta.saveTime).toBe('2026-03-07T05:32:25.000Z')
    expect(new TextDecoder().decode(meta.image ?? new Uint8Array())).toBe('PNG')
  })

  it('reports an absent slot rather than throwing', async () => {
    const { context } = await makeContext()
    const meta = await readSaveMetadata(context, 2)

    expect(meta).toMatchObject({ valid: false, rejection: 'missing' })
  })

  it('reports a file that is not an archive', async () => {
    const { context, fs } = await makeContext()
    await fs.writeBytes(saveFilePath(paths, 1), new Uint8Array([1, 2, 3]))

    expect((await readSaveMetadata(context, 1)).rejection).toBe('unreadable')
  })

  it('reports an archive with no save.ini', async () => {
    const { context, fs } = await makeContext()
    await fs.writeBytes(saveFilePath(paths, 1), zipSync({ 'other.txt': encoder.encode('x') }))

    expect((await readSaveMetadata(context, 1)).rejection).toBe('unreadable')
  })

  it('rejects a save from a newer Valkyrie', async () => {
    const { context } = await makeContext({ 0: saveArchive() }, '2.0.0')

    expect((await readSaveMetadata(context, 0)).rejection).toBe('future-version')
  })

  it('rejects a save from below the minimum version', async () => {
    const ini = SAVE_INI_TEXT.replace('valkyrie=2.5.0', 'valkyrie=0.7.2')
    const { context } = await makeContext({ 0: saveArchive(ini) })

    expect((await readSaveMetadata(context, 0)).rejection).toBe('unsupported-version')
  })

  // DateTime.Parse throws in the C#, and the catch discards the whole save.
  it('keeps a save whose time is unparsable', async () => {
    const ini = SAVE_INI_TEXT.replace('time=2026-03-07T05:32:25Z', 'time=whenever')
    const { context } = await makeContext({ 0: saveArchive(ini) })
    const meta = await readSaveMetadata(context, 0)

    expect(meta.valid).toBe(true)
    expect(meta.saveTime).toBeNull()
  })
})

describe('listSaves', () => {
  it('returns all four slots in order', async () => {
    const { context } = await makeContext({ 0: saveArchive(), 2: saveArchive() })
    const saves = await listSaves(context)

    expect(saves.map((s) => s.slot)).toEqual([0, 1, 2, 3])
    expect(saves.map((s) => s.valid)).toEqual([true, false, true, false])
  })

  it('saveExists is true when any slot holds a save', async () => {
    const { context } = await makeContext({ 3: saveArchive() })

    expect(await saveExists(context)).toBe(true)
  })

  it('saveExists is false with no saves at all', async () => {
    const { context } = await makeContext()

    expect(await saveExists(context)).toBe(false)
  })
})

describe('loadSave', () => {
  it('extracts the save and returns its parts', async () => {
    const { context } = await makeContext({ 0: saveArchive() })
    const loaded = await loadSave(context, 0)

    expect(loaded.data.get('Quest', 'questname')).toBe('The Deep Vault')
    expect(loaded.log.toArray().map((e) => e.entry)).toEqual(['You enter the vault.', 'Debug note'])
    expect(new TextDecoder().decode(loaded.image ?? new Uint8Array())).toBe('PNG')
  })

  it('rewrites the quest path onto the load directory', async () => {
    const { context } = await makeContext({ 0: saveArchive() })
    const loaded = await loadSave(context, 0)

    expect(loaded.questPath).toBe(paths.loadQuestPath)
    expect(loaded.data.get('Quest', 'path')).toBe(`${paths.loadQuestPath}/quest.ini`)
  })

  it('throws rather than silently bouncing to the menu', async () => {
    const { context } = await makeContext({ 0: saveArchive() }, '2.0.0')

    await expect(loadSave(context, 0)).rejects.toBeInstanceOf(SaveError)
    await expect(loadSave(context, 0)).rejects.toMatchObject({ rejection: 'future-version' })
  })

  it('does not leave content from a previous load behind', async () => {
    const { context, fs } = await makeContext({ 0: saveArchive() })
    await fs.writeText(`${paths.loadPath}/stale.txt`, 'old')

    await loadSave(context, 0)

    expect(await fs.exists(`${paths.loadPath}/stale.txt`)).toBe(false)
  })
})

describe('expandPacks', () => {
  it('expands the legacy 1.2 pack ids', () => {
    expect(expandPacks(['FA'])).toEqual(['FAI', 'FAM', 'FAT'])
    expect(expandPacks(['CotW'])).toEqual(['CotWI', 'CotWM', 'CotWT'])
    expect(expandPacks(['MoM1E'])).toEqual(['MoM1EI', 'MoM1EM', 'MoM1ET'])
  })

  it('passes a modern id through', () => {
    expect(expandPacks(['base', 'D2ECustom'])).toEqual(['base', 'D2ECustom'])
  })

  // The C# if/if/if/else binds the else to the MoM1E test only, so FA and CotW
  // are expanded and then also loaded under the legacy id, which does not exist.
  it('does not also emit the legacy id (DEVIATION)', () => {
    expect(expandPacks(['FA'])).not.toContain('FA')
  })
})

describe('parseSaveTime', () => {
  it.each([
    ['2026-03-07T05:32:25Z', '2026-03-07T05:32:25.000Z'],
    ['2026-03-07T05:32:25', '2026-03-07T05:32:25.000Z'],
    ['2026-03-07T05:32:25+02:00', '2026-03-07T03:32:25.000Z'],
  ])('reads %s as UTC', (input, expected) => {
    expect(parseSaveTime(input)).toBe(expected)
  })

  it.each(['', '   ', 'whenever'])('returns null for %s instead of throwing', (input) => {
    expect(parseSaveTime(input)).toBeNull()
  })
})

describe('export and import', () => {
  it('exports the save bytes with a readable filename', async () => {
    const { context } = await makeContext({ 0: saveArchive() })
    const exported = await exportSave(context, 0)

    expect(exported.filename).toBe('The_Deep_Vault-Auto.vSave')
    expect(exported.bytes.length).toBeGreaterThan(0)
  })

  it('names a numbered slot by its number', async () => {
    const { context } = await makeContext({ 2: saveArchive() })

    expect((await exportSave(context, 2)).filename).toBe('The_Deep_Vault-2.vSave')
  })

  it.each([
    ['My Quest: Part 2', 'My_Quest_Part_2-1.vSave'],
    ['', 'valkyrie-1.vSave'],
    ['../../etc/passwd', '.._.._etc_passwd-1.vSave'],
  ])('makes %s filesystem-safe', (questName, expected) => {
    expect(exportFilename({ slot: 1, questName } as never)).toBe(expected)
  })

  it('refuses to export an empty slot', async () => {
    const { context } = await makeContext()

    await expect(exportSave(context, 1)).rejects.toBeInstanceOf(SaveError)
  })

  it('round-trips an exported save into another slot', async () => {
    const { context } = await makeContext({ 0: saveArchive() })
    const exported = await exportSave(context, 0)

    const imported = await importSave(context, exported.bytes, 3)

    expect(imported.valid).toBe(true)
    expect(imported.questName).toBe('The Deep Vault')
    expect(imported.slot).toBe(3)
  })

  it('refuses an imported file that is not a save', async () => {
    const { context } = await makeContext()

    await expect(importSave(context, encoder.encode('not a zip'), 1)).rejects.toMatchObject({
      rejection: 'unreadable',
    })
  })

  // A wrong file must not destroy what is already in the slot.
  it('leaves the existing save intact when an import is refused', async () => {
    const { context } = await makeContext({ 1: saveArchive() })

    await expect(importSave(context, encoder.encode('junk'), 1)).rejects.toBeInstanceOf(SaveError)

    expect((await readSaveMetadata(context, 1)).questName).toBe('The Deep Vault')
  })

  it('refuses an import from a newer Valkyrie', async () => {
    const { context } = await makeContext({}, '2.0.0')

    await expect(importSave(context, saveArchive(), 1)).rejects.toMatchObject({
      rejection: 'future-version',
    })
  })

  it('deletes a save, and tolerates deleting an empty slot', async () => {
    const { context } = await makeContext({ 1: saveArchive() })

    await deleteSave(context, 1)
    await deleteSave(context, 1)

    expect(await saveExists(context)).toBe(false)
  })
})

describe('writeSave', () => {
  // Nothing could write a save before this: the reader was complete and the
  // writer did not exist, so `listSaves` had only ever seen archives made by
  // the Unity build.
  it('writes an archive the reader can open again', async () => {
    const { context } = await makeContext()
    await writeSave(context, 1, {
      state: '[Quest]\nvalkyrie=2.5.0\nquestname=Probe\ntime=2026-08-28 20:00:00\npath=/quests/probe/quest.ini\n\n[Log]\nquest0=You arrive.\n\n[Packs]\nMoMBase\n',
    })

    const loaded = await loadSave(context, 1)
    expect(loaded.data.get('Quest', 'questname')).toBe('Probe')
    expect(loaded.log.toArray().map((e) => e.entry)).toEqual(['You arrive.'])
    expect(loaded.packs).toContain('MoMBase')
  })

  it('shows up in the save list with its metadata', async () => {
    const { context } = await makeContext()
    await writeSave(context, 2, {
      state: '[Quest]\nvalkyrie=2.5.0\nquestname=Probe\ntime=2026-08-28 20:00:00\npath=/quests/probe/quest.ini\n',
    })

    const listed = (await listSaves(context)).find((s) => s.slot === 2)
    expect(listed?.questName).toBe('Probe')
    expect(listed?.rejection).toBeNull()
  })

  it('carries a screenshot when one is given, and nothing when not', async () => {
    const { context } = await makeContext()
    const state = '[Quest]\nvalkyrie=2.5.0\nquestname=Probe\npath=/q/quest.ini\n'
    await writeSave(context, 1, { state, image: new Uint8Array([1, 2, 3]) })
    expect((await loadSave(context, 1)).image).toEqual(new Uint8Array([1, 2, 3]))

    await writeSave(context, 2, { state })
    expect((await loadSave(context, 2)).image).toBeNull()
  })

  it('carries the scenario’s own files, so the save opens without it', async () => {
    // `SaveManager.SaveWithScreen` copies the quest content in for the same
    // reason: a save that outlives its quest is still a save.
    const { context } = await makeContext()
    await writeSave(context, 1, {
      state: '[Quest]\nvalkyrie=2.5.0\nquestname=Probe\npath=/q/quest.ini\n',
      questFiles: new Map([['quest.ini', new TextEncoder().encode('[Quest]\nname=Probe\n')]]),
    })

    await loadSave(context, 1)
    expect(await context.fs.exists(combine(context.paths.loadPath, 'quest.ini'))).toBe(true)
  })

  it('replaces what was in the slot', async () => {
    const { context } = await makeContext()
    const at = (name: string) =>
      `[Quest]\nvalkyrie=2.5.0\nquestname=${name}\npath=/q/quest.ini\n`
    await writeSave(context, 1, { state: at('First') })
    await writeSave(context, 1, { state: at('Second') })

    expect((await loadSave(context, 1)).data.get('Quest', 'questname')).toBe('Second')
  })
})
