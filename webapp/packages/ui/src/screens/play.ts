/**
 * Playing a quest: the board, and whichever screen the session says is next.
 *
 * This is the routing layer the C# does not have. There, each dialog builds
 * itself in its constructor and destroys the others by tag, so "which screen is
 * showing" exists only as a side effect of object lifetimes. Here the session
 * answers `view()` and this puts the corresponding screen on the page.
 *
 * The board is always present underneath, because a Mansions quest is played on
 * it between events — a player clicks a door, answers what happens, and clicks
 * the next one.
 */

import { activationDialog } from './activationDialog.js'
import { eventDialog } from './eventDialog.js'
import { gameMenu } from './gameMenu.js'
import { phaseTransition } from './phaseTransition.js'
import { inventory } from './inventory.js'
import type { InventoryItem } from './inventory.js'
import { monsterDialog } from './monsterDialog.js'
import type { MonsterDialogView } from './monsterDialog.js'
import { questLog } from './questLog.js'
import type { QuestLogView } from './questLog.js'
import { setWindow } from './setWindow.js'
import type { SetWindowView } from './setWindow.js'
import { board } from '../board.js'
import { buildScene } from '../boardScene.js'
import type { SceneItem, SceneSources } from '../boardScene.js'
import { questUiLayer } from '../questUiLayer.js'
import type { RichTextOptions } from '../richText.js'
import type { CameraCommand } from '@valkyrie/core'
import type { QuestUiElement } from '../questUiLayer.js'
import { button, label, panel } from '../components.js'
import { clear, el } from '../dom.js'
import { rawText } from '../text.js'
import type { Text } from '../text.js'

/** The session surface this screen drives. Structural, so it can be faked. */
export interface PlayableSession {
  view: () => {
    kind: string
    /** Set on `changeQuest`: the scenario being handed over to. */
    path?: string
    name?: string
    text?: string
    buttons?: readonly { label: string; index: number; disabled: boolean }[]
    /** Set when the event asks for a number rather than a choice. */
    quota?: { value: number; max: number }
    /** `AddHighlight`: the board space the event points at. */
    highlight?: { x: number; y: number }
    /** `DrawItem`: the one item the event hands over, already resolved. */
    grantedItem?: string
    /** Whether the event may be closed without answering it. */
    cancelable?: boolean
    monster?: { monsterName: string }
    activation?: { effect: string; masterActions: string; move: string; ad: unknown }
    phase?: string
    puzzle?: {
      name: string
      kind: 'slide' | 'code' | 'image' | 'tower'
      state: unknown
      solved: boolean
    }
  }
  press: (index: number) => void
  /** `NextStageButton.Next`: the one arrow that moves the round on. */
  nextPhase: () => boolean
  /** Which phase the round is in, for the label beside the arrow. */
  phase: () => 'investigator' | 'mythos' | 'monsters' | 'horror'
  /**
   * The next phase to announce, drained once. Null when none is owed.
   *
   * Separate from `view()` because an announcement covers what is on screen
   * rather than being what is on screen — a mythos event's dialog is up behind
   * it, which is exactly what `ChangePhaseWindow` preserves.
   */
  takeAnnouncement: () => 'investigator' | 'mythos' | 'monsters' | 'horror' | null
  /** `DialogWindow.onQuota`: what the player dialled on the spinner. */
  pressQuota: (value: number) => void
  /** What a combat dialog showed, for the quest log. Newlines already escaped. */
  logEntry: (text: string) => void
  finishPuzzle: (name: string) => void
  closePuzzle: () => void
  /** `DialogWindow.onCancel`: closes a cancelable event without running it. */
  cancel: () => boolean
  activate: (name: string) => void
  activationDone: () => void
  investigatorsDone: () => void
  endPhase: () => boolean
  runtime: {
    boardItems: () => readonly { name: string; component: { type: string } }[]
    monsters: readonly { monsterName: string }[]
    log: { toArray: () => readonly { entry: string; editor: boolean }[] }
  }
}

export interface PlayStrings {
  boardLabel: Text
  /** `CommonStringKeys.TAB`, the arrow that moves the round on. */
  nextPhase: Text
  /** The four phase names, for the label beside it. */
  phaseInvestigator: Text
  phaseMythos: Text
  phaseMonsters: Text
  phaseHorror: Text
  continueLabel: Text
  loading: Text
  /** `ITEMS_SMALL`, `SET` and `LOG` on the phase bar. */
  items: Text
  set: Text
  log: Text
  /** `MenuButton`, top right, and the entries `GameMenu` offers. */
  menu: Text
  undo: Text
  save: Text
  mainMenu: Text
  cancel: Text
  /** Asked before the round is turned over, with the phase named in it. */
  endPhasePrompt: (phase: Text) => Text
  endPhaseConfirm: Text
  /** `SetWindow`'s two switches, and the `CLOSE` every menu shares. */
  setFire: Text
  clearFire: Text
  eliminated: Text
  close: Text
}

const DEFAULT_STRINGS: PlayStrings = {
  boardLabel: rawText('Quest board'),
  nextPhase: rawText('➤'),
  phaseInvestigator: rawText('Investigator Phase'),
  phaseMythos: rawText('Mythos Phase'),
  phaseMonsters: rawText('Monster Step'),
  phaseHorror: rawText('Horror Step'),
  continueLabel: rawText('Continue'),
  loading: rawText('Loading art…'),
  items: rawText('Items'),
  set: rawText('Set'),
  log: rawText('Log'),
  endPhasePrompt: (phase) =>
    rawText(`End the ${phase.kind === 'raw' ? phase.value : phase.key.translate()}?`),
  endPhaseConfirm: rawText('End Phase'),
  menu: rawText('Menu'),
  undo: rawText('Undo'),
  save: rawText('Save'),
  mainMenu: rawText('Main menu'),
  cancel: rawText('Cancel'),
  setFire: rawText('Set Fire'),
  clearFire: rawText('Clear Fire'),
  eliminated: rawText('Investigator Eliminated'),
  close: rawText('Close'),
}

/** One entry in the monster strip, which is `MonsterCanvas`'s icon list. */
export interface MonsterEntry {
  /** Position in the runtime's monster list; the board uses it as an id too. */
  index: number
  name: string
  /** Icon URL, or null while it is still resolving. */
  image: string | null
  /** `MonsterIcon.Update` greys out a monster that has already activated. */
  activated: boolean
}

export interface PlayOptions {
  session: PlayableSession
  /** Where each board item's art comes from. */
  sources: SceneSources
  /**
   * Renders a puzzle into the overlay.
   *
   * Injected rather than imported so the four puzzle screens are only pulled
   * in by an application that plays quests — a shell that only browses them
   * does not need them.
   */
  onPuzzle?: (
    puzzle: { name: string; kind: string; state: unknown; solved: boolean },
    chrome: { moves: number; solved: boolean; onSolved: () => void; onGiveUp: () => void },
    into: HTMLElement,
    refresh: () => void,
  ) => void
  /**
   * The scenario's own screen-space elements, rebuilt on every refresh.
   *
   * A quest adds and removes these as it runs — the opening journal is three
   * of them, and the event that dismisses it removes all three.
   */
  questUi?: () => readonly QuestUiElement[]
  /**
   * A scenario has handed over to another one. The screen cannot do it — the
   * new quest has to be read and loaded — so it says so and stops drawing.
   */
  onChangeQuest?: (path: string) => void
  /**
   * The quest is over. `EventManager.cs:460` sets `questHasEnded` and leaves
   * the board behind for a screen this one cannot build, because the summary
   * needs the party's names and how long they played.
   */
  onEnded?: () => void
  /**
   * Content the scenario needs and the player has not got.
   *
   * Shown over the board rather than logged: the symptom is a board with
   * pieces missing from it, which a player has no other way to make sense of.
   */
  notices?: () => readonly string[]
  /** The monsters in play, for the strip down the edge of the board. */
  monsterList?: () => readonly MonsterEntry[]
  /**
   * Builds the dialog for the monster at `index`.
   *
   * The health, the attacks and the text all come from content the play screen
   * has no view of, so the application assembles it and this only decides when
   * to show it.
   */
  monsterView?: (index: number, close: () => void) => MonsterDialogView | null
  /**
   * The three menus on the phase bar, from `NextStageButton`.
   *
   * Each is drawn only if supplied, so a shell that shows a board without a
   * quest behind it gets no buttons it cannot answer. The C# always draws all
   * three, and gates them on the press instead.
   */
  menus?: {
    /** `Items`, which opens `InventoryWindowMoM`. */
    items?: {
      list: () => readonly InventoryItem[]
      /** `Inspect`: queues the item's inspect event. */
      onInspect: (id: string) => void
    }
    /** `Log`, which opens `LogWindow`. */
    log?: {
      view: () => QuestLogView
      onSetVariable?: (name: string, value: number) => void
      /** `Game.testMode`: whether the developer view starts open. */
      developer?: boolean
    }
    /** `MenuButton`, which opens `GameMenu`. */
    game?: {
      /** `Quest.Undo`. */
      onUndo: () => void
      canUndo: () => boolean
      /** Opens the save slots in save mode. */
      onSave: () => void
      /** `GameMenu.Quit`: autosaves, then leaves. */
      onMainMenu: () => void
    }
    /** `Set`, which opens `SetWindow`. */
    set?: {
      view: () => SetWindowView
      onFire: (lit: boolean) => void
      onEliminated: (eliminated: boolean) => void
    }
  }
  /**
   * How quest prose is rendered: its `<i>` and `<b>` as elements, its symbol
   * glyphs as named icons. Every screen this routes to gets the same one.
   */
  rich?: RichTextOptions
  /** `DrawItem`: the card art for an item an event hands over. */
  itemImage?: (id: string) => string | null
  /**
   * The clicked token's own art, as a URL.
   *
   * Cropped already, because a token can be one cell of a sheet and only the
   * application can read the file to cut it out. Null for an event that is
   * not a board piece, which is most of them.
   */
  eventIcon?: (eventName: string) => string | null
  /**
   * `ImageGreenBG` and `ImageMythosBackground`: the artwork a phase is
   * announced over.
   */
  phaseArt?: (phase: string) => string | null
  /** The party's portraits, lined up under the investigators' own phase. */
  party?: () => readonly { name: string; image: string | null }[]
  /** How long the announcement stays up. Injected so tests need not wait. */
  transitionDuration?: number
  /** Loads and crops an image; resolves to null when it is unavailable. */
  loadTexture?: (
    path: string,
    crop?: { x: number; y: number; width: number; height: number },
  ) => Promise<CanvasImageSource | null>
  strings?: Partial<PlayStrings>
}

export interface PlayScreen {
  element: HTMLElement
  /** Re-reads the session and redraws. Call after anything that changes it. */
  refresh: () => void
  /** Applies what an event asked of the camera. */
  camera: (command: CameraCommand) => void
  destroy: () => void
}

export function playScreen(options: PlayOptions): PlayScreen {
  const strings = { ...DEFAULT_STRINGS, ...options.strings }
  const { session } = options

  const rich = options.rich === undefined ? {} : { rich: options.rich }

  const overlay = el('div', { class: 'vk-play__overlay' })
  const controls = el('div', { class: 'vk-play__controls', attrs: { role: 'group' } })
  // `NextStageButton` draws these against the left edge, under whatever dialog
  // is up rather than inside it — they are tagged `UIPHASE`, and a dialog is
  // `DIALOG`. Two layers here for the same reason: a menu opens over the event
  // that is still showing behind it.
  const menuBar = el('div', { class: 'vk-play__menus', attrs: { role: 'group' } })
  const menuLayer = el('div', { class: 'vk-play__menu' })
  // `MenuButton` sits top right, clear of the phase bar at the bottom left and
  // the monster strip down the right edge.
  const menuButton = el('div', { class: 'vk-play__menu-button' })
  const surface = el('div', { class: 'vk-play__board' })

  const view = board({
    label:
      typeof strings.boardLabel === 'object' && strings.boardLabel.kind === 'raw'
        ? strings.boardLabel.value
        : 'Quest board',
    onSelect: (item) => {
      // A monster opens its own dialog rather than firing an event: it is not
      // a quest component, and `MonsterCanvas.MonsterDiag` is what a click on
      // one reaches. Everything else on the board is a component name.
      const monster = monsterIndex(item.id)
      if (monster !== null) {
        pickMonster(monster)
        return
      }
      session.activate(item.id)
      refresh()
    },
  })
  surface.append(view.element)
  // Beside the canvas: the same pieces, as buttons a keyboard can reach.
  surface.append(view.pieces)

  /** `monster:<index>:<name>`, as `buildScene` writes it. */
  function monsterIndex(id: string): number | null {
    if (!id.startsWith('monster:')) return null
    const index = Number.parseInt(id.slice('monster:'.length), 10)
    return Number.isNaN(index) ? null : index
  }

  /** Which monster's dialog is open, if any. */
  let selected: number | null = null

  /**
   * `MonsterDiag` opens nothing while another dialog is up:
   * `FindGameObjectWithTag(Game.DIALOG) != null` and it returns. Without the
   * same guard a click during an event is remembered and the monster dialog
   * appears on its own once the event closes.
   */
  function pickMonster(index: number): void {
    if (session.view().kind !== 'board') return
    selected = index
    refresh()
  }

  const monsters = el('div', { class: 'vk-play__monsters' })
  const notices = el('div', { class: 'vk-play__notices', attrs: { role: 'status' } })
  // The dialogs escape their own newlines before handing the text over, which
  // is how the C# writes them and therefore how a save round-trips them.
  const logEntry = (text: string): void => {
    session.logEntry(text)
  }

  const monster = monsterDialog({ ...rich, onLog: logEntry })

  const events = eventDialog({ ...rich, strings: { cancel: strings.cancel } })
  const activation = activationDialog({
    ...rich,
    onLog: logEntry,
    onFinished: () => {
      session.activationDone()
      refresh()
    },
  })

  /** Which of the three phase-bar menus is open, if any. */
  let openMenu: 'items' | 'set' | 'log' | 'game' | null = null

  /** Whether the quest's end has already been handed over. */
  let ended = false

  /** Whether an announcement is up, so the next waits its turn. */
  let announcing = false

  /** Whether the arrow has been pressed and is waiting to be confirmed. */
  let confirmingPhase = false

  function closeMenu(): void {
    openMenu = null
    refresh()
  }

  const items = inventory({
    onInspect: (id) => {
      // `Inspect` closes the window before queueing, because the event that
      // follows is a dialog and the two would otherwise be on screen at once.
      openMenu = null
      options.menus?.items?.onInspect(id)
      refresh()
    },
    onClose: closeMenu,
    strings: { title: strings.items, close: strings.close },
  })

  const log = questLog({
    onClose: closeMenu,
    ...rich,
    ...(options.menus?.log?.developer === undefined
      ? {}
      : { developer: options.menus.log.developer }),
    onSetVariable: (name, value) => {
      options.menus?.log?.onSetVariable?.(name, value)
      refresh()
    },
    strings: { title: strings.log, close: strings.close },
  })

  const set = setWindow({
    onFire: (lit) => {
      options.menus?.set?.onFire(lit)
      refresh()
    },
    onEliminated: (eliminated) => {
      options.menus?.set?.onEliminated(eliminated)
      refresh()
    },
    onClose: closeMenu,
    strings: {
      title: strings.set,
      setFire: strings.setFire,
      clearFire: strings.clearFire,
      eliminated: strings.eliminated,
      close: strings.close,
    },
  })

  const game = gameMenu({
    onUndo: () => {
      openMenu = null
      options.menus?.game?.onUndo()
      refresh()
    },
    onSave: () => {
      openMenu = null
      options.menus?.game?.onSave()
    },
    onMainMenu: () => {
      openMenu = null
      options.menus?.game?.onMainMenu()
    },
    onCancel: closeMenu,
    strings: {
      title: strings.menu,
      undo: strings.undo,
      save: strings.save,
      mainMenu: strings.mainMenu,
      cancel: strings.cancel,
    },
  })

  const transition = phaseTransition({
    onDone: () => {
      announcing = false
      // Another may be waiting: an empty mythos hands straight back to the
      // investigators, and both are owed to the player.
      announce()
    },
    ...(options.transitionDuration === undefined ? {} : { duration: options.transitionDuration }),
  })

  const questUi = questUiLayer({
    ...rich,
    onSelect: (name) => {
      session.activate(name)
      refresh()
    },
    ...(options.sources.onWarning === undefined ? {} : { onWarning: options.sources.onWarning }),
  })

  // Order is paint order, and it is the game's: `QuestUICanvas` is created
  // with `SetAsFirstSibling` so a scenario's own screen sits behind, and a
  // dialog covers it rather than the other way round.
  const element = panel({
    class: 'vk-play',
    children: [
      surface,
      questUi.element,
      monsters,
      notices,
      overlay,
      menuLayer,
      controls,
      menuBar,
      menuButton,
      // Over everything: `ChangePhaseWindow` covers the dialogs rather than
      // closing them, so what was showing is still there when it lifts.
      transition.element,
    ],
  })

  /** Art already requested, so a redraw does not re-request it. */
  const textures = new Map<string, CanvasImageSource | null>()

  function sceneKey(item: SceneItem): string {
    const source = item.source
    if (source === null) return ''
    const crop = source.crop
    return crop === undefined
      ? source.path
      : `${source.path}#${crop.x},${crop.y},${crop.width},${crop.height}`
  }

  function drawBoard(): void {
    // The mark belongs to the event, not the board, so it is read fresh here
    // and disappears with the event that asked for it.
    const current = session.view()
    const highlight =
      current.kind === 'event' && current.highlight !== undefined
        ? { at: current.highlight, item: current.grantedItem ?? null }
        : null

    const scene = buildScene(
      session.runtime.boardItems() as never,
      session.runtime.monsters,
      options.sources,
      highlight,
    )

    for (const item of scene) {
      const key = sceneKey(item)
      if (key.length === 0) continue
      const known = textures.get(key)
      if (known !== undefined) {
        item.image = known
        continue
      }
      // Requested once; the board redraws when it arrives.
      textures.set(key, null)
      const source = item.source
      if (source === null || options.loadTexture === undefined) continue
      void options
        .loadTexture(source.path, source.crop)
        .then((image) => {
          textures.set(key, image)
          if (image !== null) view.invalidate()
          if (image !== null) drawBoard()
        })
        .catch(() => {
          /* a gap on the board, not a broken quest */
        })
    }

    view.setItems(scene)
    questUi.setElements(options.questUi?.() ?? [])
    drawMonsterStrip()
    drawNotices()
  }

  /** Whatever the board could not draw, said once each. */
  function drawNotices(): void {
    const messages = options.notices?.() ?? []
    clear(notices)
    for (const message of messages) {
      notices.append(el('p', { class: 'vk-play__notice', text: message }))
    }
  }

  /**
   * The monster list down the edge of the board.
   *
   * `MonsterCanvas` draws it against the right edge of the screen, one icon
   * per monster in play, greyed once that monster has activated this round.
   */
  function drawMonsterStrip(): void {
    clear(monsters)
    for (const entry of options.monsterList?.() ?? []) {
      const icon = el('button', {
        class: entry.activated
          ? 'vk-play__monster vk-play__monster--activated'
          : 'vk-play__monster',
        attrs: { type: 'button', title: entry.name, 'aria-label': entry.name },
      })
      if (entry.image !== null) {
        icon.append(el('img', { attrs: { src: entry.image, alt: '' } }))
      } else {
        icon.textContent = entry.name.slice(0, 2)
      }
      icon.addEventListener('click', () => {
        pickMonster(entry.index)
      })
      monsters.append(icon)
    }
  }

  /**
   * The phase bar's three menu buttons, from `NextStageButton.Update`.
   *
   * `Items` and `Set` return without doing anything while a dialog is up, and
   * `Log` carries a comment saying it must always be available. Disabling is
   * this port's way of saying the first part before the press rather than
   * after it.
   */
  function drawMenuBar(kind: string): void {
    clear(menuBar)
    clear(menuButton)
    clear(controls)
    // The menu is always reachable, dialog or not: it is how a player saves
    // and how they leave, and neither should wait for an event to be answered.
    if (options.menus?.game !== undefined) {
      menuButton.append(
        button(strings.menu, {
          onPress: () => {
            openMenu = 'game'
            refresh()
          },
        }),
      )
    }
    // `if (!firstTileDisplayed) return`: the bar waits for the board to have
    // something on it, so the opening cutscene is not framed by chrome. The
    // port reads that off the board rather than keeping the flag.
    const onBoard = session.runtime.boardItems().some((item) => item.component.type === 'Tile')
    if (!onBoard) return

    const dialogUp = kind !== 'board'
    const menus = options.menus
    if (menus === undefined) return

    if (menus.items !== undefined) {
      menuBar.append(
        button(strings.items, {
          onPress: () => {
            openMenu = 'items'
            refresh()
          },
          ...(dialogUp ? { disabled: true } : {}),
        }),
      )
    }
    if (menus.set !== undefined) {
      menuBar.append(
        button(strings.set, {
          onPress: () => {
            openMenu = 'set'
            refresh()
          },
          ...(dialogUp ? { disabled: true } : {}),
        }),
      )
    }
    if (menus.log !== undefined) {
      menuBar.append(
        button(strings.log, {
          onPress: () => {
            openMenu = 'log'
            refresh()
          },
        }),
      )
    }
  }

  /**
   * The phase, and the one arrow that moves the round on.
   *
   * On the same row as the menus and, like them, under whatever dialog is up
   * rather than inside it — `NextStageButton` tags the whole bar `UIPHASE`, so
   * a player can always see which phase they are in. The arrow is disabled
   * while a dialog shows, which is `Next` returning early.
   */
  function drawPhaseBar(kind: string): void {
    const onBoard = session.runtime.boardItems().some((item) => item.component.type === 'Tile')
    if (!onBoard) return

    const phase = session.phase()
    controls.append(
      label(phaseName(phase), {
        class:
          phase === 'investigator'
            ? 'vk-play__phase-name'
            : ['vk-play__phase-name', 'vk-play__phase-name--danger'],
      }),
    )
    controls.append(
      button(strings.nextPhase, {
        onPress: () => {
          // Asked first: turning the round over is the one move a player
          // cannot take back without the undo, and the arrow is a small
          // target beside a board they have been clicking on.
          confirmingPhase = true
          refresh()
        },
        size: 'large',
        class: 'vk-play__next',
        describedBy: strings.nextPhase,
        ...(kind === 'board' ? {} : { disabled: true }),
      }),
    )
  }

  /** The prompt the arrow raises before the round is turned over. */
  function drawPhasePrompt(): void {
    if (!confirmingPhase) return
    const ask = panel({
      class: 'vk-play__confirm',
      children: [
        label(strings.endPhasePrompt(phaseName(session.phase())), { heading: 2, size: 'medium' }),
      ],
    })
    const actions = el('div', { class: 'vk-play__confirm-actions', attrs: { role: 'group' } })
    actions.append(
      button(strings.endPhaseConfirm, {
        onPress: () => {
          confirmingPhase = false
          session.nextPhase()
          refresh()
        },
        variant: 'primary',
        size: 'medium',
      }),
    )
    actions.append(
      button(strings.cancel, {
        onPress: () => {
          confirmingPhase = false
          refresh()
        },
        size: 'medium',
      }),
    )
    ask.append(actions)
    menuLayer.append(ask)
  }

  /** The open menu, drawn over whatever dialog is already showing. */
  function drawMenu(): void {
    clear(menuLayer)
    const menus = options.menus
    if (openMenu === 'items' && menus?.items !== undefined) {
      items.show(menus.items.list())
      menuLayer.append(items.element)
    } else if (openMenu === 'log' && menus?.log !== undefined) {
      log.show(menus.log.view())
      menuLayer.append(log.element)
    } else if (openMenu === 'set' && menus?.set !== undefined) {
      set.show(menus.set.view())
      menuLayer.append(set.element)
    } else if (openMenu === 'game' && menus?.game !== undefined) {
      game.show({ canUndo: menus.game.canUndo() })
      menuLayer.append(game.element)
    } else {
      openMenu = null
    }
  }

  /**
   * Puts up the next phase announcement, if one is owed.
   *
   * `ChangePhaseWindow` covers whatever is on screen rather than replacing it
   * — a mythos event's dialog is already up behind it — so this is drawn over
   * the top and never decides what else is showing.
   */
  function announce(): void {
    if (announcing) return
    const phase = session.takeAnnouncement()
    if (phase === null) return

    announcing = true
    transition.show({
      name: phaseName(phase),
      background: options.phaseArt?.(phase) ?? null,
      mythos: phase !== 'investigator',
      ...(phase === 'investigator' ? { portraits: options.party?.() ?? [] } : {}),
    })
  }

  function refresh(): void {
    draw()
    // Last, and after every path through `draw` — an announcement covers
    // whatever was drawn rather than deciding it, and `draw` returns early for
    // most of what it can show.
    announce()
  }

  function draw(): void {
    drawBoard()
    clear(overlay)
    clear(controls)

    const current = session.view()

    // Before anything is drawn: what is on screen belongs to the scenario
    // being left, and the next one is not loaded yet.
    if (current.kind === 'changeQuest') {
      clear(menuBar)
      clear(menuButton)
      clear(menuLayer)
      if (current.path !== undefined) options.onChangeQuest?.(current.path)
      return
    }

    // Before the dispatch below, which returns early for every kind: the bar
    // outlives the dialogs, and the menu is drawn last so it sits over them.
    if (current.kind === 'ended') {
      clear(menuBar)
      clear(menuButton)
      clear(menuLayer)
      openMenu = null
    } else {
      drawMenuBar(current.kind)
      drawPhaseBar(current.kind)
      drawMenu()
      drawPhasePrompt()
    }

    if (current.kind === 'event') {
      const quota = current.quota
      // `DrawItem` returns early for a highlight event, because
      // `AddHighlight` has already put the card on the board.
      const card =
        current.highlight === undefined && current.grantedItem !== undefined
          ? (options.itemImage?.(current.grantedItem) ?? null)
          : null
      // The thing the player clicked, drawn beside the words so a dialog says
      // which token it came from. Only a door, a token or a UI element
      // resolves here; an event the quest raised itself has no picture.
      const icon = current.name === undefined ? null : (options.eventIcon?.(current.name) ?? null)
      events.show({
        text: current.text ?? '',
        ...(card === null ? {} : { image: card }),
        ...(icon === null ? {} : { icon }),
        ...(current.cancelable === true
          ? {
              onCancel: () => {
                session.cancel()
                refresh()
              },
            }
          : {}),
        buttons: (current.buttons ?? []).map((b) => ({
          text: b.label,
          onPress: () => {
            session.press(b.index)
            refresh()
          },
          ...(b.disabled ? { disabled: true } : {}),
        })),
        ...(quota === undefined
          ? {}
          : {
              quota: {
                value: quota.value,
                max: quota.max,
                onSubmit: (value: number) => {
                  session.pressQuota(value)
                  refresh()
                },
              },
            }),
      })
      overlay.append(events.element)
      return
    }

    if (current.kind === 'activation' && current.activation !== undefined) {
      activation.show({
        monsterName: current.monster?.monsterName ?? '',
        effect: current.activation.effect,
        attack: current.activation.masterActions,
        move: current.activation.move,
        moveLabel: 'Move',
      })
      overlay.append(activation.element)
      return
    }

    if (current.kind === 'puzzle' && current.puzzle !== undefined) {
      const showing = current.puzzle
      // The puzzle screens are given the state and told what to do with the
      // result; they do not know about the session.
      const chrome = {
        moves: (showing.state as { moves?: number }).moves ?? 0,
        solved: showing.solved,
        onSolved: () => {
          session.finishPuzzle(showing.name)
          refresh()
        },
        onGiveUp: () => {
          // Closing keeps the board, so the player returns to their progress.
          session.closePuzzle()
          refresh()
        },
      }
      options.onPuzzle?.(showing, chrome, overlay, refresh)
      return
    }

    if (current.kind === 'ended') {
      selected = null
      // Once only: `refresh` runs again for anything that touches the board,
      // and the end screen must not be rebuilt underneath the player.
      if (!ended) {
        ended = true
        options.onEnded?.()
      }
      return
    }

    // Only reached with the board clear, which is the state `MonsterDiag`
    // requires; every quest screen above has already returned.
    if (selected !== null) {
      const close = (): void => {
        selected = null
        refresh()
      }
      const monsterState = options.monsterView?.(selected, close) ?? null
      if (monsterState === null) selected = null
      else {
        monster.show(monsterState)
        overlay.append(monster.element)
        return
      }
    }
  }

  /** The `val` name of a phase, which the C# colours red for anything but the first. */
  function phaseName(phase: ReturnType<PlayableSession['phase']>): Text {
    if (phase === 'mythos') return strings.phaseMythos
    if (phase === 'monsters') return strings.phaseMonsters
    if (phase === 'horror') return strings.phaseHorror
    return strings.phaseInvestigator
  }

  refresh()
  // Where `ChangeQuest` puts it: the origin, at the standard zoom. Framing
  // everything instead would start every quest at whatever scale fits the
  // board it has not placed yet, which is as far out as it goes.
  view.lookAt({ x: 0, y: 0 })

  return {
    element,
    refresh,
    camera: (command) => {
      if (command.kind === 'look') view.lookAt(command.at)
      else view.limitTo(command.kind, command.at)
    },
    destroy: () => {
      view.destroy()
      questUi.destroy()
    },
  }
}
