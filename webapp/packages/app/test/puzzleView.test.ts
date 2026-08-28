/**
 * @vitest-environment happy-dom
 *
 * Tests for the puzzle bridge (T-024).
 *
 * The four screens were ported and tested, and the session generates the
 * puzzles — but nothing joined the two, so a scenario reaching a puzzle event
 * showed an empty overlay and could not go on. These cover the join.
 */

import { describe, expect, it, vi } from 'vitest'

import {
  loadQuestSections,
  readFromString,
  PuzzleCode,
  PuzzleImage,
  PuzzleSlide,
  PuzzleTower,
} from '@valkyrie/core'
import { puzzleRenderer } from '../src/puzzleView.js'

const components = (ini: string) => loadQuestSections(readFromString(ini), 'test.ini', {})

const CODE = '[PuzzleLock]\nclass=code\npuzzlelevel=3\npuzzlealtlevel=4\nbuttons=1\nevent1=\n'
const SLIDE = '[PuzzleDoor]\nclass=slide\npuzzlelevel=1\nbuttons=1\nevent1=\n'
const TOWER = '[PuzzleTower]\nclass=tower\npuzzlelevel=3\nbuttons=1\nevent1=\n'
const IMAGE = '[PuzzlePicture]\nclass=image\npuzzlelevel=3\npuzzlealtlevel=2\nbuttons=1\nevent1=\n'

const chrome = (over: Partial<Record<string, unknown>> = {}) => ({
  moves: 0,
  solved: false,
  onSolved: vi.fn(),
  onGiveUp: vi.fn(),
  ...over,
})

/** Deterministic, so a generated puzzle is the same one every run. */
const range = (min: number, max: number): number => min + ((max - min) >> 1)

function render(
  name: string,
  kind: string,
  state: unknown,
  ini: string,
  over: Partial<Record<string, unknown>> = {},
) {
  const into = document.createElement('div')
  const refresh = vi.fn()
  const state_ = chrome(over)
  puzzleRenderer({ components: components(ini) })(
    { name, kind, state, solved: Boolean(state_.solved) },
    state_,
    into,
    refresh,
  )
  return { into, refresh, chrome: state_ }
}

const buttons = (root: HTMLElement) => [...root.querySelectorAll('button')]

describe('puzzleRenderer', () => {
  it('draws a code puzzle and records a guess against the session state', () => {
    const state = PuzzleCode.create(3, 4, '', range)
    const { into, refresh } = render('PuzzleLock', 'code', state, CODE)

    expect(into.querySelector('.vk-puzzle--code')).not.toBeNull()

    // Cycle the first symbol, then guess: the state the session holds is what
    // must change, because that is what decides whether the puzzle is solved.
    const guess = buttons(into).find((b) => b.textContent?.includes('Guess'))
    expect(guess).toBeDefined()
    guess?.click()

    expect(state.guess.length).toBe(1)
    expect(refresh).toHaveBeenCalled()
  })

  it('draws a slide puzzle and moves the block that was chosen', () => {
    const state = PuzzleSlide.fromSaved(PuzzleSlide.hardCodedPuzzle())
    const { into, refresh } = render('PuzzleDoor', 'slide', state, SLIDE)

    expect(into.querySelector('.vk-puzzle--slide')).not.toBeNull()

    const movable = state.puzzle.findIndex((_, i) => state.destinations(i).length > 0)
    expect(movable).toBeGreaterThanOrEqual(0)
    const before = state.moves

    buttons(into)[movable]?.click()
    const destination = buttons(into).find((b) => /^\d+,\d+$/.test(b.textContent ?? ''))
    expect(destination).toBeDefined()
    destination?.click()

    expect(state.moves).toBe(before + 1)
    expect(refresh).toHaveBeenCalled()
  })

  it('draws a tower puzzle and moves a disc', () => {
    const state = PuzzleTower.generate(3, range)
    const { into, refresh } = render('PuzzleTower', 'tower', state, TOWER)

    expect(into.querySelector('.vk-puzzle--tower')).not.toBeNull()
    const before = state.moves

    // A move the state itself calls legal, so the test asserts the wiring
    // rather than rediscovering the rules.
    let from = -1
    let to = -1
    for (let a = 0; a < state.puzzle.length && to < 0; a++) {
      for (let b = 0; b < state.puzzle.length; b++) {
        if (a !== b && state.moveOK(a, b)) {
          from = a
          to = b
          break
        }
      }
    }
    expect(to).toBeGreaterThanOrEqual(0)

    const towers = (): HTMLButtonElement[] => [
      ...into.querySelectorAll<HTMLButtonElement>('.vk-puzzle__tower button'),
    ]
    towers()[from]?.click()
    towers()[to]?.click()

    expect(state.moves).toBe(before + 1)
    expect(refresh).toHaveBeenCalled()
  })

  it('draws an image puzzle', () => {
    const state = PuzzleImage.generate(3, 2, range)
    const { into } = render('PuzzlePicture', 'image', state, IMAGE)

    expect(into.querySelector('.vk-puzzle--image')).not.toBeNull()
  })

  it('offers the way out while unsolved, and the event’s button once solved', () => {
    const state = PuzzleTower.generate(3, range)

    const unsolved = render('PuzzleTower', 'tower', state, TOWER)
    expect(unsolved.into.textContent).toContain('Give up')
    expect(unsolved.into.textContent).not.toContain('Finish')

    const solved = render('PuzzleTower', 'tower', state, TOWER, { solved: true })
    expect(solved.into.textContent).toContain('Finish')
    expect(solved.into.textContent).not.toContain('Give up')
  })

  it('takes the symbol count from the component, not from the answer', () => {
    // `puzzlealtlevel` is how many different symbols a guess draws from, and
    // only the component records it — the generated answer does not. It shows
    // in the cycling: with four symbols the fourth press comes back to 1.
    const cycle = (ini: string, times: number): string | null => {
      const state = PuzzleCode.create(3, 4, '', range)
      const { into } = render('PuzzleLock', 'code', state, ini)
      // Re-queried each press: the screen rebuilds its nodes on every draw.
      for (let i = 0; i < times; i++) buttons(into)[0]?.click()
      return buttons(into)[0]?.textContent ?? null
    }

    expect(cycle(CODE, 4)).toBe('1')
    expect(cycle('[PuzzleLock]\nclass=code\npuzzlelevel=3\npuzzlealtlevel=9\nbuttons=1\nevent1=\n', 4)).toBe('5')
  })

  it('draws nothing for a puzzle whose component is not one', () => {
    // Rather than an empty board of the wrong size. The session only produces
    // a puzzle from a `Puzzle` component, so this is belt and braces.
    const { into } = render('PuzzleLock', 'code', PuzzleCode.create(3, 4, '', range), '')

    expect(into.children.length).toBe(0)
  })

  it('draws nothing when the state does not match the class', () => {
    const { into } = render('PuzzleLock', 'code', PuzzleTower.generate(3, range), CODE)

    expect(into.children.length).toBe(0)
  })
})
