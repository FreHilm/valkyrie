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
  packsToLoad,
  parseContentPack,
  defaultLocalization,
  DictionaryI18n,
  loadQuestSections,
  Quest,
  readFromString,
  TILE_PIXELS_PER_SQUARE,
  WEB_TEXTURE_EXTENSIONS,
} from '@valkyrie/core'
import type { ContentContext, ContentPack, Localization, QuestComponent } from '@valkyrie/core'
import type { FileSystem } from './filesystem.js'
import { combine } from './path.js'

/** The `[ContentPackData]` section names the inis a pack is made of. */
const PACK_INI = 'content_pack.ini'

export interface LoadedContent {
  content: ContentData
  context: ContentContext
  /** Pack directories that were read, for reporting. */
  packs: string[]
  /** Every pack found, whether or not it was loaded. */
  available: {
    id: string
    name: string
    type: string
    /** Box art, already resolved against the pack or the import. */
    image: string
    clone: readonly string[]
  }[]
  /** The ids actually loaded, which is what a scenario tests for. */
  loaded: string[]
}

export interface ContentOptions {
  /** Directory holding one subdirectory per content pack. */
  root: string
  /** Where FFG-imported assets were written. */
  importPath: string
  gameType: 'MoM' | 'D2E'
  localization?: Localization
  /**
   * Pack ids the player owns, from the `<GameType>Packs` config section. The
   * base pack loads regardless; anything not named here stays off, because a
   * scenario tests `#<packId>` to decide what it may ask the player to place.
   *
   * Left out, everything found is loaded — which is what the tools and the
   * differential harnesses want, and never what a player wants.
   */
  selected?: Iterable<string>
  /** `GameType.BaseContentPackId()`. Loaded whatever the selection says. */
  basePackId?: string
  /**
   * Directory holding Valkyrie's own `Localization*.txt`, which become the
   * `val` dictionary. `Game.cs:285` reads it from `<content>/../text`.
   */
  uiText?: string
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

  if (options.uiText !== undefined) {
    context.localization.addDictionary(
      'val',
      await readDictionary(fs, await uiTextFiles(fs, options.uiText)),
    )
  }

  // `GameSelectionScreen.loadLocalization` reads the imported text once, and
  // skips the whole block when `ffg` is already registered. Without it every
  // name the game itself ships — monsters, attacks, items — stays a raw key.
  if (context.localization.selectDictionary('ffg') === null) {
    const text = combine(options.importPath, 'text')
    context.localization.addDictionary(
      'ffg',
      await readDictionary(fs, await ffgTextFiles(fs, text)),
    )
    // The Dunwich Horror data is a separate dictionary of its own.
    context.localization.addDictionary(
      'csh',
      await readDictionary(
        fs,
        await matchingFiles(fs, text, /^SCENARIO_CULT_OF_SENTINEL_HILL_MAD22_.*\.txt$/),
      ),
    )
  }

  const found = await findPacks(fs, options.root)

  // Read every pack's identity first: the selection names ids, the packs are
  // directories, and a pack can pull in others by id.
  const identified: { dir: string; pack: ContentPack }[] = []
  for (const dir of found) {
    const pack = parseContentPack(readFromString(await fs.readText(combine(dir, PACK_INI))), {
      path: dir,
      importPath: options.importPath,
    })
    if (pack === null) continue
    identified.push({ dir, pack })
    // Every pack found is registered, not just the loaded ones — `ContentData`
    // scans the whole directory in the C#, and `GetContentName` has to be able
    // to name a pack the player has not selected.
    content.addPack(pack)
  }

  const wanted =
    options.selected === undefined
      ? null
      : packsToLoad(
          identified.map(({ pack }) => pack),
          options.selected,
          options.basePackId ?? '',
        )

  const packs: string[] = []
  const loaded: string[] = []
  for (const { dir, pack } of identified) {
    if (wanted !== null && !wanted.has(pack.id)) continue
    packs.push(dir)
    loaded.push(pack.id)
    const packDir = dir
    const manifest = await packManifest(fs, packDir)
    // Before the inis, not after: a `{dict:KEY}` value resolves against
    // whatever is registered as it is parsed. `ContentLoader.cs:95`.
    for (const [id, files] of manifest.localization) {
      context.localization.addDictionary(id, await readDictionary(fs, files))
    }
    for (const name of manifest.files) {
      const path = combine(packDir, name)
      if (!(await fs.exists(path))) continue
      loader.loadIni(readFromString(await fs.readText(path)), packDir, packDir)
    }
  }

  return {
    content,
    context,
    packs,
    available: identified.map(({ pack }) => ({
      id: pack.id,
      name: pack.name,
      type: pack.type,
      // A pack names its art either beside itself or in the import, and the
      // resolver already covers both roots.
      image: resolve(pack.image ?? '') ?? '',
      clone: pack.clone,
    })),
    loaded,
  }
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

interface PackManifest {
  /** `content_pack.ini` first, then whatever `[ContentPackData]` names. */
  files: string[]
  /** Dictionary id to the files it is built from, from `[LanguageData]`. */
  localization: Map<string, string[]>
}

/** Reads the two sections of `content_pack.ini` that name other files. */
async function packManifest(fs: FileSystem, packDir: string): Promise<PackManifest> {
  const files = [PACK_INI]
  const localization = new Map<string, string[]>()
  let section = ''
  for (const raw of await fs.readLines(combine(packDir, PACK_INI))) {
    const line = raw.trim()
    if (line.startsWith('[')) {
      section = line.replace(/^\[|\]$/g, '')
      continue
    }
    if (line.length === 0 || line.startsWith('#')) continue
    const key = line.includes('=') ? line.slice(0, line.indexOf('=')).trim() : line
    if (key.length === 0) continue
    if (section === 'ContentPackData') files.push(key)
    // Keys are "<dictId> <relative file>".
    if (section === 'LanguageData') {
      const space = key.indexOf(' ')
      if (space === -1) continue
      const id = key.slice(0, space)
      const entry = localization.get(id)
      const path = combine(packDir, key.slice(space + 1))
      if (entry === undefined) localization.set(id, [path])
      else entry.push(path)
    }
  }
  return { files, localization }
}

/** Builds one dictionary from however many files feed it. */
async function readDictionary(fs: FileSystem, files: readonly string[]): Promise<DictionaryI18n> {
  const dict = new DictionaryI18n()
  for (const file of files) {
    if (!(await fs.exists(file))) continue
    dict.addData(await fs.readLines(file))
  }
  return dict
}

/**
 * The imported `Localization_*.txt` files that hold the game's own text.
 *
 * The C# drops any whose *name* contains a digit: the import writes numbered
 * companions alongside the per-language files, and reading them in corrupts
 * the dictionary.
 */
async function ffgTextFiles(fs: FileSystem, dir: string): Promise<string[]> {
  const files = await matchingFiles(fs, dir, /^Localization_.*\.txt$/)
  return files.filter((path) => !/\d/.test(path.slice(path.lastIndexOf('/') + 1)))
}

/** Files in a directory whose name matches, or nothing when it is absent. */
async function matchingFiles(fs: FileSystem, dir: string, name: RegExp): Promise<string[]> {
  if (!(await fs.exists(dir))) return []
  return (await fs.list(dir))
    .filter((e) => e.kind !== 'directory' && name.test(e.path.slice(e.path.lastIndexOf('/') + 1)))
    .map((e) => e.path)
}

/** Every `Localization*.txt` in a directory, or nothing when it is absent. */
async function uiTextFiles(fs: FileSystem, dir: string): Promise<string[]> {
  if (!(await fs.exists(dir))) return []
  return (await fs.list(dir))
    .filter((e) => e.kind !== 'directory' && /\/Localization[^/]*\.txt$/.test(e.path))
    .map((e) => e.path)
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
export async function loadQuest(
  fs: FileSystem,
  dir: string,
  localization: Localization = defaultLocalization,
): Promise<LoadedQuest> {
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

  await addQuestText(
    fs,
    dir,
    questIni.data.get('QuestText'),
    localization,
    quest.defaultLanguage,
  )

  return { quest, components, path: dir }
}

/**
 * Registers the scenario's own text as the `qst` dictionary.
 *
 * Removed first, as `QuestData.cs:129` does: the dictionary is per-scenario,
 * and merging the last one into the next leaves stale keys answering lookups.
 */
async function addQuestText(
  fs: FileSystem,
  dir: string,
  section: Map<string, string> | undefined,
  localization: Localization,
  defaultLanguage: string,
): Promise<void> {
  const files = [...(section?.keys() ?? [])]
    .filter((name) => name.length > 0)
    .map((name) => combine(dir, name))

  const dict = await readDictionary(fs, files)
  // `QuestData.cs:2273`. A scenario written in another language keeps its own
  // `defaultlanguage`, and setting it is what makes that language *searched*:
  // a lookup only visits the required ones, and a key the author never
  // translated into English is otherwise reported as missing and drawn as its
  // own name — `EventStart.button1` on the button it belongs to.
  dict.defaultLanguage = defaultLanguage

  localization.removeDictionary('qst')
  localization.addDictionary('qst', dict)
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
