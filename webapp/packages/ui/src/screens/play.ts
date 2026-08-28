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
  /** `DialogWindow.onQuota`: what the player dialled on the spinner. */
  pressQuota: (value: number) => void
  /** What a combat dialog showed, for the quest log. Newlines already escaped. */
  logEntry: (text: string) => void
  finishPuzzle: (name: string) => void
  closePuzzle: () => void
  activate: (name: string) => void
  activationDone: () => void
  phaseAcknowledged: () => void
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
  endTurn: Text
  endPhase: Text
  continueLabel: Text
  loading: Text
  /** `ITEMS_SMALL`, `SET` and `LOG` on the phase bar. */
  items: Text
  set: Text
  log: Text
  /** `SetWindow`'s two switches, and the `CLOSE` every menu shares. */
  setFire: Text
  clearFire: Text
  eliminated: Text
  close: Text
}

const DEFAULT_STRINGS: PlayStrings = {
  boardLabel: rawText('Quest board'),
  endTurn: rawText('End investigator turn'),
  endPhase: rawText('Finish the phase'),
  continueLabel: rawText('Continue'),
  loading: rawText('Loading art…'),
  items: rawText('Items'),
  set: rawText('Set'),
  log: rawText('Log'),
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

  const events = eventDialog(rich)
  const activation = activationDialog({
    ...rich,
    onLog: logEntry,
    onFinished: () => {
      session.activationDone()
      refresh()
    },
  })

  /** Which of the three phase-bar menus is open, if any. */
  let openMenu: 'items' | 'set' | 'log' | null = null

  /** Whether the quest's end has already been handed over. */
  let ended = false

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
    children: [surface, questUi.element, monsters, notices, overlay, menuLayer, controls, menuBar],
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
    // `if (!firstTileDisplayed) return`: the bar waits for the board to have
    // something on it, so the opening cutscene is not framed by chrome. The
    // port reads that off the board rather than keeping the flag.
    const onBoard = session
      .runtime.boardItems()
      .some((item) => item.component.type === 'Tile')
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
    } else {
      openMenu = null
    }
  }

  function refresh(): void {
    drawBoard()
    clear(overlay)
    clear(controls)

    const current = session.view()

    // Before anything is drawn: what is on screen belongs to the scenario
    // being left, and the next one is not loaded yet.
    if (current.kind === 'changeQuest') {
      clear(menuBar)
      clear(menuLayer)
      if (current.path !== undefined) options.onChangeQuest?.(current.path)
      return
    }

    // Before the dispatch below, which returns early for every kind: the bar
    // outlives the dialogs, and the menu is drawn last so it sits over them.
    if (current.kind === 'ended') {
      clear(menuBar)
      clear(menuLayer)
      openMenu = null
    } else {
      drawMenuBar(current.kind)
      drawMenu()
    }

    if (current.kind === 'event') {
      const quota = current.quota
      // `DrawItem` returns early for a highlight event, because
      // `AddHighlight` has already put the card on the board.
      const card =
        current.highlight === undefined && current.grantedItem !== undefined
          ? (options.itemImage?.(current.grantedItem) ?? null)
          : null
      events.show({
        text: current.text ?? '',
        ...(card === null ? {} : { image: card }),
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

    if (current.kind === 'phase') {
      overlay.append(
        panel({
          class: 'vk-play__phase',
          children: [
            label(rawText(String(current.phase ?? '')), { heading: 2, size: 'medium' }),
            button(strings.continueLabel, {
              onPress: () => {
                session.phaseAcknowledged()
                refresh()
              },
              variant: 'primary',
              size: 'medium',
            }),
          ],
        }),
      )
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

    // The board, with the two things a player can do that are not on it.
    controls.append(
      button(strings.endTurn, {
        onPress: () => {
          session.investigatorsDone()
          refresh()
        },
        size: 'medium',
      }),
    )
    controls.append(
      button(strings.endPhase, {
        onPress: () => {
          session.endPhase()
          refresh()
        },
        size: 'medium',
      }),
    )
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
