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
  button,
  contentSelect,
  el,
  endGame,
  eventDialog,
  heroSelection,
  importScreen,
  installUnits,
  inventory,
  itemsFrom,
  label,
  Layer,
  mainMenu,
  monsterDialog,
  options,
  panel,
  playScreen,
  questDetails,
  questLog,
  questSelection,
  rawText,
  saveSelect,
  text,
} from '@valkyrie/ui'
import {
  ActivationInstance,
  attackTypes,
  DEFAULT_LANGUAGE,
  HeroData,
  ImageData,
  ItemData,
  LogEntry,
  MoMPhase,
  randomAttack,
  QuestRuntime,
  RoundControllerMoM,
  StringKey,
  symbolNames,
} from '@valkyrie/core'
import type {
  ActivationView,
  IniData,
  AttackView,
  AudioRequest,
  CameraCommand,
  EventsView,
  MonsterInstance,
} from '@valkyrie/core'
import {
  AudioEngine,
  autoSaveConfig,
  canPickDirectory,
  canvasTextureEncoder,
  combine,
  CompositeAssetSource,
  dirname,
  FetchHttpClient,
  importFfgApp,
  isUnityAsset,
  loadConfig,
  loadContent,
  MemoryFileSystem,
  OpfsFileSystem,
  PickedDirectorySource,
  questFileResolver,
  StoragePaths,
  TextureCache,
  listSaves,
  loadSave,
  volumeFromConfig,
  writeSave,
} from '@valkyrie/platform'
import type {
  AudioContextLike,
  Crop,
  FileSystem as VirtualFileSystem,
  PickedDirectory,
  StorageManagerLike,
} from '@valkyrie/platform'
import { acquireQuest } from './acquire.js'
import { devManifest, loadFromDevServer } from './devLoad.js'
import { clearStage, lastStage, stage } from './trace.js'
import {
  browsableQuests,
  byRecency,
  difficultyBand,
  fetchQuestIndex,
  lengthBand,
  packageUrl,
  questDetailLine,
} from './questIndex.js'
import {
  libraryPaths,
  loadedPackIds,
  normaliseQuestPath,
  startQuest,
  surveyLibrary,
} from './library.js'
import type { QuestEntry } from './library.js'
import { monsterProfile, questArt, questUiElements, tileImages } from './questArt.js'
import { monsterDialogView } from './monsterView.js'
import { puzzleRenderer } from './puzzleView.js'
import { SYMBOL_FAMILY, TEXT_FAMILY, loadSymbolFont } from './symbolFont.js'
import { defaultQuestMusic, questAudio } from './questAudio.js'
import { setUpParty } from './partySetup.js'
import { formatBytes, storageReport } from './storage.js'
import { persistenceMessage, requestPersistence } from './persistence.js'
import { watchForUpdate } from './serviceWorker.js'

// Imported rather than linked from index.html: a href to ../ui/src reaches
// outside Vite's root, where it is answered by the SPA fallback — index.html,
// served as a stylesheet, parsing to no rules and reporting no error.
import '@valkyrie/ui/styles.css'

declare const __VALKYRIE_VERSION__: string

/**
 * The pixel size behind an object URL.
 *
 * A screen-space element is laid out from its art's aspect ratio, and the only
 * way to learn it is to let the browser decode the image it is about to show
 * anyway.
 */
async function imageSize(url: string): Promise<{ width: number; height: number } | null> {
  const image = new Image()
  image.src = url
  try {
    await image.decode()
  } catch {
    return null
  }
  return { width: image.naturalWidth, height: image.naturalHeight }
}

/**
 * A quest with no events, so the activation demo exercises the round
 * controller without a scenario behind it.
 */
/**
 * The only game this port plays.
 *
 * Descent shares the engine and most of the content model, and the pieces are
 * all here — but none of it has been played through, and a Descent scenario in
 * a Mansions list is a scenario that cannot be started. So the shell names one
 * game rather than offering both and meaning one.
 */
const GAME_TYPE = 'MoM'

/** The pack that is always loaded, whatever the player has selected. */
const BASE_PACK_ID = 'MoMBase'

/** Where everything lives in OPFS. The same layout for every screen. */
function storagePaths(): StoragePaths {
  return new StoragePaths({ appData: '/appdata', content: '/content', temp: '/tmp' }, GAME_TYPE)
}

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

/*
 * The menu artwork, which every screen outside a running game is drawn on.
 *
 * Served from `public/` rather than bundled: the file is not in the
 * repository, and a static import of a missing one fails the build. Absent,
 * the browser drops the layer and the gradients below it are what shows — so
 * the screens still look deliberate rather than broken.
 *
 * Resolved against `document.baseURI` because the build is relative-based
 * (`base: './'`), so a bare path would break under a subdirectory. Set once at
 * startup: it is inherited, and setting it per screen made it the title
 * screen's alone.
 */
root.style.setProperty(
  '--vk-menu-cover',
  `url("${new URL('menu-cover.webp', document.baseURI).href}")`,
)

installUnits(document.documentElement, window)

/** Swaps the visible screen. One at a time, as the Unity app does. */
/**
 * Whatever the screen being replaced needs to let go of.
 *
 * The board keeps a ResizeObserver and an animation frame alive. Replacing the
 * page contents detaches its canvas but leaves both running, so every visit
 * left another live board observing a canvas nobody could see — which is both
 * the "ResizeObserver loop" notice that follows you back to the menu and a
 * steady climb towards the tab running out of memory.
 */
let disposeScreen: (() => void) | null = null

function show(...nodes: (Node | null)[]): void {
  disposeScreen?.()
  disposeScreen = null
  root.replaceChildren(...nodes.filter((n): n is Node => n !== null))
}

/** Registers the teardown for the screen just shown. */
function onLeave(dispose: () => void): void {
  disposeScreen = dispose
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
  const died = lastStage()
  if (died !== null) {
    // The tab did not finish what it was doing last time; say what it was.
    clearStage()
    reportFailure(
      'The last attempt did not finish',
      `Stopped at: ${died.what}${died.detail === undefined ? '' : `\n${died.detail}`}`,
    )
  }
  const logo = el('img', {
    class: 'vk-shell__logo',
    // Decorative: the heading beside it already names the app.
    attrs: { src: new URL('menu-logo.webp', document.baseURI).href, alt: '' },
  })
  // Absent artwork is the supported case, so it takes itself off the page
  // rather than leaving a broken-image icon in the corner.
  logo.addEventListener('error', () => {
    logo.remove()
  })
  show(
    panel({
      class: ['vk-shell', 'vk-shell--art'],
      children: [
        logo,
        label(rawText('Valkyrie'), { size: 'large', heading: 1 }),
        label(rawText(`Web port · ${__VALKYRIE_VERSION__}`), { class: 'vk-shell__version' }),
        mainMenu({
          title: rawText('Main menu'),
          actions: [
            { label: rawText('Play a quest'), onPress: () => void library() },
            { label: rawText('Load a game'), onPress: () => void resumeQuest() },
            { label: rawText('Import game files'), onPress: importDemo },
            { label: rawText('Load from dev server'), onPress: () => void devLoad() },
            { label: rawText('Content'), onPress: () => void contentSelectScreen() },
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
      class: ['vk-shell', 'vk-shell--art'],
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
      class: ['vk-shell', 'vk-shell--art'],
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
    minimum: 2,
    maximum: 4,
    title: rawText('Choose investigators'),
    confirmLabel: rawText('Begin'),
    countLabel: (chosen, low, high) => `${chosen} chosen, ${low} to ${high} needed`,
    onConfirm: () => boardDemo(),
  })
  show(panel({ class: ['vk-shell', 'vk-shell--art'], children: [backTo(menu), selection.element] }))
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
  show(panel({ class: ['vk-shell', 'vk-shell--art'], children: [backTo(menu), dialog.element] }))
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
      class: ['vk-shell', 'vk-shell--art'],
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
      onAttack: (chosen: string) => {
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
      class: ['vk-shell', 'vk-shell--art'],
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
      class: ['vk-shell', 'vk-shell--art'],
      children: [backTo(menu), label(rawText('Fetching the scenario list…')), status],
    }),
  )

  const fs = new OpfsFileSystem(navigator.storage as unknown as StorageManagerLike)
  const paths = libraryPaths(storagePaths())

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

  const state = await surveyLibrary(fs, paths).catch(() => null)
  const installed = new Set(state?.quests.map((q) => q.id) ?? [])

  // The same test the local list uses: a scenario asking for a box the player
  // has not selected cannot be played, so there is no point offering it.
  const config = await loadConfig(fs, storagePaths()).catch(() => null)
  const owned = await loadedPackIds(
    fs,
    state?.packs ?? [],
    config?.getPacks(GAME_TYPE) ?? [],
    BASE_PACK_ID,
  ).catch(() => new Set<string>())

  const playable = entries.filter((entry) => entry.quest.missingPacks(owned).length === 0)
  const hidden = entries.length - playable.length

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
      class: ['vk-shell', 'vk-shell--art'],
      children: [
        backTo(menu),
        questSelection({
          quests: browsableQuests(playable, installed),
          onPick: (id) => void download(id),
          title: rawText(`Scenarios (${String(playable.length)})`),
          searchLabel: rawText('Search scenarios'),
          emptyMessage: rawText('No scenario matches those filters.'),
          gallery: true,
          countLabel: (count) => `${String(count)} scenarios`,
        }),
        hidden === 0
          ? null
          : label(
              rawText(
                `${String(hidden)} more need content you have not selected. ` +
                  'Choose your boxes under Content to see them.',
              ),
              { class: 'vk-shell__status' },
            ),
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
      class: ['vk-shell', 'vk-shell--art'],
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
  const paths = libraryPaths(storagePaths())

  try {
    const result = await loadFromDevServer(
      fs,
      manifest,
      {
        contentRoot: paths.content,
        uiTextRoot: paths.uiText,
        importPath: paths.imported,
        questRoot: paths.quests,
      },
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
      const paths = libraryPaths(storagePaths())
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
      class: ['vk-shell', 'vk-shell--art'],
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
      const paths = storagePaths()
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
        fonts: result.fonts,
        bytesWritten: result.bytesWritten,
        skipped: result.skipped.length,
      }
    },
    onDone: () => {
      /* the library screen picks it up from storage */
    },
  })

  show(panel({ class: ['vk-shell', 'vk-shell--art'], children: [backTo(menu), screen.element] }))
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
  const paths = libraryPaths(storagePaths())

  let state
  try {
    state = await surveyLibrary(fs, paths)
  } catch {
    state = { hasContent: false, packs: [], quests: [] }
  }

  // What is on the table, so a scenario asking for a box the player has not
  // got can be told apart from one they can start right now.
  const config = await loadConfig(fs, storagePaths()).catch(() => null)
  const owned = await loadedPackIds(
    fs,
    state.packs,
    config?.getPacks(GAME_TYPE) ?? [],
    BASE_PACK_ID,
  ).catch(() => new Set<string>())

  // Only this game's scenarios. The library holds whatever has been
  // downloaded, and a Descent quest in a Mansions list is not a scenario the
  // player can start — it is a different game.
  const mine = state.quests.filter((quest) => quest.type === GAME_TYPE)

  const entries = mine.map((quest) => ({
    quest,
    missing: quest.packs.filter((pack) => !owned.has(pack)),
  }))
  const playable = entries.filter((entry) => entry.missing.length === 0)

  // Object URLs, revoked when the screen goes.
  const covers = new Map<string, string>()
  for (const { quest } of entries) {
    if (quest.image.length === 0) continue
    try {
      covers.set(
        quest.id,
        URL.createObjectURL(new Blob([new Uint8Array(await fs.readBytes(quest.image))])),
      )
    } catch {
      // A cover that will not read is a card without one, not a broken screen.
    }
  }

  const children: (Node | null)[] = [
    backTo(menu),
    label(rawText('Play a quest'), { size: 'large', heading: 1 }),
  ]

  if (!state.hasContent) {
    children.push(
      label(
        rawText(
          'No content is imported yet. Valkyrie needs the art and audio from a ' +
            'licensed Mansions of Madness install, which stay on this device and ' +
            'are never uploaded.',
        ),
      ),
    )
  }

  if (mine.length === 0) {
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
    const start = (path: string): void => {
      // Without this a failure to start is silent, which reads as the card
      // doing nothing at all.
      play(fs, paths, path).catch((error: unknown) => {
        show(
          panel({
            class: ['vk-shell', 'vk-shell--art'],
            children: [
              backTo(menu),
              label(rawText('That quest could not be started'), { heading: 2, size: 'medium' }),
              label(rawText(error instanceof Error ? error.message : String(error))),
            ],
          }),
        )
      })
    }

    children.push(
      questSelection({
        quests: playable.map(({ quest }) => ({
          key: quest.id,
          display: quest.name,
          traits: questTraits(quest),
          description: quest.description,
          ...(covers.has(quest.id) ? { image: covers.get(quest.id) as string } : {}),
          detail: questDetail(quest),
        })),
        onPick: (id) => {
          const found = playable.find(({ quest }) => quest.id === id)
          if (found !== undefined) start(found.quest.path)
        },
        title: rawText('Scenarios'),
        searchLabel: rawText('Search scenarios'),
        emptyMessage: rawText('No scenario matches those filters.'),
        gallery: true,
        countLabel: (count) => `${String(count)} scenarios`,
      }),
    )
  }

  const hidden = entries.length - playable.length
  children.push(
    label(
      rawText(
        `${String(playable.length)} scenarios` +
          (hidden === 0 ? '' : `, ${String(hidden)} hidden for content you have not selected`),
      ),
      { class: 'vk-shell__status' },
    ),
  )

  show(panel({ class: ['vk-shell', 'vk-shell--art'], children }))
  onLeave(() => {
    for (const url of covers.values()) URL.revokeObjectURL(url)
  })
}

/**
 * The facts a player picks a scenario by, on one line.
 *
 * Length and seats are shared with the online browser, so a scenario reads the
 * same before and after it is downloaded; difficulty stands in for the rating,
 * which only the store knows.
 */
function questDetail(quest: QuestEntry): string {
  const parts = questDetailLine(quest)
  if (quest.difficulty > 0) parts.push(difficultyBand(quest.difficulty))
  return parts.join(' · ')
}

/** The trait groups the gallery filters by, matching the online browser's. */
function questTraits(quest: QuestEntry): Map<string, string[]> {
  return new Map<string, string[]>([
    ['Length', [lengthBand(quest.lengthMin, quest.lengthMax)]],
    ['Investigators', [`${String(quest.minHero)}–${String(quest.maxHero)}`]],
    ['Difficulty', [difficultyBand(quest.difficulty)]],
  ])
}

/** Loads a scenario from storage and plays it. */
async function play(
  fs: OpfsFileSystem,
  paths: ReturnType<typeof libraryPaths>,
  questPath: string,
  /**
   * Where the scenario the player picked came from. A handover names its
   * target relative to that, however deep the chain has gone, so it is
   * carried rather than recomputed from the quest now loading.
   */
  questRoot: string = questPath,
  /** A saved state to resume, instead of setting a new party up. */
  resume?: IniData,
): Promise<void> {
  stage('play: loading quest', questPath)
  // Queued rather than applied: the events that aim the camera run while the
  // quest is starting, before there is a screen to aim. `screen.refresh()`
  // drains them once there is.
  const pendingCamera: CameraCommand[] = []
  let aim = (command: CameraCommand): void => {
    pendingCamera.push(command)
  }
  // What the player told the content screen they own. `Game.SelectQuest`
  // reads the same section before pulling up the quest list.
  const storage = storagePaths()
  const config = await loadConfig(fs, storage)

  // Built before the quest starts, because a scenario asks for its opening
  // music from its very first event.
  const audio = new AudioEngine(new AudioContext() as unknown as AudioContextLike, fs, {
    onError: (file: string, error: unknown) => {
      // A sound that will not decode is not worth stopping a quest for; 98 of
      // this install's audio files do not survive the import.
      console.warn(`audio: ${file}`, error)
    },
  })
  audio.musicVolume = volumeFromConfig(config.get('UserConfig', 'music'))
  audio.effectVolume = volumeFromConfig(config.get('UserConfig', 'effects'))
  let sound: ((request: AudioRequest) => void) | null = null

  // Declared before `startQuest`, because the round controller asks for the
  // first autosave while the quest is still starting.
  let autosave = (): void => {}

  const {
    session,
    resolveTexture,
    content,
    components,
    gameType,
    pixelsPerSquare,
    quest,
    loadedPacks,
  } = await startQuest(fs, paths, questPath, {
    questRoot,
    // Resolution needs the content this call is loading, so the handler is
    // filled in below and this only forwards to it.
    playAudio: (request) => {
      sound?.(request)
    },
    selectedPacks: config.getPacks('MoM'),
    basePackId: BASE_PACK_ID,
    camera: (command) => {
      aim(command)
    },
    // `SaveManager.Save(0)`, which the round controller calls at the start
    // of every round and once when the quest begins.
    save: () => {
      autosave()
    },
  })
  stage('play: quest loaded')

  // `Quest.start_time`, which the C# keeps on the quest so a save can carry the
  // running total. Kept here instead, because the session is deterministic and
  // reading a clock inside it would make a replay depend on when it ran. It
  // moves onto the quest when saves land (T-026).
  const startedAt = Date.now()

  /**
   * `SaveManager.Save(0)`: the autosave.
   *
   * Fire and forget, and never awaited by the thing that asked for it — the
   * round is not held up for a write, and a failed one costs the player the
   * last round rather than the game they are playing.
   */
  const saveContext = { fs, paths: storage, currentVersion: SAVE_VERSION }
  /** What every save of this quest records, autosave or chosen slot alike. */
  const saveOptions = () => ({
    questPath: combine(questPath, 'quest.ini'),
    originalPath: questRoot,
    questName: quest.name.translate(),
    valkyrieVersion: SAVE_VERSION,
    packs: loadedPacks,
    duration: Math.floor((Date.now() - startedAt) / 60000),
    time: new Date().toISOString(),
  })
  let saving = false
  autosave = () => {
    if (saving || left) return
    saving = true
    void (async () => {
      try {
        await writeSave(saveContext, AUTOSAVE_SLOT, {
          state: session.toSaveString(saveOptions()),
          questFiles: await questFilesFor(fs, questPath),
        })
      } catch (error) {
        // A save that will not write is not worth stopping a quest for.
        console.warn('autosave', error)
      } finally {
        saving = false
      }
    })()
  }

  // A scenario's own art is named relative to its directory, and is resolved
  // while the scene is being built — so the listing is taken once here rather
  // than probed per frame. `Game.cs:210` reads the languages from the same
  // config this screen already loaded.
  const resolveQuestFile = await questFileResolver(fs, questPath, {
    currentLang: config.get('UserConfig', 'currentLang') || DEFAULT_LANGUAGE,
    fallbackLang: config.get('UserConfig', 'fallbackLang'),
    editMode: false,
  })

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
  stage('play: tile images resolved', `${String(prefetch.length)} tiles`)

  // The scenario's own screen-space art goes to <img>, not to the canvas, so
  // it needs a URL rather than a bitmap. Uncropped, that is the file's own
  // bytes and the browser decodes them itself; a crop has to go through a
  // canvas because there is nothing else to cut a sprite sheet with.
  const urls = new Map<string, string | null>()
  const uiSizes = new Map<string, { width: number; height: number }>()
  /** Set once this screen has been replaced, so its background work stops. */
  let left = false

  function imageUrl(path: string, crop?: Crop): string | null {
    const key =
      crop === undefined
        ? path
        : `${path}#${String(crop.x)},${String(crop.y)},${String(crop.width)},${String(crop.height)}`
    const known = urls.get(key)
    if (known !== undefined) return known
    urls.set(key, null)
    void (async () => {
      const url = await buildUrl(path, crop)
      if (url === null) return
      urls.set(key, url)
      const size = await imageSize(url)
      if (size !== null) uiSizes.set(path, size)
      screen.refresh()
    })()
    return null
  }

  async function buildUrl(path: string, crop?: Crop): Promise<string | null> {
    if (crop === undefined) {
      try {
        return URL.createObjectURL(new Blob([new Uint8Array(await fs.readBytes(path))]))
      } catch {
        return null
      }
    }
    const bitmap = await textures.load(path, crop)
    if (bitmap === null) return null
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/png')
    })
    return blob === null ? null : URL.createObjectURL(blob)
  }

  if (resume === undefined) {
    // Setup before the quest runs, in the game's order: pick the investigators,
    // read what they start with, and only then let `EventStart` fire — which is
    // where the scenario's own opening plays.
    await setUpParty({
      session,
      content,
      components,
      resolveTexture,
      quest,
      artUrl: buildUrl,
      present: (element) => {
        show(panel({ class: ['vk-shell', 'vk-shell--art'], children: [backTo(menu), element] }))
      },
    })
    session.start()
  } else {
    // Resuming: the party was chosen a session ago and `EventStart` has
    // already run. Starting again would deal the items out twice and replay
    // the opening over a board that is already built.
    session.restoreFrom(resume)
  }

  // `outputSymbolReplace` has already turned the markers into glyphs by the
  // time anything is drawn, so the renderer needs the table read backwards to
  // know what it is looking at.
  const glyphs = symbolNames(gameType)
  // Whether those codepoints can actually be drawn. The face comes out of the
  // player's own import, so this is false until they have imported the game —
  // and then the symbols are set as their names instead, which reads correctly
  // and simply is not what the game looks like.
  const symbolFont = await loadSymbolFont({ fs, paths: storage })
  // Named only once there is a face behind it, so the stylesheet never points
  // at a family that does not exist. `symbolFont.ts` owns the names.
  if (symbolFont) {
    root.style.setProperty('--vk-symbol-font', `'${SYMBOL_FAMILY}'`)
    // The face the game sets its dialogs in. Scoped to the play screen rather
    // than the whole app: the menus are the port's own design and were built
    // against their own stack, while a quest's prose is the game's.
    root.style.setProperty('--vk-font-game', `'${TEXT_FAMILY}'`)
  }
  /** Content the scenario asked for and this player does not have. */
  const missing = new Set<string>()
  // Hoisted rather than built inline: the board draws from it, and so does the
  // dialog when it shows which token was clicked.
  const sources = questArt({
    content,
    components,
    resolveTexture,
    onWarning: (message) => {
      // Once each: the board is rebuilt on every refresh and would otherwise
      // repeat the same line for every redraw.
      if (missing.has(message)) return
      missing.add(message)
      session.runtime.log.add(new LogEntry(message, true))
    },
    sizeOf: (path) => sizes.get(path) ?? null,
    questPath,
    gameType,
    pixelsPerSquare,
  })

  const screen = playScreen({
    session,
    rich: { symbolOf: (character) => glyphs.get(character) ?? null, glyphs: symbolFont },
    notices: () => [...missing],
    // `EventManager.cs:309`: a puzzle event opens its window instead of a
    // dialog, and the event's buttons only appear once it is solved.
    onPuzzle: puzzleRenderer({ components }),
    // The phase bar and its menus, all `val` keys the game already ships.
    strings: {
      phaseInvestigator: text(new StringKey('val', 'PHASE_INVESTIGATOR')),
      phaseMythos: text(new StringKey('val', 'PHASE_MYTHOS')),
      phaseMonsters: text(new StringKey('val', 'MONSTER_STEP')),
      phaseHorror: text(new StringKey('val', 'HORROR_STEP')),
      items: text(new StringKey('val', 'ITEMS_SMALL')),
      set: text(new StringKey('val', 'SET')),
      log: text(new StringKey('val', 'LOG')),
      setFire: text(new StringKey('val', 'SET_FIRE')),
      clearFire: text(new StringKey('val', 'CLEAR_FIRE')),
      eliminated: text(new StringKey('val', 'INVESTIGATOR_ELIMINATED')),
      close: text(new StringKey('val', 'CLOSE')),
      // `CommonStringKeys.CANCEL`, the word on a cancelable event's way out.
      cancel: text(new StringKey('val', 'CANCEL')),
      undo: text(new StringKey('val', 'UNDO')),
      save: text(new StringKey('val', 'SAVE')),
    },
    sources,
    // `ChangePhaseWindow`: the artwork a phase is announced over, and the
    // party lined up beneath the investigators' own.
    phaseArt: (phase) => {
      const data = content.tryGet(
        ImageData,
        phase === 'investigator' ? 'ImageGreenBG' : 'ImageMythosBackground',
      )
      const file = data === undefined ? null : resolveTexture(data.image)
      return file === null ? null : imageUrl(file)
    },
    party: () =>
      session.runtime.heroes
        .map((hero) => hero.heroName)
        .filter((name): name is string => name !== null)
        .map((name) => {
          const data = content.tryGet(HeroData, name)
          const file = data === undefined ? null : resolveTexture(data.image)
          return {
            name: data?.name.translate() ?? name,
            image: file === null ? null : imageUrl(file),
          }
        }),
    // `DrawItem`: the card an event hands over, drawn beside its dialog.
    itemImage: (id) => {
      const data = content.tryGet(ItemData, id)
      const file = data === undefined ? null : resolveTexture(data.image)
      return file === null ? null : imageUrl(file)
    },
    // The token the player clicked, drawn beside its dialog so it says which
    // one it came from. The same art the board draws, through the same crop:
    // a token can be one cell of a sheet, and only this side can read the file
    // to cut it out.
    eventIcon: (name) => {
      const art = sources.token(name)
      if (art === null) return null
      return imageUrl(art.image, art.crop)
    },
    monsterList: () =>
      session.runtime.monsters.map((instance, index) => {
        const profile = monsterProfile(content, components, instance.monsterName, questPath)
        const art = profile === null ? null : resolveTexture(profile.resolved.image)
        return {
          index,
          name: profile?.resolved.name.translate() ?? instance.monsterName,
          image: art === null ? null : imageUrl(art),
          activated: instance.activated,
        }
      }),
    onEnded: () => {
      showEndOfQuest()
    },
    onChangeQuest: (path) => {
      // The board and everything on it belongs to the scenario being left;
      // the campaign variables it keeps are `changeQuest`'s business.
      session.changeQuest()
      // The path names a `quest.ini`; what is loaded is the directory holding
      // it, and the root stays put so a chain of handovers keeps resolving.
      const next = combine(questRoot, dirname(normaliseQuestPath(path)))
      void play(fs, paths, next, questRoot)
    },
    monsterView: (index, close) =>
      monsterDialogView(
        {
          session,
          content,
          components,
          questPath,
          gameType,
          resolveTexture,
          imageUrl,
          close,
          refresh: () => {
            screen.refresh()
          },
        },
        index,
      ),
    // The three buttons `NextStageButton` puts in the bottom-left corner.
    menus: {
      items: {
        // `InventoryWindowMoM` lists `itemInspect`, which is every item the
        // quest has granted that has something to read on the back of it.
        list: () =>
          [...session.runtime.itemInspect.keys()].map((id) => {
            const data = content.tryGet(ItemData, id)
            const file = data === undefined ? null : resolveTexture(data.image)
            const url = file === null ? null : imageUrl(file)
            return {
              id,
              name: data?.name.translate() ?? id,
              ...(url === null ? {} : { image: url }),
            }
          }),
        onInspect: (id) => {
          // `Inspect` queues `itemInspect[item]`, which is the event that says
          // what examining it turns up.
          const event = session.runtime.itemInspect.get(id)
          if (event !== undefined) session.activate(event)
        },
      },
      log: {
        view: () => ({
          entries: session.runtime.log.toArray().map((entry) => ({
            text: entry.entry,
            editor: entry.editor,
          })),
          variables: [...session.runtime.vars.vars.entries()].map(([name, value]) => ({
            name,
            value,
          })),
        }),
        onSetVariable: (name, value) => {
          session.runtime.vars.setValue(name, value)
        },
      },
      game: {
        onUndo: () => {
          session.undo()
        },
        canUndo: () => session.canUndo,
        onSave: () => {
          void saveToSlot()
        },
        // `GameMenu.Quit` writes the autosave on the way out, so leaving is
        // not the same as losing the game.
        onMainMenu: () => {
          autosave()
          menu()
        },
      },
      set: {
        view: () => ({
          fire: session.runtime.vars.getValue('$fire') > 0,
          eliminated: session.runtime.vars.getValue('#eliminated') > 0,
          eliminationFinal: session.runtime.vars.getValue('#eliminatedcomplete') > 0.1,
        }),
        onFire: (lit) => {
          session.runtime.vars.setValue('$fire', lit ? 1 : 0)
        },
        onEliminated: (eliminated) => {
          session.runtime.vars.setValue('#eliminated', eliminated ? 1 : 0)
          // `Uneliminate` clears the round handshake too, or the next
          // `EndRound` would promote a stale value and eliminate them again.
          if (!eliminated) session.runtime.vars.setValue('#eliminatedprev', 0)
        },
      },
    },
    questUi: () =>
      questUiElements({
        content,
        components,
        onBoard: session.runtime.boardItems().map((item) => item.name),
        resolveTexture,
        imageUrl,
        sizeOf: (path) => uiSizes.get(path) ?? sizes.get(path) ?? null,
        resolveQuestFile,
        // `Quest.cs:2227` translates a UI element's text with
        // `emptyIfNotFound`. An image-only element never declares a `uitext`,
        // and without the flag its key is drawn in place of the picture.
        text: (key) => key.translate({ emptyIfNotFound: true }),
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

  // The phase announcements are asked for the instant a round turns over, and
  // `imageUrl` answers null until it has the bytes. Warmed here so the first
  // transition has its artwork rather than a bare colour — nothing re-shows it
  // once it is up.
  for (const image of ['ImageGreenBG', 'ImageMythosBackground']) {
    const data = content.tryGet(ImageData, image)
    const file = data === undefined ? null : resolveTexture(data.image)
    if (file !== null) imageUrl(file)
  }
  // And the party's portraits, which the investigators' own announcement lines
  // up. Party setup decoded them through a different path, so this cache has
  // not seen them.
  for (const hero of session.runtime.heroes) {
    if (hero.heroName === null) continue
    const data = content.tryGet(HeroData, hero.heroName)
    const file = data === undefined ? null : resolveTexture(data.image)
    if (file !== null) imageUrl(file)
  }

  sound = questAudio({ engine: audio, content, resolveFile: resolveTexture })

  // A browser will not start an audio context without a gesture, and the
  // quest has already asked for its music by now. `unlock` releases what was
  // held, so the first click anywhere starts it.
  const unlockAudio = (): void => {
    void audio.unlock()
  }
  addEventListener('pointerdown', unlockAudio, { once: true })
  addEventListener('keydown', unlockAudio, { once: true })

  void audio.playDefaultQuestMusic(defaultQuestMusic(content, resolveTexture))

  // Everything the quest asked for while it was starting, now that there is
  // something to ask. From here the session aims the camera directly.
  for (const command of pendingCamera) screen.camera(command)
  pendingCamera.length = 0
  aim = (command) => {
    screen.camera(command)
  }

  /**
   * The quest is over, so the board comes down and the summary goes up.
   *
   * `EventManager.cs:466` sends a scenario that is not a downloaded package
   * straight to the main menu instead, so an author testing one is not asked
   * to rate it — that rating went to a stats endpoint. DEVIATION: this port
   * sends nothing anywhere, so there is nothing to spare a test scenario from
   * and every quest gets its summary.
   */
  function showEndOfQuest(): void {
    // No teardown here: `show` runs the play screen's own `onLeave` first,
    // which is what disposes the audio and the board. Doing it twice closes
    // an already closed `AudioContext`, which throws.
    const heroes = session.runtime.heroes
      .map((hero) => hero.heroName)
      .filter((name): name is string => name !== null)
      .map((name) => content.tryGet(HeroData, name)?.name.translate() ?? name)

    const summary = endGame({ onMenu: menu })
    summary.show({
      questName: quest.name.translate(),
      party: heroes,
      events: session.events.history,
      // Whole minutes, as the C# reports them.
      minutes: Math.floor((Date.now() - startedAt) / 60000),
      rounds: Math.round(session.runtime.vars.getValue('#round')),
    })
    show(panel({ class: ['vk-shell', 'vk-shell--art'], children: [backTo(menu), summary.element] }))
  }
  /** `GameMenu.Save`: the save slots, in the direction that writes. */
  const backToBoard = (): void => {
    // No art layer here, and this is the one screen without it: the board is
    // what the players are reading, and a picture behind it competes.
    show(panel({ class: 'vk-shell', children: [backTo(menu), screen.element] }))
  }

  async function saveToSlot(): Promise<void> {
    const slots = saveSelect({
      mode: 'save',
      onBack: backToBoard,
      onSelect: (slot) => {
        void (async () => {
          try {
            await writeSave(saveContext, slot, {
              state: session.toSaveString(saveOptions()),
              questFiles: await questFilesFor(fs, questPath),
            })
          } catch (error) {
            console.warn('save', error)
          }
          backToBoard()
        })()
      },
    })
    const metadata = await listSaves(saveContext)
    slots.show(
      metadata.map((entry) => ({
        slot: entry.slot,
        save:
          entry.questName.length === 0 && entry.saveTime === null
            ? null
            : { questName: entry.questName, time: readableTime(entry.saveTime) },
        rejection: rejectionText(entry.rejection),
      })),
    )
    show(panel({ class: ['vk-shell', 'vk-shell--art'], children: [backTo(menu), slots.element] }))
  }

  backToBoard()
  onLeave(() => {
    // Leaving on purpose is not the tab dying mid-load, so the breadcrumb goes
    // with it — otherwise the menu reports a failure that never happened.
    clearStage()
    left = true
    removeEventListener('pointerdown', unlockAudio)
    removeEventListener('keydown', unlockAudio)
    void audio.dispose()
    screen.destroy()
    textures.clear()
    for (const url of urls.values()) if (url !== null) URL.revokeObjectURL(url)
    urls.clear()
  })

  // Sequential: a quest can place twenty 2048x2048 tiles, and decoding them all
  // at once is how a tab runs out of memory.
  void (async () => {
    for (const path of prefetch) {
      // A scenario can hand over mid-decode, and the tiles being fetched
      // belong to the board that has just been taken down.
      if (left) return
      stage('play: decoding tile', path)
      const image = await textures.load(path)
      if (image === null) continue
      sizes.set(path, { width: image.width, height: image.height })
      screen.refresh()
    }
    stage('play: all tiles decoded')
    clearStage()
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

  show(panel({ class: ['vk-shell', 'vk-shell--art'], children: [backTo(menu), log.element] }))
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

  show(
    panel({ class: ['vk-shell', 'vk-shell--art'], children: [backTo(menu), view.element, status] }),
  )
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
  show(panel({ class: ['vk-shell', 'vk-shell--art'], children: [backTo(menu), screen.element] }))
}

/**
 * Picks the autosave up where it was left.
 *
 * The quest is loaded from where the save says it came from, and only then is
 * the state put back — a save records state, not content, so the scenario has
 * to exist before there is anything to restore onto.
 */
async function resumeQuest(): Promise<void> {
  const fs = new OpfsFileSystem(navigator.storage as unknown as StorageManagerLike)
  const storage = storagePaths()
  const context = { fs, paths: storage, currentVersion: SAVE_VERSION }

  const status = el('p', { class: 'vk-shell__status', attrs: { 'aria-live': 'polite' } })
  const screen = saveSelect({
    mode: 'load',
    onBack: menu,
    onSelect: (slot) => {
      void (async () => {
        try {
          const save = await loadSave(context, slot)
          await play(fs, libraryPaths(storage), save.questPath, save.questPath, save.data)
        } catch (error) {
          status.textContent = `That save could not be opened: ${String(error)}`
        }
      })()
    },
  })
  show(
    panel({
      class: ['vk-shell', 'vk-shell--art'],
      children: [backTo(menu), screen.element, status],
    }),
  )

  const metadata = await listSaves(context)
  const urls: string[] = []
  screen.show(
    metadata.map((entry) => {
      const image =
        entry.image === null
          ? undefined
          : URL.createObjectURL(new Blob([new Uint8Array(entry.image)], { type: 'image/png' }))
      if (image !== undefined) urls.push(image)
      return {
        slot: entry.slot,
        save:
          entry.questName.length === 0 && entry.saveTime === null
            ? null
            : {
                questName: entry.questName,
                time: readableTime(entry.saveTime),
                ...(image === undefined ? {} : { image }),
              },
        rejection: rejectionText(entry.rejection),
      }
    }),
  )
  onLeave(() => {
    for (const url of urls) URL.revokeObjectURL(url)
  })
}

/**
 * A save's timestamp in the reader's own locale.
 *
 * The C# writes `DateTime.Now.ToString()`, which is already the local format;
 * this port writes ISO so the value parses anywhere, and turns it back here.
 */
function readableTime(value: string | null): string | null {
  if (value === null) return null
  const when = new Date(value)
  return Number.isNaN(when.getTime()) ? value : when.toLocaleString()
}

/** Why a save will not open, in words rather than a code. */
function rejectionText(rejection: string | null): string | null {
  if (rejection === null) return null
  if (rejection === 'future-version') return 'Saved by a newer version'
  if (rejection === 'unsupported-version') return 'Saved by a version too old to read'
  if (rejection === 'unreadable') return 'This save is damaged'
  return null
}

/**
 * The version a save records, and the one saves are checked against.
 *
 * `__VALKYRIE_VERSION__` is a display string — "dev" in a dev build — and the
 * `valkyrie=` key is a compatibility gate that `checkSaveVersion` parses as a
 * version. It tracks the Unity project's `bundleVersion` so a save says which
 * Valkyrie it belongs to, even though the two do not interoperate.
 */
const SAVE_VERSION = '3.0.4'

/** Slot 0 is the autosave, which every other slot is a deliberate copy of. */
const AUTOSAVE_SLOT = 0

/**
 * The scenario's own files, carried into the save.
 *
 * `SaveManager.SaveWithScreen` copies the quest content in so a save opens
 * even after the quest is edited or deleted. Paths are stored relative to the
 * quest, which is where a load extracts them back to.
 */
async function questFilesFor(
  fs: VirtualFileSystem,
  questPath: string,
): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>()
  for (const entry of await fs.list(questPath, { recursive: true })) {
    if (entry.kind === 'directory') continue
    const relative = entry.path.slice(questPath.length).replace(/^\//, '')
    // The archive it came in is not worth carrying into the one it goes into.
    if (relative.startsWith('.')) continue
    // Under `quest/`, which is where `resolveQuestPath` points a load: the
    // C# lays its archives out the same way.
    files.set(`quest/${relative}`, await fs.readBytes(entry.path))
  }
  return files
}

/** `GameType.BaseContentPackId()`, which is loaded whatever is selected. */

/**
 * Which boxes the player owns, written straight through to `config.ini`.
 *
 * The selection is what a scenario reads: `#<packId>` decides whether it may
 * ask for a first-edition tile, so this is the difference between a quest
 * knowing what is on the table and assuming everything is.
 */
async function contentSelectScreen(): Promise<void> {
  const fs = new OpfsFileSystem(navigator.storage as unknown as StorageManagerLike)
  const storage = storagePaths()
  const paths = libraryPaths(storage)
  const config = await loadConfig(fs, storage, autoSaveConfig(fs, storage))

  // The art is a file in storage; an <img> needs a URL, so each is read once
  // and kept for as long as the screen is up.
  const urls = new Map<string, string>()
  async function artFor(file: string): Promise<string | null> {
    if (file.length === 0) return null
    const known = urls.get(file)
    if (known !== undefined) return known
    try {
      const url = URL.createObjectURL(new Blob([new Uint8Array(await fs.readBytes(file))]))
      urls.set(file, url)
      return url
    } catch {
      return null
    }
  }

  const screen = contentSelect({
    onToggle: (id) => {
      if (config.getPacks('MoM').includes(id)) config.removePack('MoM', id)
      else config.addPack('MoM', id)
      void render()
    },
    onClose: menu,
  })

  // Read once, so toggling does not re-walk the content root each time.
  const found = await loadContent(fs, {
    root: paths.content,
    importPath: paths.imported,
    // The names are keys, so the dictionaries have to be in place to read
    // them: `pck` comes from the base pack and `ffg` from the import.
    uiText: paths.uiText,
    gameType: 'MoM',
  })

  async function render(): Promise<void> {
    screen.show({
      packs: await Promise.all(
        found.available.map(async (pack) => {
          const art = await artFor(pack.image)
          return {
            id: pack.id,
            // `GetContentName`: the ini holds a key, and an id with no `{` may
            // still have a name in the `pck` dictionary the base pack carries.
            name: found.content.getContentName(pack.id),
            type: pack.type,
            ...(art === null ? {} : { image: art }),
          }
        }),
      ),
      selected: new Set(config.getPacks('MoM')),
      baseId: BASE_PACK_ID,
    })
  }

  await render()
  show(panel({ class: ['vk-shell', 'vk-shell--art'], children: [backTo(menu), screen.element] }))
  onLeave(() => {
    for (const url of urls.values()) URL.revokeObjectURL(url)
    urls.clear()
  })
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

  show(
    panel({
      class: ['vk-shell', 'vk-shell--art'],
      children: [backTo(menu), screen.element, status],
    }),
  )
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
  onLeave(() => {
    b.destroy()
  })

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
      class: ['vk-shell', 'vk-shell--art'],
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
  // "ResizeObserver loop completed with undelivered notifications" is a notice
  // every browser emits when a layout settles over two frames. It is not a
  // failure, and reporting it as one is noise.
  if (event.message.includes('ResizeObserver loop')) return
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
