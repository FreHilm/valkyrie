/**
 * What the browser has: which content is imported, and which quests are ready
 * to play.
 *
 * The Unity app answers this by scanning directories on the real filesystem at
 * startup and holding the result in `Game`. Here it is a value the shell can
 * ask for, so a screen can show what is missing and what to do about it — the
 * C# equivalent is a silent empty quest list when the import never ran.
 */

import { loadContent, loadQuest, textureResolver } from '@valkyrie/platform'
import type { FileSystem, StoragePaths } from '@valkyrie/platform'
import type { AudioRequest, CameraCommand } from '@valkyrie/core'
import {
  bundleQuest,
  CONTENT_PACK_INI,
  DictionaryI18n,
  packsToLoad,
  parseContentPack,
  Quest,
  QuestSession,
  readFromString,
  slidePuzzleLayouts,
} from '@valkyrie/core'
import type { ContentData, QuestComponent, TraitedMonster } from '@valkyrie/core'

export interface QuestEntry {
  /** Directory under the quest root. */
  id: string
  path: string
  /**
   * The scenario's own title, from its `Localization.*.txt`.
   *
   * Falls back to the directory name, which is what the download called it —
   * legible, but `MoM__ExoticMaterial` rather than "Exotic Material".
   */
  name: string
  type: string
  format: number
  /** The blurb the author wrote, when the scenario carries one. */
  description: string
  /** Cover art, as a path in storage. Empty when the scenario ships none. */
  image: string
  /** Content packs the scenario needs, already expanded. */
  packs: readonly string[]
  difficulty: number
  lengthMin: number
  lengthMax: number
  minHero: number
  maxHero: number
}

export interface LibraryState {
  /** Whether any content pack has been imported or installed. */
  hasContent: boolean
  /** Content packs found, by directory. */
  packs: string[]
  quests: QuestEntry[]
}

export interface LibraryPaths {
  /** Root holding one directory per content pack. */
  content: string
  /** Root holding one directory per extracted quest. */
  quests: string
  /** Where FFG-imported assets landed. */
  imported: string
  /** Directory holding Valkyrie's own `Localization*.txt`. */
  uiText: string
}

export function libraryPaths(paths: StoragePaths): LibraryPaths {
  return {
    content: paths.contentPath,
    quests: paths.downloadPath,
    imported: paths.importPath,
    uiText: paths.uiTextPath,
  }
}

/**
 * Surveys what is available without loading any of it.
 *
 * A quest is listed from its own `quest.ini` rather than a manifest, so a
 * package dropped in by hand appears alongside downloaded ones.
 */
export async function surveyLibrary(fs: FileSystem, paths: LibraryPaths): Promise<LibraryState> {
  const packs: string[] = []
  const queue = [paths.content]
  while (queue.length > 0) {
    const dir = queue.shift()
    if (dir === undefined) continue
    if (await fs.exists(`${dir}/content_pack.ini`)) packs.push(dir)
    for (const entry of await fs.list(dir)) {
      if (entry.kind === 'directory') queue.push(entry.path)
    }
  }

  const quests: QuestEntry[] = []
  for (const entry of await fs.list(paths.quests)) {
    if (entry.kind !== 'directory') continue
    if (!(await fs.exists(`${entry.path}/quest.ini`))) continue
    const id = entry.path.slice(entry.path.lastIndexOf('/') + 1)
    try {
      quests.push(await describeQuest(fs, entry.path, id))
    } catch {
      // A half-extracted package should not hide the rest of the library.
    }
  }

  return { hasContent: packs.length > 0, packs, quests }
}

/**
 * The packs that are actually loaded, given what the player selected.
 *
 * `ContentData.GetLoadedPackIDs` in the C#, which the quest list tests a
 * scenario's requirements against. It is not the same as the selection: the
 * base pack is always in, and a pack pulls in whatever it clones — so a
 * scenario asking for a pack the player never ticked may still be playable
 * because something they did tick brings it along.
 *
 * Reads each pack's ini rather than loading the content, because a listing
 * needs the ids and the clone links and nothing else.
 */
export async function loadedPackIds(
  fs: FileSystem,
  packDirectories: readonly string[],
  selected: readonly string[],
  baseId: string,
): Promise<Set<string>> {
  const available: { id: string; clone: string[] }[] = []
  for (const dir of packDirectories) {
    try {
      const pack = parseContentPack(
        readFromString(await fs.readText(`${dir}/${CONTENT_PACK_INI}`)),
        {
          path: dir,
          importPath: '',
        },
      )
      if (pack !== null) available.push({ id: pack.id, clone: pack.clone })
    } catch {
      // A pack that will not parse cannot be loaded either; leaving it out
      // here matches what the content loader would do with it.
    }
  }
  return packsToLoad(available, selected, baseId)
}

/**
 * One scenario, from its `quest.ini` and its title.
 *
 * Deliberately not `loadQuest`, which parses every ini in the package to build
 * the components — a listing needs none of that, and there is a second reason
 * to avoid it here: `loadQuest` registers the scenario's text as the `qst`
 * dictionary, so surveying a library used to leave whichever quest happened to
 * be last answering every `{qst:…}` lookup in the app.
 *
 * Two files instead: the ini for the metadata, and the default language's
 * strings for the name and blurb, which are not in the ini at all.
 */
async function describeQuest(fs: FileSystem, path: string, id: string): Promise<QuestEntry> {
  const ini = readFromString(await fs.readText(`${path}/quest.ini`))
  const quest = new Quest(path, ini.data.get('Quest') ?? new Map())

  const text = await questStrings(fs, path, quest.defaultLanguage, ini.data.get('QuestText'))

  // `getValue` answers a missing key with the key itself, so "quest.name" is
  // what an absent title looks like — not an empty string.
  const string = (key: string, fallback: string): string =>
    text !== null && text.keyExists(key) ? text.getValue(key) : fallback

  return {
    id,
    path,
    name: string('quest.name', id),
    type: quest.type,
    format: quest.format,
    description: string('quest.description', ''),
    image: quest.image.length === 0 ? '' : `${path}/${quest.image}`,
    packs: quest.packs,
    difficulty: quest.difficulty,
    lengthMin: quest.lengthMin,
    lengthMax: quest.lengthMax,
    minHero: quest.minHero,
    maxHero: quest.maxHero,
  }
}

/**
 * A scenario's own strings, in its default language.
 *
 * `[QuestText]` lists the files, but the name is wanted before any of that is
 * parsed, so the conventional filename is tried first and the section is only
 * consulted when it is not there. Returns null rather than throwing: a package
 * with no readable text still has a directory name to show.
 */
async function questStrings(
  fs: FileSystem,
  path: string,
  language: string,
  section: Map<string, string> | undefined,
): Promise<DictionaryI18n | null> {
  const candidates = [`Localization.${language}.txt`, ...(section?.keys() ?? [])]

  for (const file of candidates) {
    try {
      const lines = (await fs.readText(`${path}/${file}`)).split(/\r?\n/)
      const dictionary = new DictionaryI18n(lines)
      dictionary.defaultLanguage = language
      dictionary.currentLanguage = language
      // A file that parsed but holds no title is the wrong file, not the
      // answer: keep looking rather than reporting the key back as a name.
      if (dictionary.keyExists('quest.name')) return dictionary
    } catch {
      // Try the next candidate.
    }
  }
  return null
}

/**
 * Every `quest.ini` beneath a directory, as paths relative to it.
 *
 * `EventManager.cs:124` resolves a handover against `originalPath` — the
 * directory the *first* quest came from — so a sub-quest handing over to a
 * sibling still names its path from the top.
 */
async function nestedQuests(fs: FileSystem, root: string): Promise<Set<string>> {
  const found = new Set<string>()
  const queue = [root]
  while (queue.length > 0) {
    const dir = queue.shift()
    if (dir === undefined) continue
    for (const entry of await fs.list(dir)) {
      if (entry.kind === 'directory') queue.push(entry.path)
      else if (entry.path.endsWith('/quest.ini') && entry.path !== `${root}/quest.ini`) {
        found.add(entry.path.slice(root.length + 1))
      }
    }
  }
  return found
}

/** `ChangeQuest` strips a leading separator before joining the path. */
export function normaliseQuestPath(name: string): string {
  return name.replace(/\\/g, '/').replace(/^\/+/, '')
}

export interface StartedQuest {
  session: QuestSession
  /** Resolves a content image path to a file that exists. */
  resolveTexture: (name: string) => string | null
  /** The loaded content, for looking up what each board item looks like. */
  content: ContentData
  components: ReadonlyMap<string, QuestComponent>
  gameType: 'MoM' | 'D2E'
  /** The tile scale in force, for sizes given as "Original". */
  pixelsPerSquare: number
  /** The `[Quest]` section, which says how many investigators it takes. */
  quest: Quest
  /** The packs that were loaded, which a save records so a load asks again. */
  loadedPacks: string[]
}

/**
 * Loads everything a scenario needs and starts it.
 *
 * The order matters: content first, because the quest's spawns resolve against
 * it, and the texture resolver before either, because content drops a token
 * whose art it cannot find while parsing.
 */
export async function startQuest(
  fs: FileSystem,
  paths: LibraryPaths,
  questPath: string,
  options: {
    gameType?: 'MoM' | 'D2E'
    android?: boolean
    /**
     * The directory the first quest came from. A handover names its target
     * from there, so a sub-quest has to keep looking for siblings at the top
     * rather than beneath itself.
     */
    questRoot?: string
    /** Where an event asks the camera to look. */
    camera?: (command: CameraCommand) => void
    /** A sound the quest asked for. */
    playAudio?: (request: AudioRequest) => void
    /**
     * `SaveManager.Save(0)`: the autosave, which the round controller asks for
     * at the start of every round.
     */
    save?: () => void
    /** Pack ids the player owns. Everything found loads when this is absent. */
    selectedPacks?: Iterable<string>
    /** The pack that loads whatever the selection says. */
    basePackId?: string
  } = {},
): Promise<StartedQuest> {
  // Content first, quest second: both register dictionaries, and the
  // scenario's own text has to win where a key collides.
  const gameType =
    options.gameType ?? ((await loadQuest(fs, questPath)).quest.type === 'D2E' ? 'D2E' : 'MoM')

  const content = await loadContent(fs, {
    root: paths.content,
    importPath: paths.imported,
    uiText: paths.uiText,
    gameType,
    // `Game.SelectQuest` loads what the player owns and nothing else, so a
    // scenario's `#<packId>` tests answer for their table rather than for the
    // content directory. Left out, every pack found is loaded.
    ...(options.selectedPacks === undefined
      ? {}
      : { selected: options.selectedPacks, basePackId: options.basePackId ?? '' }),
    ...(options.android === undefined ? {} : { android: options.android }),
  })

  const quest = await loadQuest(fs, questPath, content.context.localization)

  const {
    MonsterData: Monsters,
    ActivationData: Activations,
    ItemData: Items,
    TileSideData: TileSides,
  } = await import('@valkyrie/core')
  const contentMonsters = new Map<
    string,
    TraitedMonster & { sectionName: string; activations: readonly string[] }
  >()
  for (const [name, monster] of content.content.getAll(Monsters)) {
    contentMonsters.set(name, {
      traits: monster.traits,
      sectionName: monster.sectionName,
      activations: monster.activations,
    })
  }

  // A scenario can hand over to another one by naming its `quest.ini`, and
  // the check has to be synchronous — so the paths are listed once here
  // rather than probed when the event fires.
  const nested = await nestedQuests(fs, options.questRoot ?? questPath)

  const session = new QuestSession({
    bundle: bundleQuest(quest.components),
    components: quest.components,
    contentMonsters,
    contentActivations: new Map(content.content.getAll(Activations)),
    // `getComponentText` reads these out of `ContentData` to turn a `{c:...}`
    // marker into what the thing is called. Null when the content has no such
    // entry, which leaves the marker's own name showing rather than a blank.
    contentName: (kind, name) => {
      const data =
        kind === 'tileSide'
          ? content.content.tryGet(TileSides, name)
          : kind === 'monster'
            ? content.content.tryGet(Monsters, name)
            : content.content.tryGet(Items, name)
      return data === undefined ? null : data.name.translate()
    },
    gameType,
    localization: content.context.localization,
    loadedPacks: content.loaded,
    // A slide puzzle is picked from a shipped set rather than generated.
    // Without them `PuzzleSlide.generate` returns null and the event falls
    // back to drawing itself as an ordinary dialog.
    slideLayouts: slidePuzzleLayouts(),
    ...(options.save === undefined ? {} : { save: options.save }),
    ...(options.playAudio === undefined ? {} : { playAudio: options.playAudio }),
    isQuestTransition: (name) => nested.has(normaliseQuestPath(name)),
    ...(options.camera === undefined ? {} : { camera: options.camera }),
  })

  return {
    session,
    resolveTexture: await textureResolver(fs, [paths.content, paths.imported, questPath]),
    content: content.content,
    components: quest.components,
    gameType,
    pixelsPerSquare: content.context.tilePixelPerSquare,
    quest: quest.quest,
    /** The packs that were loaded, which a save records so a load asks again. */
    loadedPacks: [...content.loaded],
  }
}
