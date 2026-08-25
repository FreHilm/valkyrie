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
  inventory,
  monsterDialog,
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
import { MemoryFileSystem, StoragePaths } from '@valkyrie/platform'
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
            { label: rawText('Browse quests'), onPress: quests },
            { label: rawText('Board renderer'), onPress: boardDemo },
            { label: rawText('Event dialog'), onPress: eventDemo },
            { label: rawText('Monster activation'), onPress: activationDemo },
            { label: rawText('Attack a monster'), onPress: monsterDemo },
            { label: rawText('Quest log'), onPress: logDemo },
            { label: rawText('Items'), onPress: inventoryDemo },
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
