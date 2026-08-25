/**
 * Port of `unity/Assets/Scripts/SaveManager.cs`.
 *
 * A save is a zip holding `save.ini`, a thumbnail `image.png`, and a copy of
 * the quest content, so a save stays playable after the quest is deleted or
 * updated. Four slots per game type: slot 0 is the autosave.
 *
 * Reading and writing the *envelope* is here. The runtime quest state that
 * fills `save.ini` belongs with the quest runtime; see the task notes.
 */

import { QuestLog, readFromString, versionNewer, versionNewerOrEqual } from '@valkyrie/core'
import type { IniData } from '@valkyrie/core'

import { ExtractMode, extract, readArchive } from './archive.js'
import type { ArchiveEntry } from './archive.js'
import type { FileSystem, StoragePaths } from './filesystem.js'
import { combine, dirname } from './path.js'

/** `SaveManager.minValkyieVersion`. Saves older than this are refused. */
export const MIN_VALKYRIE_VERSION = '0.7.3'

/** Slot 0 is the autosave; the C# loops 0..3 everywhere. */
export const SAVE_SLOTS = [0, 1, 2, 3] as const

export const SAVE_INI = 'save.ini'
export const SAVE_IMAGE = 'image.png'

/**
 * `SaveManager.GetSaveFilePath`. Slot 0 is named "Auto", not "0".
 */
export function saveFilePath(paths: StoragePaths, slot = 0): string {
  const name = slot === 0 ? 'Auto' : String(slot)
  return combine(paths.gameTypePath, 'Save', `save${name}.vSave`)
}

/** Why a save cannot be loaded. `null` means it can. */
export type SaveRejection = 'missing' | 'unreadable' | 'future-version' | 'unsupported-version'

export interface SaveMetadata {
  slot: number
  valid: boolean
  questName: string
  /** ISO 8601 UTC, or null when the save records no parsable time. */
  saveTime: string | null
  valkyrieVersion: string
  /** The thumbnail bytes, when the save carries one. */
  image: Uint8Array | null
  rejection: SaveRejection | null
}

/**
 * Which version checks gate a save, extracted so both the metadata read and
 * the load path apply exactly the same rule.
 *
 * The C# rejects a save from a *newer* Valkyrie than the one running, and one
 * older than `minValkyieVersion`.
 */
export function checkSaveVersion(
  saveVersion: string,
  currentVersion: string,
  minVersion: string = MIN_VALKYRIE_VERSION,
): SaveRejection | null {
  if (versionNewer(currentVersion, saveVersion)) return 'future-version'
  if (!versionNewerOrEqual(minVersion, saveVersion)) return 'unsupported-version'
  return null
}

export interface SaveContext {
  fs: FileSystem
  paths: StoragePaths
  /** The running app version, for the future-version check. */
  currentVersion: string
}

/**
 * Reads a save's listing metadata without loading the game.
 *
 * Port of `SaveManager.SaveData`. The C# extracts into a shared `Preload`
 * directory and leaves it there; this reads the archive in memory, so listing
 * four slots does not touch the filesystem at all beyond the save files.
 */
export async function readSaveMetadata(context: SaveContext, slot = 0): Promise<SaveMetadata> {
  const empty: SaveMetadata = {
    slot,
    valid: false,
    questName: '',
    saveTime: null,
    valkyrieVersion: '',
    image: null,
    rejection: 'missing',
  }

  const path = saveFilePath(context.paths, slot)
  if (!(await context.fs.exists(path))) return empty

  let entries: ArchiveEntry[]
  try {
    entries = await readArchive(await context.fs.readBytes(path))
  } catch {
    return { ...empty, rejection: 'unreadable' }
  }

  const iniEntry = entries.find((entry) => entry.name === SAVE_INI)
  if (iniEntry === undefined) return { ...empty, rejection: 'unreadable' }

  const save = readFromString(new TextDecoder().decode(iniEntry.data))
  const image = entries.find((entry) => entry.name === SAVE_IMAGE)?.data ?? null
  const valkyrieVersion = save.get('Quest', 'valkyrie')

  const rejection = checkSaveVersion(valkyrieVersion, context.currentVersion)
  return {
    slot,
    valid: rejection === null,
    questName: save.get('Quest', 'questname'),
    saveTime: parseSaveTime(save.get('Quest', 'time')),
    valkyrieVersion,
    image,
    rejection,
  }
}

/** All four slots, in order, whether or not they hold a save. */
export async function listSaves(context: SaveContext): Promise<SaveMetadata[]> {
  return Promise.all(SAVE_SLOTS.map((slot) => readSaveMetadata(context, slot)))
}

export interface LoadedSave {
  /** The parsed `save.ini`. */
  data: IniData
  /** Where the save's quest content was extracted. */
  questPath: string
  log: QuestLog
  /** Content pack ids the save needs, with the legacy ids expanded. */
  packs: string[]
  image: Uint8Array | null
}

/**
 * Extracts a save and returns everything needed to rebuild the game.
 *
 * Rejects rather than continuing when the version gate fails — the C# logs and
 * bounces to the main menu from inside the loader, which a library cannot do.
 */
export async function loadSave(context: SaveContext, slot = 0): Promise<LoadedSave> {
  const path = saveFilePath(context.paths, slot)
  if (!(await context.fs.exists(path))) throw new SaveError('missing', slot)

  const loadPath = context.paths.loadPath
  // The C# deletes and recreates this, so a previous load cannot leak in.
  await context.fs.remove(loadPath)
  await extract(context.fs, await context.fs.readBytes(path), loadPath, ExtractMode.FULL)

  const iniPath = combine(loadPath, SAVE_INI)
  if (!(await context.fs.exists(iniPath))) throw new SaveError('unreadable', slot)

  const data = readFromString(await context.fs.readText(iniPath))
  const rejection = checkSaveVersion(data.get('Quest', 'valkyrie'), context.currentVersion)
  if (rejection !== null) throw new SaveError(rejection, slot)

  const questPath = resolveQuestPath(data, context.paths)
  data.add('Quest', 'path', combine(questPath, 'quest.ini'))

  const imagePath = combine(loadPath, SAVE_IMAGE)
  const image = (await context.fs.exists(imagePath)) ? await context.fs.readBytes(imagePath) : null

  return {
    data,
    questPath,
    log: QuestLog.fromSection(data.getSection('Log') ?? new Map()),
    packs: expandPacks(data.getSection('Packs')?.keys() ?? [].values()),
    image,
  }
}

/**
 * Where the save's quest content now lives.
 *
 * A save written the first time records the quest's original path; on load the
 * content sits under the temp load directory instead, so the recorded prefix
 * is rewritten.
 */
export function resolveQuestPath(data: IniData, paths: StoragePaths): string {
  const recorded = dirname(data.get('Quest', 'path'))
  const original = data.get('Quest', 'originalpath')

  if (original.length > 0 && recorded.includes(original)) {
    return recorded.replace(original, paths.loadQuestPath)
  }
  return recorded
}

/**
 * Content pack ids a save needs.
 *
 * Saves from 1.2 and older name three packs by a single old id; the C# expands
 * those. Note it uses `if`/`if`/`if`/`else`, so the `else` binds only to the
 * MoM1E test — meaning FA and CotW are expanded *and* loaded under their own
 * legacy id, which does not exist. That extra id is dropped here.
 */
export function expandPacks(ids: Iterable<string>): string[] {
  const LEGACY: Record<string, string[]> = {
    FA: ['FAI', 'FAM', 'FAT'],
    CotW: ['CotWI', 'CotWM', 'CotWT'],
    MoM1E: ['MoM1EI', 'MoM1EM', 'MoM1ET'],
  }

  const result: string[] = []
  for (const id of ids) {
    const expanded = LEGACY[id]
    if (expanded === undefined) result.push(id)
    else result.push(...expanded)
  }
  return result
}

export class SaveError extends Error {
  constructor(
    readonly rejection: SaveRejection,
    readonly slot: number,
  ) {
    super(`Save ${slot}: ${rejection}`)
    this.name = 'SaveError'
  }
}

/**
 * `DateTime.Parse` on the save's `time`.
 *
 * DEVIATION: as with the content manifest, the C# parses with the machine
 * culture, so a save written on one locale can read back as a different date
 * on another — and `DateTime.Parse` *throws* on failure, which the C# catches
 * as "unable to open save file", discarding an otherwise good save. This reads
 * ISO 8601 as UTC and returns null rather than throwing.
 */
export function parseSaveTime(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  const parsed = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/.test(trimmed) ? trimmed : `${trimmed}Z`)
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString()
}

export interface ExportedSave {
  /** A filename to offer the user, derived from the quest name. */
  filename: string
  bytes: Uint8Array
}

/**
 * The save file's bytes, for handing to a download.
 *
 * On the desktop a user could copy `saveAuto.vSave` out of the app data
 * directory. In a browser the origin-private filesystem is not reachable, so
 * moving a save between devices needs an explicit export.
 */
export async function exportSave(context: SaveContext, slot = 0): Promise<ExportedSave> {
  const path = saveFilePath(context.paths, slot)
  if (!(await context.fs.exists(path))) throw new SaveError('missing', slot)

  const metadata = await readSaveMetadata(context, slot)
  return { filename: exportFilename(metadata), bytes: await context.fs.readBytes(path) }
}

/** `<quest name>-<slot>.vSave`, with anything awkward for a filesystem removed. */
export function exportFilename(metadata: SaveMetadata): string {
  const name = metadata.questName.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '')
  const slot = metadata.slot === 0 ? 'Auto' : String(metadata.slot)
  return `${name.length === 0 ? 'valkyrie' : name}-${slot}.vSave`
}

/**
 * Writes an exported save into a slot, after checking it is one.
 *
 * Imported files are as untrusted as downloaded packs: the archive is read and
 * version-gated before anything is written, so a wrong or hostile file cannot
 * destroy an existing save.
 */
export async function importSave(
  context: SaveContext,
  bytes: Uint8Array,
  slot: number,
): Promise<SaveMetadata> {
  let entries: ArchiveEntry[]
  try {
    entries = await readArchive(bytes)
  } catch {
    throw new SaveError('unreadable', slot)
  }

  const iniEntry = entries.find((entry) => entry.name === SAVE_INI)
  if (iniEntry === undefined) throw new SaveError('unreadable', slot)

  const save = readFromString(new TextDecoder().decode(iniEntry.data))
  const version = save.get('Quest', 'valkyrie')
  const rejection = checkSaveVersion(version, context.currentVersion)
  if (rejection !== null) throw new SaveError(rejection, slot)

  const path = saveFilePath(context.paths, slot)
  await context.fs.createDirectory(dirname(path))
  await context.fs.writeBytes(path, bytes)

  return readSaveMetadata(context, slot)
}

/** Removes a save. Absent is not an error, matching the guarded C# callers. */
export async function deleteSave(context: SaveContext, slot: number): Promise<void> {
  await context.fs.remove(saveFilePath(context.paths, slot))
}

/** `SaveManager.SaveExists`: whether any of the four slots holds a save. */
export async function saveExists(context: SaveContext): Promise<boolean> {
  for (const slot of SAVE_SLOTS) {
    if (await context.fs.exists(saveFilePath(context.paths, slot))) return true
  }
  return false
}
