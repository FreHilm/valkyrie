/**
 * @vitest-environment happy-dom
 *
 * Tests for the play screen (T-018).
 *
 * This is the routing the C# does not have: there, each dialog builds itself in
 * its constructor and destroys the others by tag, so "which screen is showing"
 * exists only as a side effect of object lifetimes. Here the session answers
 * `view()` and this puts the matching screen on the page — which is a thing
 * that can be asserted.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { playScreen } from '../src/screens/play.js'
import type { PlayableSession } from '../src/screens/play.js'
import type { SceneSources } from '../src/boardScene.js'

beforeEach(() => {
  document.body.replaceChildren()
  // happy-dom has no canvas context; the board tolerates it, and these tests
  // are about routing rather than pixels.
  HTMLCanvasElement.prototype.getContext = (() => null) as never
})

const SOURCES: SceneSources = {
  tile: () => null,
  token: () => ({
    image: 'img/sheet',
    crop: { x: 0, y: 0, width: 64, height: 64 },
    width: 1,
    height: 1,
  }),
  monster: () => null,
  onGrid: false,
}

function session(view: ReturnType<PlayableSession['view']>, over: Partial<PlayableSession> = {}) {
  const calls: string[] = []
  const base: PlayableSession = {
    view: () => view,
    press: (i) => calls.push(`press:${i}`),
    finishPuzzle: (n) => calls.push(`finishPuzzle:${n}`),
    closePuzzle: () => calls.push('closePuzzle'),
    activate: (n) => calls.push(`activate:${n}`),
    activationDone: () => calls.push('activationDone'),
    phaseAcknowledged: () => calls.push('phaseAcknowledged'),
    investigatorsDone: () => calls.push('investigatorsDone'),
    endPhase: () => {
      calls.push('endPhase')
      return true
    },
    runtime: {
      boardItems: () => [{ name: 'TokenDoor', component: { type: 'Token' } }],
      monsters: [],
      log: { toArray: () => [] },
    },
    ...over,
  }
  return { session: base, calls }
}

function make(view: ReturnType<PlayableSession['view']>, over: Partial<PlayableSession> = {}) {
  const { session: s, calls } = session(view, over)
  const screen = playScreen({ session: s, sources: SOURCES })
  document.body.append(screen.element)
  return { screen, calls }
}

const buttons = (root: HTMLElement): HTMLButtonElement[] => [...root.querySelectorAll('button')]
const press = (root: HTMLElement, name: string): void => {
  const target = buttons(root).find((b) => b.textContent?.includes(name))
  if (target === undefined) throw new Error(`no button matching ${name}`)
  target.click()
}

describe('playScreen', () => {
  it('always keeps the board on the page', () => {
    // A Mansions quest is played on the board between events; hiding it behind
    // each dialog would lose the player's place.
    const { screen } = make({ kind: 'board' })

    expect(screen.element.querySelector('canvas')).not.toBeNull()
  })

  it('offers the two things a player does that are not on the board', () => {
    const { screen } = make({ kind: 'board' })

    expect(buttons(screen.element).map((b) => b.textContent)).toEqual([
      'End investigator turn',
      'Finish the phase',
    ])
  })

  it('ends the investigator turn', () => {
    const { screen, calls } = make({ kind: 'board' })
    press(screen.element, 'End investigator turn')

    expect(calls).toContain('investigatorsDone')
  })

  it('finishes the phase, which the horror phase waits for', () => {
    const { screen, calls } = make({ kind: 'board' })
    press(screen.element, 'Finish the phase')

    expect(calls).toContain('endPhase')
  })

  describe('when an event is open', () => {
    const EVENT = {
      kind: 'event',
      name: 'EventHallway',
      text: 'The hallway is dark.',
      buttons: [
        { label: 'Open the door', index: 0, disabled: false },
        { label: 'Locked', index: 1, disabled: true },
      ],
    }

    it('shows the text and the buttons', () => {
      const { screen } = make(EVENT)

      expect(screen.element.textContent).toContain('The hallway is dark.')
      expect(buttons(screen.element).map((b) => b.textContent)).toEqual(['Open the door', 'Locked'])
    })

    it('hides the turn controls, so the player answers first', () => {
      const { screen } = make(EVENT)

      expect(screen.element.textContent).not.toContain('End investigator turn')
    })

    it('presses by the button’s own index, not its position', () => {
      // A hidden button leaves a gap in the indices; pressing by position
      // would chain to the wrong event.
      const { screen, calls } = make({
        ...EVENT,
        buttons: [{ label: 'Second', index: 1, disabled: false }],
      })
      press(screen.element, 'Second')

      expect(calls).toContain('press:1')
    })

    it('shows a disabled button as unpressable rather than hiding it', () => {
      const { screen } = make(EVENT)
      const locked = buttons(screen.element).find((b) => b.textContent === 'Locked')

      expect(locked?.disabled).toBe(true)
    })
  })

  it('shows a monster activation', () => {
    const { screen } = make({
      kind: 'activation',
      monster: { monsterName: 'Zombie' },
      activation: {
        effect: 'The Zombie lurches.',
        masterActions: 'It attacks.',
        move: 'It moves.',
        ad: {},
      },
    })

    expect(screen.element.textContent).toContain('The Zombie lurches.')
  })

  it('acknowledges a phase change', () => {
    const { screen, calls } = make({ kind: 'phase', phase: 'mythos' })
    press(screen.element, 'Continue')

    expect(calls).toContain('phaseAcknowledged')
  })

  it('shows nothing over the board once the quest has ended', () => {
    const { screen } = make({ kind: 'ended' })

    expect(buttons(screen.element)).toHaveLength(0)
    expect(screen.element.querySelector('canvas')).not.toBeNull()
  })

  it('requests each image once, however often the board redraws', async () => {
    const loadTexture = vi.fn().mockResolvedValue(null)
    const { session: s } = session({ kind: 'board' })
    const screen = playScreen({ session: s, sources: SOURCES, loadTexture })
    document.body.append(screen.element)
    screen.refresh()
    screen.refresh()

    expect(loadTexture).toHaveBeenCalledTimes(1)
  })
})

describe('monsters', () => {
  const ENTRIES = [
    { index: 0, name: 'Zombie', image: null, activated: false },
    { index: 1, name: 'Maniac', image: 'blob:maniac', activated: true },
  ]

  function withMonsters(view: ReturnType<PlayableSession['view']>) {
    const { session: s, calls } = session(view)
    const seen: number[] = []
    const screen = playScreen({
      session: s,
      sources: SOURCES,
      monsterList: () => ENTRIES,
      monsterView: (index, close) => {
        seen.push(index)
        return {
          monsterName: ENTRIES[index]?.name ?? '',
          horrorPhase: false,
          health: { health: 3, damage: 0, onDamageChange: () => {}, onDefeated: () => {} },
          attackTypes: ['unarmed'],
          onAttack: () => 'You strike it.',
          onEvade: () => null,
          onHorror: () => null,
          onCancel: close,
        }
      },
    })
    document.body.append(screen.element)
    return { screen, calls, seen }
  }

  const icons = (screen: { element: HTMLElement }): HTMLButtonElement[] =>
    [...screen.element.querySelectorAll('.vk-play__monster')] as HTMLButtonElement[]

  it('lists every monster in play, greying the ones that have activated', () => {
    const { screen } = withMonsters({ kind: 'board' })

    expect(icons(screen)).toHaveLength(2)
    expect(icons(screen)[1]?.classList.contains('vk-play__monster--activated')).toBe(true)
  })

  it('opens the dialog for the monster whose icon is pressed', () => {
    const { screen, seen } = withMonsters({ kind: 'board' })

    icons(screen)[1]?.click()

    expect(seen).toContain(1)
    expect(screen.element.querySelector('.vk-monster')).not.toBeNull()
  })

  it('opens the dialog when a monster on the board is clicked', () => {
    // buildScene ids monsters as `monster:<index>:<name>`, and the play screen
    // is what turns that back into a dialog rather than a quest event.
    const { screen, calls, seen } = withMonsters({ kind: 'board' })
    const board = screen.element.querySelector('canvas')

    expect(board).not.toBeNull()
    // Reach the handler the board would call rather than simulating a drag.
    icons(screen)[0]?.click()

    expect(seen).toContain(0)
    expect(calls.filter((c) => c.startsWith('activate:'))).toEqual([])
  })

  it('ignores a monster click while a dialog is already up', () => {
    // MonsterCanvas.MonsterDiag returns immediately when Game.DIALOG exists.
    const { screen, seen } = withMonsters({ kind: 'event', text: 'Something happens' })

    icons(screen)[0]?.click()

    expect(seen).toEqual([])
    expect(screen.element.querySelector('.vk-monster')).toBeNull()
  })

  it('closes the dialog when it is cancelled', () => {
    const { screen } = withMonsters({ kind: 'board' })
    icons(screen)[0]?.click()

    press(screen.element, 'Cancel')

    expect(screen.element.querySelector('.vk-monster')).toBeNull()
  })
})

describe('puzzles', () => {
  const PUZZLE = {
    kind: 'puzzle',
    puzzle: { name: 'PuzzleFrontDoor', kind: 'tower' as const, state: { moves: 4 }, solved: false },
  }

  it('hands the puzzle to the renderer instead of showing a dialog', () => {
    // EventManager.cs:309 opens the window and returns; the event's own
    // buttons do not appear until it is solved.
    const seen: unknown[] = []
    const { session: s } = session(PUZZLE)
    const screen = playScreen({
      session: s,
      sources: SOURCES,
      onPuzzle: (puzzle, chrome, into) => {
        seen.push({ puzzle, moves: chrome.moves })
        into.append(document.createElement('div'))
      },
    })
    document.body.append(screen.element)

    expect(seen).toEqual([{ puzzle: PUZZLE.puzzle, moves: 4 }])
    expect(screen.element.textContent).not.toContain('End investigator turn')
  })

  it('finishes the puzzle by name when it is solved', () => {
    const { session: s, calls } = session(PUZZLE)
    let solved: (() => void) | null = null
    const screen = playScreen({
      session: s,
      sources: SOURCES,
      onPuzzle: (_p, chrome) => {
        solved = chrome.onSolved
      },
    })
    document.body.append(screen.element)
    solved?.()

    expect(calls).toContain('finishPuzzle:PuzzleFrontDoor')
  })

  it('closes without solving, which keeps the board', () => {
    const { session: s, calls } = session(PUZZLE)
    let giveUp: (() => void) | null = null
    const screen = playScreen({
      session: s,
      sources: SOURCES,
      onPuzzle: (_p, chrome) => {
        giveUp = chrome.onGiveUp
      },
    })
    document.body.append(screen.element)
    giveUp?.()

    expect(calls).toContain('closePuzzle')
  })

  it('shows the board with no overlay when no renderer is supplied', () => {
    // A shell that only browses quests should not have to pull the four puzzle
    // screens in.
    const { session: s } = session(PUZZLE)
    const screen = playScreen({ session: s, sources: SOURCES })
    document.body.append(screen.element)

    expect(screen.element.querySelector('canvas')).not.toBeNull()
  })
})
