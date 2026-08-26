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
import type { CameraCommand } from '@valkyrie/core'
import { bundleQuest, QuestSession } from '@valkyrie/core'
import type { ContentData, QuestComponent, TraitedMonster } from '@valkyrie/core'

export interface QuestEntry {
  /** Directory under the quest root. */
  id: string
  path: string
  name: string
  type: string
  format: number
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
    try {
      const loaded = await loadQuest(fs, entry.path)
      quests.push({
        id: entry.path.slice(entry.path.lastIndexOf('/') + 1),
        path: entry.path,
        // The quest's own name needs its localization; the directory name is
        // what is available without loading one, and is what the download
        // named it.
        name: entry.path.slice(entry.path.lastIndexOf('/') + 1),
        type: loaded.quest.type,
        format: loaded.quest.format,
      })
    } catch {
      // A half-extracted package should not hide the rest of the library.
    }
  }

  return { hasContent: packs.length > 0, packs, quests }
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

  const { MonsterData: Monsters, ActivationData: Activations } = await import('@valkyrie/core')
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
    gameType,
    localization: content.context.localization,
    loadedPacks: content.loaded,
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
  }
}
