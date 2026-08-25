/**
 * The app shell.
 *
 * Wires the ported pieces into something runnable: the unit system, the
 * screens, the board renderer and the storage layer. It is deliberately a
 * *shell* — the play loop it will eventually drive is not finished — but it
 * makes the foundation inspectable in a real browser, which no test does.
 *
 * What it demonstrates today: the unit system responding to the viewport, the
 * component set, trait filtering over a quest list, the board renderer with
 * pan/zoom and hit testing, and the storage screen.
 */

import {
  activationDialog,
  board,
  endGame,
  inventory,
  options,
  importScreen,
  monsterDialog,
  playScreen,
  questLog,
  button,
  el,
  eventDialog,
  heroSelection,
  installUnits,
  itemsFrom,
  label,
  mainMenu,
  panel,
  questDetails,
  questSelection,
  rawText,
  Layer,
} from '@valkyrie/ui'
import {
  ActivationInstance,
  attackTypes,
  LogEntry,
  MoMPhase,
  randomAttack,
  QuestRuntime,
  RoundControllerMoM,
  StringKey,
} from '@valkyrie/core'
import type { ActivationView, AttackView, EventsView, MonsterInstance } from '@valkyrie/core'
import {
  canPickDirectory,
  canvasTextureEncoder,
  FetchHttpClient,
  importFfgApp,
  isUnityAsset,
  MemoryFileSystem,
  OpfsFileSystem,
  CompositeAssetSource,
  PickedDirectorySource,
  StoragePaths,
  TextureCache,
} from '@valkyrie/platform'
import type { Crop, PickedDirectory, StorageManagerLike } from '@valkyrie/platform'
import { acquireQuest } from './acquire.js'
import { devManifest, loadFromDevServer } from './devLoad.js'
import { browsableQuests, byRecency, fetchQuestIndex, packageUrl } from './questIndex.js'
import { libraryPaths, startQuest, surveyLibrary } from './library.js'
import { questArt, tileImages } from './questArt.js'
import { formatBytes, storageReport } from './storage.js'
import { persistenceMessage, requestPersistence } from './persistence.js'
import { watchForUpdate } from './serviceWorker.js'

declare const __VALKYRIE_VERSION__: string

/**
 * A quest with no events, so the activation demo exercises the round
 * controller without a scenario behind it.
 */
const NO_EVENTS: EventsView = {
  current: null,
  monsterImage: null,
  queued: [],
  triggerType: () => false,
  triggerEvent: () => {},
  queue: () => false,
  isDisabled: () => false,
}

const mount = document.getElementById('app')
if (mount === null) throw new Error('No #app element to mount into')
const root: HTMLElement = mount

installUnits(document.documentElement, window)

/** Swaps the visible screen. One at a time, as the Unity app does. */
function show(...nodes: (Node | null)[]): void {
  root.replaceChildren(...nodes.filter((n): n is Node => n !== null))
}

const backTo = (screen: () => void): HTMLElement =>
  button(rawText('← Back'), { onPress: screen, variant: 'secondary' })

/** A few real quest names, so the filtering has something to work on. */
const QUESTS = itemsFrom([
  {
    key: 'lynch',
    display: 'The Fall of House Lynch',
    traits: { Source: ['MoM'], Type: ['Official'] },
  },
  {
    key: 'petshop',
    display: "22:30h At The Bird's Pet Shop",
    traits: { Source: ['MoM'], Type: ['Community'] },
  },
  { key: 'exotic', display: 'Exotic Material', traits: { Source: ['MoM'], Type: ['Community'] } },
  { key: 'truth', display: 'The Truth', traits: { Source: ['MoM'], Type: ['Community'] } },
  { key: 'daerion', display: 'Castle Daerion', traits: { Source: ['D2E'], Type: ['Official'] } },
  { key: 'firstblood', display: 'First Blood', traits: { Source: ['D2E'], Type: ['Official'] } },
])

function menu(): void {
  show(
    panel({
      class: 'vk-shell',
      children: [
        label(rawText('Valkyrie'), { size: 'large', heading: 1 }),
        label(rawText(`Web port · ${__VALKYRIE_VERSION__}`), { class: 'vk-shell__version' }),
        mainMenu({
          title: rawText('Main menu'),
          actions: [
            { label: rawText('Play a quest'), onPress: () => void library() },
            { label: rawText('Import game files'), onPress: importDemo },
            { label: rawText('Load from dev server'), onPress: () => void devLoad() },
            { label: rawText('Browse scenarios'), onPress: () => void browseScenarios() },
            { label: rawText('Add a scenario'), onPress: addScenario },
            { label: rawText('Browse quests'), onPress: quests },
            { label: rawText('Board renderer'), onPress: boardDemo },
            { label: rawText('Event dialog'), onPress: eventDemo },
            { label: rawText('Monster activation'), onPress: activationDemo },
            { label: rawText('Attack a monster'), onPress: monsterDemo },
            { label: rawText('Quest log'), onPress: logDemo },
            { label: rawText('Items'), onPress: inventoryDemo },
            { label: rawText('End of quest'), onPress: endGameDemo },
            { label: rawText('Options'), onPress: optionsDemo },
            { label: rawText('Choose investigators'), onPress: heroesDemo },
            {
              label: rawText('Storage'),
              // The menu takes a void handler; the screen is async.
              onPress: () => void storage(),
            },
          ],
        }),
      ],
    }),
  )
}

function quests(): void {
  show(
    panel({
      class: 'vk-shell',
      children: [
        backTo(menu),
        questSelection({
          quests: QUESTS,
          onPick: (id) => details(id),
          title: rawText('Quests'),
          searchLabel: rawText('Search quests'),
          emptyMessage: rawText('No quest matches those filters.'),
          sourceWording: 'Source',
        }),
      ],
    }),
  )
}

function details(id: string): void {
  const quest = QUESTS.find((q) => q.key === id)
  show(
    panel({
      class: 'vk-shell',
      children: [
        backTo(quests),
        questDetails({
          name: quest?.display ?? id,
          description:
            'Quest details come from the ini once the runtime is wired to a real package.',
          actions: [{ label: rawText('Start'), onPress: heroesDemo }],
        }),
      ],
    }),
  )
}

function heroesDemo(): void {
  const selection = heroSelection({
    available: [
      { id: 'agnes', name: 'Agnes Baker' },
      { id: 'bob', name: 'Bob Jenkins' },
      { id: 'carolyn', name: 'Carolyn Fern' },
      { id: 'dexter', name: 'Dexter Drake' },
      { id: 'jim', name: 'Jim Culver' },
    ],
    required: 2,
    title: rawText('Choose investigators'),
    confirmLabel: rawText('Begin'),
    countLabel: (chosen, total) => `${chosen} of ${total} chosen`,
    onConfirm: () => boardDemo(),
  })
  show(panel({ class: 'vk-shell', children: [backTo(menu), selection.element] }))
}

function eventDemo(): void {
  const dialog = eventDialog()
  dialog.show({
    text:
      'The hallway is dark, and something has been dragged across the floorboards.\n\n' +
      'A door at the far end stands slightly open.',
    buttons: [
      { text: 'Open the door', onPress: () => dialog.show(followUp) },
      { text: 'Turn back', onPress: menu },
    ],
  })
  const followUp = {
    text: 'Behind it, the smell is worse.',
    buttons: [{ text: 'Continue', onPress: menu }],
  }
  show(panel({ class: 'vk-shell', children: [backTo(menu), dialog.element] }))
}

/**
 * A Mansions monster activation, driven by the real round controller.
 *
 * The activation text is resolved through `ActivationInstance`, so what shows
 * here is what a scenario's own text would produce — substitution, symbols and
 * newlines included.
 */
function activationDemo(): void {
  const runtime = new QuestRuntime({ components: new Map() })
  runtime.heroes.push({ heroName: 'Ashcan Pete', activated: false })

  const literal = (value: string): StringKey => new StringKey(null, value, false)
  const zombie: ActivationView = {
    sectionName: 'MonsterActivationZombieA',
    ability: literal('The {0} drags itself toward the nearest light.'),
    minionActions: literal(''),
    masterActions: literal('Attack the nearest investigator. Horror 2.'),
    moveButton: literal('The {0} moves'),
    move: literal('Move the {0} one space toward the nearest investigator.'),
    minionFirst: false,
    masterFirst: false,
  }

  const status = el('p', { class: 'vk-shell__status', attrs: { 'aria-live': 'polite' } })
  const entries = el('ul', { class: 'vk-shell__log' })
  const dialog = activationDialog({
    onLog: (entry) => entries.append(el('li', { text: entry })),
    onFinished: () => {
      controller.monsterActivated()
      status.textContent = 'Every monster has acted.'
    },
  })

  let damage = 0
  let showing: MonsterInstance | null = null

  const render = (): void => {
    const instance = showing?.currentActivation
    if (instance === undefined || instance === null) return
    dialog.show({
      monsterName: 'Zombie',
      effect: instance.effect,
      attack: instance.masterActions,
      move: instance.move,
      moveLabel: instance.ad.moveButton.translate().split('{0}').join('Zombie'),
      healthTracker: {
        health: 3,
        damage,
        onDamageChange: (next) => {
          damage = next
          render()
        },
        onDefeated: () => {
          status.textContent = 'The Zombie is defeated.'
        },
      },
    })
  }

  const controller = new RoundControllerMoM({
    runtime,
    events: NO_EVENTS,
    monsterTypes: new Map([['MonsterZombie', { sectionName: 'MonsterZombie', activations: [] }]]),
    contentActivations: new Map([['MonsterActivationZombieA', zombie]]),
    questActivations: new Map(),
    random: () => 0,
    resolveActivation: (activation) =>
      new ActivationInstance(activation, {
        monsterName: 'Zombie',
        gameType: 'MoM',
        vars: runtime.vars,
      }),
    present: (request) => {
      if (request.kind !== 'activationMoM') return
      showing = request.monster
      render()
    },
  })

  runtime.spawnMonster('MonsterZombie', 'demo')
  controller.phase = MoMPhase.monsters
  controller.activateMonster()

  show(
    panel({
      class: 'vk-shell',
      children: [backTo(menu), dialog.element, status, label(rawText('Quest log')), entries],
    }),
  )
}

/**
 * Attacking, evading and the horror check, driven by the real selection logic.
 *
 * The attack buttons come from `attackTypes` and the text from `randomAttack`,
 * so what shows is what a content pack's own `Attack` sections would produce.
 */
function monsterDemo(): void {
  const literal = (value: string): StringKey => new StringKey(null, value, false)
  const attacks: AttackView[] = [
    { target: 'human', attackType: 'heavy', text: literal('You strike the {0} with everything.') },
    { target: 'human', attackType: 'unarmed', text: literal('You batter at the {0} bare-handed.') },
    { target: 'human', attackType: 'heavy', text: literal('Your blow lands hard on the {0}.') },
  ]
  const type = { traits: ['human'] }
  const named = (text: string): string => text.split('{0}').join('Zombie')

  const entries = el('ul', { class: 'vk-shell__log' })
  const status = el('p', { class: 'vk-shell__status', attrs: { 'aria-live': 'polite' } })
  const dialog = monsterDialog({ onLog: (entry) => entries.append(el('li', { text: entry })) })

  let damage = 0
  const render = (): void => {
    dialog.show({
      monsterName: 'Zombie',
      horrorPhase: false,
      health: {
        health: 3,
        damage,
        onDamageChange: (next) => {
          damage = Math.min(Math.max(next, 0), 3)
          render()
        },
        onDefeated: () => {
          status.textContent = 'The Zombie is defeated.'
        },
      },
      attackTypes: attackTypes(type, attacks),
      onAttack: (chosen) => {
        const text = randomAttack(type, chosen, attacks, (n) => Math.floor(Math.random() * n))
        return text === null ? null : named(text.translate())
      },
      onEvade: () => named('You slip past the {0} into the next room.'),
      onHorror: () => null,
      onCancel: () => menu(),
    })
  }
  render()

  show(
    panel({
      class: 'vk-shell',
      children: [backTo(menu), dialog.element, status, label(rawText('Quest log')), entries],
    }),
  )
}

/**
 * The community's published scenario list.
 *
 * 169 for Mansions, fetched as one ini and browsed through the same
 * trait-filtered list the game uses — the filtering logic verified against the
 * C# over 3,015 cases. Both the index and the packages are on
 * raw.githubusercontent.com, which allows cross-origin reads, so a browser can
 * do this directly.
 */
async function browseScenarios(): Promise<void> {
  const status = el('p', { class: 'vk-shell__status', attrs: { 'aria-live': 'polite' } })
  show(
    panel({
      class: 'vk-shell',
      children: [backTo(menu), label(rawText('Fetching the scenario list…')), status],
    }),
  )

  const fs = new OpfsFileSystem(navigator.storage as unknown as StorageManagerLike)
  const paths = libraryPaths(
    new StoragePaths({ appData: '/appdata', content: '/content', temp: '/tmp' }, 'MoM'),
  )

  let entries
  try {
    entries = byRecency(await fetchQuestIndex({ http: new FetchHttpClient(), gameType: 'MoM' }))
  } catch (error) {
    status.textContent =
      error instanceof Error
        ? `The scenario list could not be fetched: ${error.message}`
        : 'The scenario list could not be fetched.'
    return
  }

  const installed = new Set(
    (await surveyLibrary(fs, paths).catch(() => null))?.quests.map((q) => q.id) ?? [],
  )

  const download = async (id: string): Promise<void> => {
    const entry = entries.find((e) => e.id === id)
    if (entry === undefined) return
    status.textContent = `Downloading ${entry.id}…`
    try {
      const result = await acquireQuest(packageUrl(entry), {
        fs,
        http: new FetchHttpClient(),
        questRoot: paths.quests,
        onProgress: (fraction) => {
          status.textContent = `Downloading ${entry.id}… ${Math.round(fraction * 100)}%`
        },
      })
      status.textContent = `Added ${result.id}: ${String(result.files)} files, ${formatBytes(result.bytes)}. Open it from Play a quest.`
    } catch (error) {
      status.textContent =
        error instanceof Error ? `That did not work: ${error.message}` : 'That did not work.'
    }
  }

  show(
    panel({
      class: 'vk-shell',
      children: [
        backTo(menu),
        questSelection({
          quests: browsableQuests(entries, installed),
          onPick: (id) => void download(id),
          title: rawText(`Scenarios (${String(entries.length)})`),
          searchLabel: rawText('Search scenarios'),
          emptyMessage: rawText('No scenario matches those filters.'),
        }),
        status,
      ],
    }),
  )
}

/**
 * Loading the command-line importer's output.
 *
 * Chrome refuses `showDirectoryPicker` on anything under `~/Library`, and on
 * macOS that is where both the game install and its downloaded content live —
 * so the in-browser import cannot reach them on this platform at all. This
 * copies what `tools/ffg/run-import.mjs` produced into browser storage
 * instead. It only works against the dev server.
 */
async function devLoad(): Promise<void> {
  const status = el('p', { class: 'vk-shell__status', attrs: { 'aria-live': 'polite' } })
  const bar = el('progress', { class: 'vk-import__progress' })

  show(
    panel({
      class: 'vk-shell',
      children: [
        backTo(menu),
        label(rawText('Load from dev server'), { size: 'large', heading: 1 }),
        label(
          rawText(
            'Chrome will not open folders under ~/Library, which is where the game ' +
              'install and its downloaded content both live on macOS. This copies ' +
              'what `npm run import` already produced into browser storage.',
          ),
        ),
        status,
        bar,
      ],
    }),
  )

  const manifest = await devManifest()
  if (manifest === null || !manifest.available) {
    status.textContent =
      manifest === null
        ? 'The dev server is not answering. This only works under `npm run dev`.'
        : 'Nothing imported yet. Run the command-line importer first.'
    return
  }

  const fs = new OpfsFileSystem(navigator.storage as unknown as StorageManagerLike)
  const paths = libraryPaths(
    new StoragePaths({ appData: '/appdata', content: '/content', temp: '/tmp' }, 'MoM'),
  )

  try {
    const result = await loadFromDevServer(
      fs,
      manifest,
      { contentRoot: paths.content, importPath: paths.imported, questRoot: paths.quests },
      (done, total, what) => {
        bar.max = total
        bar.value = done
        status.textContent = `${String(done)} of ${String(total)} — ${what}`
      },
    )
    status.textContent =
      `Loaded ${String(result.files)} files, ${formatBytes(result.bytes)}, ` +
      `${String(result.quests.length)} scenarios. Open Play a quest.`
  } catch (error) {
    status.textContent = error instanceof Error ? `That did not work: ${error.message}` : 'Failed.'
  }
}

/**
 * Downloading a scenario package into browser storage.
 *
 * Valkyrie's own quest browser reads an index the community publishes; that
 * index is a separate piece of work. A URL is the honest interim: it is what
 * the index would hand over anyway, and it works for a package hosted
 * anywhere.
 */
function addScenario(): void {
  const status = el('p', { class: 'vk-shell__status', attrs: { 'aria-live': 'polite' } })
  const field = el('input', {
    class: 'vk-shell__url',
    attrs: {
      type: 'url',
      id: 'vk-quest-url',
      placeholder: 'https://…/Scenario.valkyrie',
      // The community packages live on GitHub; a full URL is what a player
      // copies from a release page.
      spellcheck: 'false',
    },
  })

  const download = async (): Promise<void> => {
    const url = field.value.trim()
    if (url.length === 0) return
    status.textContent = 'Downloading…'
    try {
      const fs = new OpfsFileSystem(navigator.storage as unknown as StorageManagerLike)
      const paths = libraryPaths(
        new StoragePaths({ appData: '/appdata', content: '/content', temp: '/tmp' }, 'MoM'),
      )
      const result = await acquireQuest(url, {
        fs,
        http: new FetchHttpClient(),
        questRoot: paths.quests,
        onProgress: (fraction, received) => {
          status.textContent =
            fraction > 0
              ? `Downloading… ${Math.round(fraction * 100)}%`
              : `Downloading… ${formatBytes(received)}`
        },
      })
      status.textContent = `Added ${result.id}: ${String(result.files)} files, ${formatBytes(result.bytes)}.`
    } catch (error) {
      // The reason matters: a CORS refusal and a bad package look identical
      // from the outside, and only one of them is the player's to fix.
      status.textContent =
        error instanceof Error ? `That did not work: ${error.message}` : 'That did not work.'
    }
  }

  show(
    panel({
      class: 'vk-shell',
      children: [
        backTo(menu),
        label(rawText('Add a scenario'), { size: 'large', heading: 1 }),
        label(
          rawText(
            'Paste the address of a .valkyrie package. It is downloaded into this ' +
              'browser and never leaves the device.',
          ),
        ),
        el('label', { text: 'Package address', attrs: { for: 'vk-quest-url' } }),
        field,
        button(rawText('Download'), {
          onPress: () => void download(),
          variant: 'primary',
          size: 'medium',
        }),
        status,
      ],
    }),
  )
}

/**
 * Importing a licensed install's assets into browser storage.
 *
 * The picker is the only way a browser can read outside its own origin, and it
 * grants access to the chosen folder alone. What is read is decoded straight
 * into OPFS; nothing is uploaded and nothing is written back to the folder.
 */
function importDemo(): void {
  // Both the install and the downloaded content folder: recent builds keep
  // most of the board art and all of the text in the latter, and importing
  // only the install loses a third of the textures while reporting success.
  const folders: PickedDirectorySource[] = []

  const screen = importScreen({
    supported: canPickDirectory(),
    formatBytes,
    onCancel: menu,
    onPickFolder: async () => {
      const picker = (globalThis as { showDirectoryPicker?: () => Promise<PickedDirectory> })
        .showDirectoryPicker
      if (picker === undefined) return null
      try {
        const source = new PickedDirectorySource(await picker(), { accept: isUnityAsset })
        folders.push(source)
        return source.name
      } catch {
        // The player closed the picker.
        return null
      }
    },
    onImport: async (report) => {
      const source = new CompositeAssetSource(folders)
      const names = await source.list()
      if (names.length === 0) {
        // The commonest mistake is choosing the app rather than its data
        // folder, and "0 assets imported" does not explain that.
        throw new Error(
          'Those folders hold no Unity assets. The game’s data folder is inside ' +
            'the .app on macOS, under Contents/Resources/Data; the downloaded ' +
            'content is in ~/Library/Caches/com.fantasyflightgames.mom.',
        )
      }

      const fs = new OpfsFileSystem(navigator.storage as unknown as StorageManagerLike)
      const paths = new StoragePaths(
        { appData: '/appdata', content: '/content', temp: '/tmp' },
        'MoM',
      )
      const result = await importFfgApp({
        fs,
        source,
        importPath: paths.importPath,
        game: 'MoM',
        encodeTexture: canvasTextureEncoder(),
        onProgress: (done, total, what) => report({ done, total, what }),
      })
      return {
        textures: result.textures,
        audio: result.audio,
        text: result.text,
        bytesWritten: result.bytesWritten,
        skipped: result.skipped.length,
      }
    },
    onDone: () => {
      /* the library screen picks it up from storage */
    },
  })

  show(panel({ class: 'vk-shell', children: [backTo(menu), screen.element] }))
}

/**
 * What is actually in storage, and playing it.
 *
 * Nothing is imported in a fresh browser, so the honest thing is to say so and
 * name the two pieces that are missing rather than showing an empty list — the
 * Unity app's failure mode when the import has not run.
 */
async function library(): Promise<void> {
  // OPFS is the browser's own private storage; nothing here reaches the disk
  // the user can see.
  // The DOM lib's FileSystemDirectoryHandle omits `entries()`, which the File
  // System Access spec defines and every implementation ships; the types lag.
  const fs = new OpfsFileSystem(navigator.storage as unknown as StorageManagerLike)
  const paths = libraryPaths(
    new StoragePaths({ appData: '/appdata', content: '/content', temp: '/tmp' }, 'MoM'),
  )

  let state
  try {
    state = await surveyLibrary(fs, paths)
  } catch {
    state = { hasContent: false, packs: [], quests: [] }
  }

  const children = [backTo(menu), label(rawText('Play a quest'), { size: 'large', heading: 1 })]

  if (!state.hasContent) {
    children.push(
      label(
        rawText(
          'No content is imported yet. Valkyrie needs the art and audio from a ' +
            'licensed Mansions of Madness or Descent install, which stay on this ' +
            'device and are never uploaded.',
        ),
      ),
    )
  }

  if (state.quests.length === 0) {
    children.push(
      label(
        rawText(
          state.hasContent
            ? 'Content is ready. No scenarios have been downloaded yet.'
            : 'No scenarios have been downloaded yet either.',
        ),
      ),
    )
  } else {
    children.push(
      mainMenu({
        title: rawText('Scenarios'),
        actions: state.quests.map((quest) => ({
          label: rawText(`${quest.name} (${quest.type})`),
          onPress: () => {
            // Without this a failure to start is silent, which reads as the
            // button doing nothing at all.
            play(fs, paths, quest.path).catch((error: unknown) => {
              show(
                panel({
                  class: 'vk-shell',
                  children: [
                    backTo(menu),
                    label(rawText('That quest could not be started'), {
                      heading: 2,
                      size: 'medium',
                    }),
                    label(rawText(error instanceof Error ? error.message : String(error))),
                  ],
                }),
              )
            })
          },
        })),
      }),
    )
  }

  children.push(
    label(rawText(`${state.packs.length} content packs, ${state.quests.length} scenarios`), {
      class: 'vk-shell__status',
    }),
  )

  show(panel({ class: 'vk-shell', children }))
}

/** Loads a scenario from storage and plays it. */
async function play(
  fs: OpfsFileSystem,
  paths: ReturnType<typeof libraryPaths>,
  questPath: string,
): Promise<void> {
  const { session, resolveTexture, content, components, gameType, pixelsPerSquare } =
    await startQuest(fs, paths, questPath)
  session.runtime.heroes.push(
    { heroName: 'HeroAshcanPete', activated: false },
    { heroName: 'HeroAgnesBaker', activated: false },
  )
  session.start()

  const textures = new TextureCache({
    read: async (path) => {
      try {
        return await fs.readBytes(path)
      } catch {
        return null
      }
    },
  })

  // A tile's board size comes from its image's pixel size, which is only known
  // once decoded — so sizes are recorded as they arrive and the scene is built
  // again, which is what puts the tiles down.
  const sizes = new Map<string, { width: number; height: number }>()

  // A tile cannot be placed until its image size is known, and the image is
  // only fetched for tiles already placed. Learning the sizes first is what
  // breaks that circle — without it no tile is ever drawn.
  const prefetch = tileImages({ content, components, resolveTexture })

  const screen = playScreen({
    session,
    sources: questArt({
      content,
      components,
      resolveTexture,
      sizeOf: (path) => sizes.get(path) ?? null,
      gameType,
      pixelsPerSquare,
    }),
    loadTexture: async (path: string, crop?: Crop) => {
      const file = resolveTexture(path) ?? path
      const image = await textures.load(file, crop)
      if (image !== null && !sizes.has(path)) {
        sizes.set(path, { width: image.width, height: image.height })
        screen.refresh()
      }
      return image
    },
  })

  show(panel({ class: 'vk-shell', children: [backTo(menu), screen.element] }))

  // Sequential: a quest can place twenty 2048x2048 tiles, and decoding them all
  // at once is how a tab runs out of memory.
  void (async () => {
    for (const path of prefetch) {
      const image = await textures.load(path)
      if (image === null) continue
      sizes.set(path, { width: image.width, height: image.height })
      screen.refresh()
    }
  })()
}

/**
 * The quest log, reading a real QuestRuntime rather than a fixture.
 *
 * The editor notices come from VarManager writing through to the log when it
 * creates a variable, so the developer view shows what a scenario author would
 * actually see.
 */
function logDemo(): void {
  const runtime = new QuestRuntime({ components: new Map() })
  runtime.log.add(new LogEntry('You enter the hallway. The air is wrong.'))
  runtime.vars.setValue('#round', 3)
  runtime.log.add(new LogEntry('The door slams shut behind you.'))
  runtime.vars.setValue('$clues', 1)

  const log = questLog({
    onClose: menu,
    onSetVariable: (name, value) => {
      runtime.vars.setValue(name, value)
      render()
    },
  })

  const render = (): void => {
    log.show({
      entries: runtime.log.toArray().map((entry) => ({
        text: entry.entry,
        editor: entry.editor,
      })),
      variables: [...runtime.vars.vars.entries()].map(([name, value]) => ({ name, value })),
    })
  }
  render()

  show(panel({ class: 'vk-shell', children: [backTo(menu), log.element] }))
}

/** The item inventory, inspecting through the real event engine. */
function inventoryDemo(): void {
  const status = el('p', { class: 'vk-shell__status', attrs: { 'aria-live': 'polite' } })
  const view = inventory({
    onInspect: (id) => {
      // A real quest queues itemInspect[id]; here the outcome is reported.
      status.textContent = `Queued the inspect event for ${id}.`
    },
    onClose: menu,
  })
  view.show([
    { id: 'QItemKey', name: 'A rusted key' },
    { id: 'QItemDiary', name: 'A water-stained diary' },
    { id: 'QItemLantern', name: 'A guttering lantern' },
  ])

  show(panel({ class: 'vk-shell', children: [backTo(menu), view.element, status] }))
}

/**
 * The end-of-quest screen.
 *
 * No `onSubmit` is supplied, which is deliberate: the C# posts every answer to
 * a Google Form owned by the upstream maintainer, and this fork sends nothing.
 * Without a handler the feedback form is not even built.
 */
function endGameDemo(): void {
  const screen = endGame({ onMenu: menu })
  screen.show({
    questName: 'The Fall of House Lynch',
    party: ['Ashcan Pete', 'Agnes Baker'],
    events: ['EventIntro', 'EventHallway', 'EventCellar'],
    minutes: 95,
    rounds: 12,
  })
  show(panel({ class: 'vk-shell', children: [backTo(menu), screen.element] }))
}

/** Options, writing through to a real ConfigFile as the C# does. */
function optionsDemo(): void {
  const status = el('p', { class: 'vk-shell__status', attrs: { 'aria-live': 'polite' } })
  const settings = {
    language: 'English',
    fallback: null as string | null,
    music: 0.6,
    effects: 1,
  }

  const screen = options({
    onLanguage: (id) => {
      settings.language = id
      status.textContent = `Language set to ${id}.`
    },
    onFallback: (id) => {
      settings.fallback = id
      status.textContent = `Fallback set to ${id ?? 'none'}.`
    },
    onMusic: (volume) => {
      settings.music = volume
      status.textContent = `Music at ${Math.round(volume * 100)}%.`
    },
    onEffects: (volume) => {
      settings.effects = volume
      status.textContent = `Effects at ${Math.round(volume * 100)}%.`
    },
    onClose: menu,
  })
  screen.show({
    languages: [
      { id: 'English', name: 'English' },
      { id: 'French', name: 'Français' },
      { id: 'German', name: 'Deutsch' },
      { id: 'Spanish', name: 'Español' },
    ],
    ...settings,
  })

  show(panel({ class: 'vk-shell', children: [backTo(menu), screen.element, status] }))
}

/**
 * The board, with generated tiles rather than imported art.
 *
 * Textures come through the T-001 pipeline into OPFS; wiring that up belongs
 * with the play loop. What this exercises is the renderer: pan, zoom, layers
 * and hit testing.
 */
function boardDemo(): void {
  const status = el('p', { class: 'vk-shell__status', attrs: { 'aria-live': 'polite' } })
  const surface = el('div', { class: 'vk-shell__board' })

  const b = board({
    label: 'Quest board',
    onSelect: (item) => {
      status.textContent = `Selected ${item.label ?? item.id}`
    },
  })
  surface.append(b.element)

  const items = []
  for (let x = 0; x < 6; x++) {
    for (let y = 0; y < 4; y++) {
      items.push({
        id: `tile-${x}-${y}`,
        label: `Tile ${x},${y}`,
        layer: Layer.TILE,
        placed: { centre: { x: x * 3, y: y * -3 }, width: 3, height: 3, rotation: 0 },
        image: null,
        tint: (x + y) % 2 === 0 ? '#2f3a2a' : '#3a332a',
      })
    }
  }
  for (let i = 0; i < 5; i++) {
    items.push({
      id: `token-${i}`,
      label: `Clue ${i + 1}`,
      layer: Layer.TOKEN,
      placed: { centre: { x: i * 3, y: -3 }, width: 1, height: 1, rotation: 0 },
      image: null,
      tint: '#c9a227',
    })
  }
  items.push({
    id: 'monster',
    label: 'Shoggoth',
    layer: Layer.MONSTER,
    placed: { centre: { x: 6, y: -6 }, width: 2, height: 2, rotation: 15 },
    image: null,
    tint: '#8a2f24',
  })

  b.setItems(items)
  requestAnimationFrame(() => b.frameAll())

  show(
    panel({
      class: 'vk-shell vk-shell--board',
      children: [
        backTo(menu),
        label(
          rawText(
            'Drag to pan, scroll or pinch to zoom, click a tile. Arrow keys and +/- work too.',
          ),
        ),
        surface,
        status,
      ],
    }),
  )
}

async function storage(): Promise<void> {
  const paths = new StoragePaths({ appData: '/app', content: '/content', temp: '/tmp' }, 'MoM')
  // A real filesystem needs OPFS and an import; this shows the shape.
  const report = await storageReport(new MemoryFileSystem(), paths)
  const result = await requestPersistence(navigator.storage)

  show(
    panel({
      class: 'vk-shell',
      title: rawText('Storage'),
      children: [
        backTo(menu),
        label(rawText(persistenceMessage(result))),
        label(
          rawText(
            report.estimate.quota === null
              ? 'This browser does not report a storage quota.'
              : `Using ${formatBytes(report.estimate.usage ?? 0)} of ${formatBytes(report.estimate.quota)}.`,
          ),
        ),
        label(
          rawText(
            report.entries.length === 0
              ? 'Nothing imported yet.'
              : report.entries.map((e) => `${e.id}: ${formatBytes(e.bytes)}`).join(' · '),
          ),
        ),
      ],
    }),
  )
}

/**
 * Anything that escapes, shown on the page.
 *
 * A browser reports an unhandled error to a console the player is not looking
 * at, so a failure reads as the app doing nothing. This puts the message where
 * it can be seen and copied.
 */
function reportFailure(what: string, detail: string): void {
  const existing = document.querySelector('.vk-failure')
  if (existing !== null) existing.remove()
  const box = el('div', {
    class: 'vk-failure',
    children: [
      label(rawText(what), { heading: 2, size: 'medium' }),
      el('pre', { class: 'vk-failure__detail', text: detail }),
      button(rawText('Dismiss'), {
        onPress: () => {
          document.querySelector('.vk-failure')?.remove()
        },
      }),
    ],
  })
  document.body.append(box)
}

window.addEventListener('error', (event) => {
  reportFailure(
    'Something went wrong',
    `${event.message}\n${event.filename}:${String(event.lineno)}`,
  )
})

window.addEventListener('unhandledrejection', (event) => {
  const reason: unknown = event.reason
  reportFailure(
    'Something went wrong',
    reason instanceof Error ? `${reason.message}\n${reason.stack ?? ''}` : String(reason),
  )
})

menu()

// Registered only in a built app; the dev server has no worker to register.
if ('serviceWorker' in navigator && !import.meta.url.includes('/src/')) {
  navigator.serviceWorker
    .register('./sw.js', { type: 'module' })
    .then((registration) => {
      watchForUpdate(registration, (status) => {
        const bar = el('div', {
          class: 'vk-update',
          children: [
            label(rawText('A new version is ready.')),
            button(rawText('Reload'), { onPress: status.accept, variant: 'primary' }),
          ],
        })
        document.body.append(bar)
      })
    })
    .catch(() => {
      // Offline support is a bonus; failing to register is not an error.
    })
}
