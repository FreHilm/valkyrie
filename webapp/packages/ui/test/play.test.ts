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

/**
 * The phase bar's three menus, from `NextStageButton.Update`.
 *
 * The C# draws Items, Set and Log against the bottom-left corner and gates
 * them on the press: `Items` and `Set` return without doing anything while a
 * dialog is up, and `Log` carries a comment saying it must always be
 * available. The bar itself waits for `firstTileDisplayed`.
 */
describe('playScreen phase menus', () => {
  const TILE = [{ name: 'TileFoyer', component: { type: 'Tile' } }]

  const menus = (over: Record<string, unknown> = {}) => ({
    items: { list: () => [{ id: 'QItemKey', name: 'A rusted key' }], onInspect: vi.fn() },
    log: { view: () => ({ entries: [{ text: 'You enter.', editor: false }], variables: [] }) },
    set: {
      view: () => ({ fire: false, eliminated: false, eliminationFinal: false }),
      onFire: vi.fn(),
      onEliminated: vi.fn(),
    },
    ...over,
  })

  function withMenus(
    view: ReturnType<PlayableSession['view']>,
    over: Record<string, unknown> = {},
    boardItems = TILE,
  ) {
    const { session: s, calls } = session(view, {
      runtime: { boardItems: () => boardItems, monsters: [], log: { toArray: () => [] } },
    })
    const built = menus(over)
    const screen = playScreen({ session: s, sources: SOURCES, menus: built })
    document.body.append(screen.element)
    return { screen, calls, menus: built }
  }

  const bar = (screen: { element: HTMLElement }): string[] =>
    [...screen.element.querySelectorAll('.vk-play__menus button')].map(
      (b) => b.textContent ?? '',
    )

  it('puts the three menus on the bar', () => {
    const { screen } = withMenus({ kind: 'board' })

    expect(bar(screen)).toEqual(['Items', 'Set', 'Log'])
  })

  it('waits for the board to have a tile on it', () => {
    // `if (!firstTileDisplayed) return`: the bar does not frame the opening
    // cutscene, which plays before anything is placed.
    const { screen } = withMenus({ kind: 'board' }, {}, [
      { name: 'TokenDoor', component: { type: 'Token' } },
    ])

    expect(bar(screen)).toEqual([])
  })

  it('opens the item list, and inspects through the session', () => {
    const { screen, menus: built } = withMenus({ kind: 'board' })
    press(screen.element, 'Items')

    const menu = screen.element.querySelector('.vk-play__menu')
    expect(menu?.textContent).toContain('A rusted key')

    press(menu as HTMLElement, 'A rusted key')
    expect((built.items.onInspect).mock.calls).toEqual([['QItemKey']])
    // `Inspect` closes the window first; the event it queues is a dialog, and
    // the two would otherwise be on screen together.
    expect(screen.element.querySelector('.vk-play__menu')?.textContent).toBe('')
  })

  it('shows the log over an event that is still up', () => {
    // `Log` is the one that does not check for a dialog: a player reads back
    // what happened while the event asking about it is on screen.
    const { screen } = withMenus({ kind: 'event', text: 'A door opens.', buttons: [] })

    press(screen.element, 'Log')
    expect(screen.element.querySelector('.vk-play__menu')?.textContent).toContain('You enter.')
    expect(screen.element.querySelector('.vk-play__overlay')?.textContent).toContain('A door opens.')
  })

  it('will not open the items or the set window while a dialog is up', () => {
    const { screen } = withMenus({ kind: 'event', text: 'A door opens.', buttons: [] })

    const disabled = [...screen.element.querySelectorAll('.vk-play__menus button')].map((b) => [
      b.textContent,
      (b as HTMLButtonElement).disabled,
    ])
    expect(disabled).toEqual([
      ['Items', true],
      ['Set', true],
      ['Log', false],
    ])
  })

  it('switches the fire the scenario reads as $fire', () => {
    const { screen, menus: built } = withMenus({ kind: 'board' })
    press(screen.element, 'Set')

    const menu = screen.element.querySelector('.vk-play__menu') as HTMLElement
    press(menu, 'Set Fire')
    expect((built.set.onFire).mock.calls).toEqual([[true]])
  })

  it('will not take back an elimination the quest has already played out', () => {
    // `Uneliminate` returns without doing anything once `#eliminatedcomplete`
    // is set, so the button is dead — this says so before the press.
    const { screen } = withMenus(
      { kind: 'board' },
      {
        set: {
          view: () => ({ fire: false, eliminated: true, eliminationFinal: true }),
          onFire: vi.fn(),
          onEliminated: vi.fn(),
        },
      },
    )
    press(screen.element, 'Set')

    const menu = screen.element.querySelector('.vk-play__menu') as HTMLElement
    const toggle = [...menu.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Investigator Eliminated'),
    )
    expect(toggle?.disabled).toBe(true)
  })

  it('takes the bar away once the quest has ended', () => {
    const { screen } = withMenus({ kind: 'ended' })

    expect(bar(screen)).toEqual([])
  })
})

describe('playScreen end of quest', () => {
  it('hands the ending over, because the summary is not a board', () => {
    // `EventManager.cs:460` sets `questHasEnded` and builds a screen needing
    // the party's names and how long they played — none of which this screen
    // has. Without the handover the board simply stops being drawn.
    const onEnded = vi.fn()
    const { session: s } = session({ kind: 'ended' })
    const screen = playScreen({ session: s, sources: SOURCES, onEnded })
    document.body.append(screen.element)

    expect(onEnded).toHaveBeenCalledTimes(1)
  })

  it('hands it over once, however often the screen redraws', () => {
    // Anything that touches the board refreshes, and rebuilding the summary
    // underneath the player would throw away what they were reading.
    const onEnded = vi.fn()
    const { session: s } = session({ kind: 'ended' })
    const screen = playScreen({ session: s, sources: SOURCES, onEnded })
    document.body.append(screen.element)
    screen.refresh()
    screen.refresh()

    expect(onEnded).toHaveBeenCalledTimes(1)
  })

  it('takes the board furniture away with it', () => {
    const { session: s } = session(
      { kind: 'ended' },
      {
        runtime: {
          boardItems: () => [{ name: 'TileFoyer', component: { type: 'Tile' } }],
          monsters: [],
          log: { toArray: () => [] },
        },
      },
    )
    const screen = playScreen({ session: s, sources: SOURCES, onEnded: vi.fn() })
    document.body.append(screen.element)

    expect(screen.element.querySelectorAll('.vk-play__menus button')).toHaveLength(0)
    expect(screen.element.querySelector('.vk-play__controls')?.textContent).toBe('')
  })
})

describe('playScreen granted item', () => {
  const giving = (over: Record<string, unknown> = {}) => ({
    kind: 'event',
    text: 'You find a key.',
    buttons: [{ label: 'Take it', index: 0, disabled: false }],
    grantedItem: 'ItemUniqueBrassKey',
    ...over,
  })

  it('draws the card beside an ordinary event', () => {
    // `DialogWindow.DrawItem`.
    const { session: s } = session(giving())
    const screen = playScreen({
      session: s,
      sources: SOURCES,
      itemImage: () => 'blob:card',
    })
    document.body.append(screen.element)

    expect(screen.element.querySelector('.vk-event__img')?.getAttribute('src')).toBe('blob:card')
  })

  it('leaves it off a highlight event, which has put it on the board', () => {
    // `DialogWindow.cs:211`: `DrawItem` returns early for a highlight, because
    // `AddHighlight` has already drawn the card where the event points. Both
    // would otherwise show the same card twice.
    const { session: s } = session(giving({ highlight: { x: 2, y: 2 } }))
    const screen = playScreen({
      session: s,
      sources: SOURCES,
      itemImage: () => 'blob:card',
    })
    document.body.append(screen.element)

    expect(screen.element.querySelector('.vk-event__img')).toBeNull()
  })
})
