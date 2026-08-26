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
import { monsterDialog } from './monsterDialog.js'
import type { MonsterDialogView } from './monsterDialog.js'
import { board } from '../board.js'
import { buildScene } from '../boardScene.js'
import type { SceneItem, SceneSources } from '../boardScene.js'
import { questUiLayer } from '../questUiLayer.js'
import type { RichTextOptions } from '../richText.js'
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
}

const DEFAULT_STRINGS: PlayStrings = {
  boardLabel: rawText('Quest board'),
  endTurn: rawText('End investigator turn'),
  endPhase: rawText('Finish the phase'),
  continueLabel: rawText('Continue'),
  loading: rawText('Loading art…'),
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
   * How quest prose is rendered: its `<i>` and `<b>` as elements, its symbol
   * glyphs as named icons. Every screen this routes to gets the same one.
   */
  rich?: RichTextOptions
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
  destroy: () => void
}

export function playScreen(options: PlayOptions): PlayScreen {
  const strings = { ...DEFAULT_STRINGS, ...options.strings }
  const { session } = options

  const rich = options.rich === undefined ? {} : { rich: options.rich }

  const overlay = el('div', { class: 'vk-play__overlay' })
  const controls = el('div', { class: 'vk-play__controls', attrs: { role: 'group' } })
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
  const monster = monsterDialog({ ...rich, onLog: () => {} })

  const events = eventDialog(rich)
  const activation = activationDialog({
    ...rich,
    onLog: () => {},
    onFinished: () => {
      session.activationDone()
      refresh()
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
    children: [surface, questUi.element, monsters, overlay, controls],
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
    const scene = buildScene(
      session.runtime.boardItems() as never,
      session.runtime.monsters,
      options.sources,
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

  function refresh(): void {
    drawBoard()
    clear(overlay)
    clear(controls)

    const current = session.view()

    // Before anything is drawn: what is on screen belongs to the scenario
    // being left, and the next one is not loaded yet.
    if (current.kind === 'changeQuest') {
      if (current.path !== undefined) options.onChangeQuest?.(current.path)
      return
    }

    if (current.kind === 'event') {
      events.show({
        text: current.text ?? '',
        buttons: (current.buttons ?? []).map((b) => ({
          text: b.label,
          onPress: () => {
            session.press(b.index)
            refresh()
          },
          ...(b.disabled ? { disabled: true } : {}),
        })),
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
  view.frameAll()

  return {
    element,
    refresh,
    destroy: () => {
      view.destroy()
      questUi.destroy()
    },
  }
}
