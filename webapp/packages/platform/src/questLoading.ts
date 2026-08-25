/**
 * Loading a quest and its content from the virtual filesystem.
 *
 * Everything the engine needs to run a scenario comes from files: content packs
 * under a content root, and the scenario's own inis in its own directory. The
 * C# spreads this across `ContentData`, `QuestLoader` and `Quest`, each
 * reaching for `Game.Get()` and the real filesystem; here it is one function
 * over the `FileSystem` interface, so it works the same against OPFS in a
 * browser, the disk in Node, and an in-memory tree in a test.
 */

import {
  ContentData,
  ContentLoader,
  defaultLocalization,
  loadQuestSections,
  Quest,
  readFromString,
  TILE_PIXELS_PER_SQUARE,
  WEB_TEXTURE_EXTENSIONS,
} from '@valkyrie/core'
import type { ContentContext, Localization, QuestComponent } from '@valkyrie/core'
import type { FileSystem } from './filesystem.js'
import { combine } from './path.js'

/** The `[ContentPackData]` section names the inis a pack is made of. */
const PACK_INI = 'content_pack.ini'

export interface LoadedContent {
  content: ContentData
  context: ContentContext
  /** Pack directories that were read, for reporting. */
  packs: string[]
}

export interface ContentOptions {
  /** Directory holding one subdirectory per content pack. */
  root: string
  /** Where FFG-imported assets were written. */
  importPath: string
  gameType: 'MoM' | 'D2E'
  localization?: Localization
  /** Halves the tile scale, as the C# does where texture memory is tight. */
  android?: boolean
}

/**
 * Loads every content pack under a root.
 *
 * Packs nest: the Mansions conversion kit is a directory of packs, each with
 * its own `content_pack.ini`, so the search is recursive rather than one level
 * deep. Missing that is invisible — the packs simply are not there, and a
 * scenario needing them silently finds no monsters.
 */
export async function loadContent(fs: FileSystem, options: ContentOptions): Promise<LoadedContent> {
  // The resolver has to exist *before* parsing: `GenericData` resolves an
  // image as it reads the section, and a token whose image does not resolve is
  // dropped. Building it afterwards costs every token in the game.
  const resolve = await textureResolver(fs, [options.root, options.importPath])
  const context = contentContext(options, resolve)
  const content = new ContentData(context)
  const loader = new ContentLoader(content, context)

  const packs = await findPacks(fs, options.root)
  for (const packDir of packs) {
    for (const name of await declaredFiles(fs, packDir)) {
      const path = combine(packDir, name)
      if (!(await fs.exists(path))) continue
      loader.loadIni(readFromString(await fs.readText(path)), packDir, packDir)
    }
  }

  return { content, context, packs }
}

/** Every directory under `root` holding a `content_pack.ini`, recursively. */
async function findPacks(fs: FileSystem, root: string): Promise<string[]> {
  const found: string[] = []
  const queue = [root]
  while (queue.length > 0) {
    const dir = queue.shift()
    if (dir === undefined) continue
    if (await fs.exists(combine(dir, PACK_INI))) found.push(dir)
    for (const entry of await fs.list(dir)) {
      if (entry.kind === 'directory') queue.push(entry.path)
    }
  }
  return found
}

/** `content_pack.ini` first, then whatever `[ContentPackData]` names. */
async function declaredFiles(fs: FileSystem, packDir: string): Promise<string[]> {
  const files = [PACK_INI]
  let section = ''
  for (const raw of await fs.readLines(combine(packDir, PACK_INI))) {
    const line = raw.trim()
    if (line.startsWith('[')) {
      section = line.replace(/^\[|\]$/g, '')
      continue
    }
    if (section !== 'ContentPackData' || line.length === 0 || line.startsWith('#')) continue
    const key = line.includes('=') ? line.slice(0, line.indexOf('=')).trim() : line
    if (key.length > 0) files.push(key)
  }
  return files
}

function contentContext(
  options: ContentOptions,
  resolveTextureFile: (name: string) => string | null,
): ContentContext {
  return {
    localization: options.localization ?? defaultLocalization,
    importPath: options.importPath,
    tilePixelPerSquare:
      options.gameType === 'D2E'
        ? TILE_PIXELS_PER_SQUARE.D2E
        : options.android === true
          ? TILE_PIXELS_PER_SQUARE.MoMAndroid
          : TILE_PIXELS_PER_SQUARE.MoM,
    isAndroid: options.android ?? false,
    resolveTextureFile,
  }
}

export interface LoadedQuest {
  quest: Quest
  components: Map<string, QuestComponent>
  /** The directory it was read from, for resolving its own art. */
  path: string
}

/**
 * Loads a scenario from a directory.
 *
 * `quest.ini` names the other inis in `[QuestData]`, but the C# also reads
 * every `.ini` beside it — a scenario that forgets to declare a file still
 * works in the game, so it has to work here.
 */
export async function loadQuest(fs: FileSystem, dir: string): Promise<LoadedQuest> {
  const questIni = readFromString(await fs.readText(combine(dir, 'quest.ini')))
  const quest = new Quest(dir, questIni.data.get('Quest') ?? new Map())

  const components = new Map<string, QuestComponent>()
  for (const entry of await fs.list(dir)) {
    if (entry.kind === 'directory') continue
    const name = entry.path.slice(entry.path.lastIndexOf('/') + 1)
    if (!name.endsWith('.ini') || name === 'quest.ini') continue
    loadQuestSections(
      readFromString(await fs.readText(entry.path)),
      name,
      { format: quest.format },
      components,
    )
  }

  return { quest, components, path: dir }
}

/**
 * Builds a texture resolver from a listing rather than a probe.
 *
 * `GenericData` resolves images *while parsing*, so the resolver has to answer
 * synchronously — which a filesystem behind promises cannot do. Listing the
 * candidates once up front is what makes it possible at all.
 */
export async function textureResolver(
  fs: FileSystem,
  roots: readonly string[],
): Promise<(name: string) => string | null> {
  const files = new Set<string>()
  // Second index for the case-insensitive fallback below. First writer wins,
  // so an exact match is never shadowed by a differently-cased sibling.
  const byLowerCase = new Map<string, string>()
  for (const root of roots) {
    for (const entry of await fs.list(root, { recursive: true })) {
      if (entry.kind !== 'file') continue
      files.add(entry.path)
      const key = entry.path.toLowerCase()
      if (!byLowerCase.has(key)) byLowerCase.set(key, entry.path)
    }
  }

  return (name: string) => {
    for (const extension of WEB_TEXTURE_EXTENSIONS) {
      if (files.has(name + extension)) return name + extension
    }
    if (files.has(name)) return name

    // DEVIATION, and a necessary one. Shipped content misspells the case of a
    // few asset names — `CommonItem_TomeOfHorrors` against a file called
    // `CommonItem_TomeofHorrors` — which the Unity build gets away with on
    // Windows and macOS, whose filesystems ignore case. OPFS does not, and
    // neither does Linux, so an exact-only match silently loses art that works
    // in the game today.
    for (const extension of WEB_TEXTURE_EXTENSIONS) {
      const found = byLowerCase.get((name + extension).toLowerCase())
      if (found !== undefined) return found
    }
    return byLowerCase.get(name.toLowerCase()) ?? null
  }
}
