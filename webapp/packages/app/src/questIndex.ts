/**
 * The community's published list of scenarios.
 *
 * `QuestsManager` fetches one ini holding every scenario for a game — 169 of
 * them for Mansions, 547 kB — and each section carries the same fields a
 * `quest.ini` does, plus where to download it. So the entries are read with
 * the same `Quest` class the port already has rather than a parallel parser.
 *
 * The index and the packages are both on `raw.githubusercontent.com`, which
 * sends `Access-Control-Allow-Origin: *` and honours `Range` — verified live by
 * `tools/differential/remote/live-check.mjs` — so a browser can read them
 * directly and resume an interrupted download.
 */

import { Quest, readFromString } from '@valkyrie/core'
import type { HttpClient } from '@valkyrie/platform'

/** Where `QuestsManager` reads each game's list. */
const INDEX_BASE = 'https://raw.githubusercontent.com/NPBruce/valkyrie-store/master'

export type GameType = 'MoM' | 'D2E'

export function questIndexUrl(gameType: GameType): string {
  return `${INDEX_BASE}/${gameType}/manifestDownload.ini`
}

export interface IndexedQuest {
  id: string
  quest: Quest
  /** The directory the package lives in. */
  packageUrl: string
  /** Community rating out of ten, or null when nobody has rated it. */
  rating: number | null
  playCount: number
  /** ISO 8601, as the index publishes it. */
  updated: string
  /** Cover image, absolute once combined with the package directory. */
  image: string
}

/** The package a scenario is downloaded from. */
export function packageUrl(entry: IndexedQuest): string {
  return `${entry.packageUrl}${entry.id}.valkyrie`
}

export interface IndexOptions {
  http: HttpClient
  gameType: GameType
  signal?: AbortSignal
  onProgress?: (fraction: number, received: number, total: number | null) => void
}

/**
 * Fetches and parses the index.
 *
 * A section that will not parse is skipped rather than failing the whole list:
 * one malformed entry among 169 should not cost a player the other 168.
 */
export async function fetchQuestIndex(options: IndexOptions): Promise<IndexedQuest[]> {
  const text = await options.http.getText(questIndexUrl(options.gameType), {
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
  })
  return parseQuestIndex(text)
}

export function parseQuestIndex(text: string): IndexedQuest[] {
  const ini = readFromString(text)
  const entries: IndexedQuest[] = []

  for (const [id, fields] of ini.data) {
    try {
      const quest = new Quest(id, fields)
      // `hidden` marks a scenario the author has withdrawn; the game does not
      // list them and neither should this.
      if (quest.hidden) continue

      const url = fields.get('url') ?? ''
      if (url.length === 0) continue

      entries.push({
        id,
        quest,
        packageUrl: url,
        rating: parseNumber(fields.get('rating')),
        playCount: parseNumber(fields.get('play_count')) ?? 0,
        updated: fields.get('latest_update') ?? '',
        image: `${url}${fields.get('image') ?? ''}`,
      })
    } catch {
      // One malformed entry should not cost the player the other 168.
    }
  }

  return entries
}

function parseNumber(value: string | undefined): number | null {
  if (value === undefined) return null
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** Sorts as the game's own list does: most recently updated first. */
export function byRecency(entries: readonly IndexedQuest[]): IndexedQuest[] {
  return [...entries].sort((a, b) => b.updated.localeCompare(a.updated))
}

/**
 * The index as the trait-filtered browser shows it.
 *
 * The trait groups are the ones the game filters scenarios by, so a player
 * finds a two-hour scenario for four investigators the same way they do in the
 * Unity build — through logic already verified against the C#.
 */
export function browsableQuests(
  entries: readonly IndexedQuest[],
  installed: ReadonlySet<string>,
  language = 'English',
): {
  key: string
  display: string
  traits: Map<string, string[]>
  description: string
  status?: string
}[] {
  return entries.map((entry) => ({
    key: entry.id,
    display: bestName(entry, language),
    traits: new Map<string, string[]>([
      ['Difficulty', [difficultyBand(entry.quest.difficulty)]],
      ['Length', [lengthBand(entry.quest.lengthMin, entry.quest.lengthMax)]],
      ['Investigators', [`${String(entry.quest.minHero)}–${String(entry.quest.maxHero)}`]],
      ['Rating', [ratingBand(entry.rating)]],
    ]),
    description: best(entry.quest.languagesSynopsys, language, entry.quest.defaultLanguage) ?? '',
    // Omitted rather than set to undefined: exactOptionalPropertyTypes
    // distinguishes "absent" from "present and undefined".
    ...(installed.has(entry.id) ? { status: 'Downloaded' } : {}),
  }))
}

/**
 * The best name available, which is often not the one in the player's language.
 *
 * Only 90 of the index's 169 scenarios carry an English name, while 150 carry a
 * Spanish one. Falling straight back to the section id would leave a player
 * looking at `HistoriasDeArkhamDarrellSimmons` when the author wrote a real
 * title in another language.
 */
function bestName(entry: IndexedQuest, language: string): string {
  return best(entry.quest.languagesName, language, entry.quest.defaultLanguage) ?? entry.id
}

function best(
  variants: ReadonlyMap<string, string>,
  language: string,
  defaultLanguage: string,
): string | null {
  const wanted = variants.get(language)
  if (wanted !== undefined && wanted.length > 0) return wanted
  const fallback = variants.get(defaultLanguage)
  if (fallback !== undefined && fallback.length > 0) return fallback
  // Any name the author wrote beats the directory name.
  for (const value of variants.values()) if (value.length > 0) return value
  return null
}

/** The game shows difficulty as a word, not a number between 0 and 1. */
function difficultyBand(difficulty: number): string {
  if (difficulty <= 0.25) return 'Easy'
  if (difficulty <= 0.5) return 'Normal'
  if (difficulty <= 0.75) return 'Hard'
  return 'Brutal'
}

function lengthBand(min: number, max: number): string {
  const average = (min + max) / 2
  if (average <= 0) return 'Unknown'
  if (average <= 60) return 'Short'
  if (average <= 120) return 'Medium'
  return 'Long'
}

/** Unrated is its own band: it means "nobody knows", not "bad". */
function ratingBand(rating: number | null): string {
  if (rating === null) return 'Unrated'
  if (rating >= 8) return 'Excellent'
  if (rating >= 6) return 'Good'
  return 'Mixed'
}
