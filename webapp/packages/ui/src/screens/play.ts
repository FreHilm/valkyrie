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
import { board } from '../board.js'
import { buildScene } from '../boardScene.js'
import type { SceneItem, SceneSources } from '../boardScene.js'
import { button, label, panel } from '../components.js'
import { clear, el } from '../dom.js'
import { rawText } from '../text.js'
import type { Text } from '../text.js'

/** The session surface this screen drives. Structural, so it can be faked. */
export interface PlayableSession {
  view: () => {
    kind: string
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

  const overlay = el('div', { class: 'vk-play__overlay' })
  const controls = el('div', { class: 'vk-play__controls', attrs: { role: 'group' } })
  const surface = el('div', { class: 'vk-play__board' })

  const view = board({
    label:
      typeof strings.boardLabel === 'object' && strings.boardLabel.kind === 'raw'
        ? strings.boardLabel.value
        : 'Quest board',
    onSelect: (item) => {
      // Monsters are not clickable targets for the event engine; everything
      // else on the board is a component name the quest can fire.
      if (item.id.startsWith('monster:')) return
      session.activate(item.id)
      refresh()
    },
  })
  surface.append(view.element)

  const events = eventDialog()
  const activation = activationDialog({
    onLog: () => {},
    onFinished: () => {
      session.activationDone()
      refresh()
    },
  })

  const element = panel({ class: 'vk-play', children: [surface, overlay, controls] })

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
  }

  function refresh(): void {
    drawBoard()
    clear(overlay)
    clear(controls)

    const current = session.view()

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

    if (current.kind === 'ended') return

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
    },
  }
}
