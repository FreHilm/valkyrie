/**
 * @vitest-environment happy-dom
 *
 * Tests for the four puzzle screens (T-018).
 *
 * Each C# window reads the mouse directly — `PuzzleSlideWindow` works out a
 * move from pointer position, `PuzzleImageWindow` from drag distance — so a
 * puzzle can only be played by dragging, and none of them can be tested. These
 * are buttons, which is what makes both possible.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { codePuzzle, imagePuzzle, slidePuzzle, towerPuzzle } from '../src/screens/puzzles.js'

beforeEach(() => {
  document.body.replaceChildren()
})

const buttons = (root: HTMLElement): HTMLButtonElement[] => [...root.querySelectorAll('button')]
const byText = (root: HTMLElement, text: string): HTMLButtonElement => {
  const found = buttons(root).find((b) => b.textContent === text)
  if (found === undefined) throw new Error(`no button "${text}"`)
  return found
}

describe('codePuzzle', () => {
  const view = (onGuess = vi.fn()) => ({
    length: 3,
    options: 4,
    guesses: [{ values: [1, 2, 3], correctSpot: 1, correctType: 1 }],
    onGuess,
  })

  it('lists past guesses with what each scored', () => {
    // Reading them is the whole game.
    const puzzle = codePuzzle()
    document.body.append(puzzle.element)
    puzzle.show(view(), { moves: 1, solved: false })

    expect(puzzle.element.textContent).toContain('1 2 3')
    expect(puzzle.element.textContent).toContain('1 right place')
    expect(puzzle.element.textContent).toContain('1 right symbol')
  })

  it('cycles a symbol through the options and wraps', () => {
    const puzzle = codePuzzle()
    document.body.append(puzzle.element)
    puzzle.show(view(), { moves: 0, solved: false })

    const first = buttons(puzzle.element)[0]
    expect(first?.textContent).toBe('1')
    first?.click()
    expect(buttons(puzzle.element)[0]?.textContent).toBe('2')
    for (let i = 0; i < 3; i++) buttons(puzzle.element)[0]?.click()
    // 1 -> 2 -> 3 -> 4 -> 1
    expect(buttons(puzzle.element)[0]?.textContent).toBe('1')
  })

  it('submits the guess that is on screen', () => {
    const onGuess = vi.fn()
    const puzzle = codePuzzle()
    document.body.append(puzzle.element)
    puzzle.show(view(onGuess), { moves: 0, solved: false })

    buttons(puzzle.element)[1]?.click()
    byText(puzzle.element, 'Guess').click()

    expect(onGuess).toHaveBeenCalledWith([1, 2, 1])
  })

  it('stops offering guesses once it is solved', () => {
    const puzzle = codePuzzle()
    document.body.append(puzzle.element)
    puzzle.show(view(), { moves: 4, solved: true })

    expect(buttons(puzzle.element).map((b) => b.textContent)).not.toContain('Guess')
    expect(puzzle.element.textContent).toContain('Solved')
  })

  it('offers a way out while it is unsolved', () => {
    const onGiveUp = vi.fn()
    const puzzle = codePuzzle()
    document.body.append(puzzle.element)
    puzzle.show(view(), { moves: 2, solved: false, onGiveUp })
    byText(puzzle.element, 'Give up').click()

    expect(onGiveUp).toHaveBeenCalledOnce()
  })
})

describe('imagePuzzle', () => {
  const view = (onSwap = vi.fn()) => ({
    width: 2,
    height: 1,
    pieces: [
      { slot: { x: 0, y: 0 }, piece: { x: 1, y: 0 } },
      { slot: { x: 1, y: 0 }, piece: { x: 0, y: 0 } },
    ],
    onSwap,
  })

  it('swaps on two taps rather than a drag', () => {
    // The C# reads drag distance, which no keyboard can produce.
    const onSwap = vi.fn()
    const puzzle = imagePuzzle()
    document.body.append(puzzle.element)
    puzzle.show(view(onSwap), { moves: 0, solved: false })

    buttons(puzzle.element)[0]?.click()
    buttons(puzzle.element)[1]?.click()

    expect(onSwap).toHaveBeenCalledWith({ x: 0, y: 0 }, { x: 1, y: 0 })
  })

  it('announces which tile is picked up', () => {
    const puzzle = imagePuzzle()
    document.body.append(puzzle.element)
    puzzle.show(view(), { moves: 0, solved: false })
    buttons(puzzle.element)[0]?.click()

    expect(buttons(puzzle.element)[0]?.getAttribute('aria-pressed')).toBe('true')
    expect(buttons(puzzle.element)[1]?.getAttribute('aria-pressed')).toBe('false')
  })

  it('freezes once solved', () => {
    const puzzle = imagePuzzle()
    document.body.append(puzzle.element)
    puzzle.show(view(), { moves: 9, solved: true })

    expect(buttons(puzzle.element).every((b) => b.disabled || b.textContent === 'Give up')).toBe(
      true,
    )
  })
})

describe('slidePuzzle', () => {
  const view = (onMove = vi.fn()) => ({
    size: 6,
    blocks: [
      {
        index: 0,
        x: 0,
        y: 2,
        width: 2,
        height: 1,
        target: true,
        moves: [
          { x: 1, y: 2 },
          { x: 2, y: 2 },
        ],
      },
      { index: 1, x: 4, y: 0, width: 1, height: 2, target: false, moves: [] },
    ],
    onMove,
  })

  it('lists a block’s legal destinations rather than asking for a drag', () => {
    const puzzle = slidePuzzle()
    document.body.append(puzzle.element)
    puzzle.show(view(), { moves: 0, solved: false })

    buttons(puzzle.element)[0]?.click()

    expect(buttons(puzzle.element).map((b) => b.textContent)).toContain('1,2')
    expect(buttons(puzzle.element).map((b) => b.textContent)).toContain('2,2')
  })

  it('moves to the destination that was chosen', () => {
    const onMove = vi.fn()
    const puzzle = slidePuzzle()
    document.body.append(puzzle.element)
    puzzle.show(view(onMove), { moves: 0, solved: false })

    buttons(puzzle.element)[0]?.click()
    byText(puzzle.element, '2,2').click()

    expect(onMove).toHaveBeenCalledWith(0, 2, 2)
  })

  it('does not offer a block that cannot move', () => {
    const puzzle = slidePuzzle()
    document.body.append(puzzle.element)
    puzzle.show(view(), { moves: 0, solved: false })

    expect(buttons(puzzle.element)[1]?.disabled).toBe(true)
  })

  it('deselects a block picked twice', () => {
    const puzzle = slidePuzzle()
    document.body.append(puzzle.element)
    puzzle.show(view(), { moves: 0, solved: false })

    buttons(puzzle.element)[0]?.click()
    buttons(puzzle.element)[0]?.click()

    expect(buttons(puzzle.element).map((b) => b.textContent)).not.toContain('1,2')
  })
})

describe('towerPuzzle', () => {
  const view = (onMove = vi.fn(), canMove = () => true) => ({
    towers: [[3, 2, 1], [], []],
    canMove,
    onMove,
  })

  it('moves between towers, not between discs', () => {
    // Only the top disc can move, so asking which disc is a question with one
    // answer.
    const onMove = vi.fn()
    const puzzle = towerPuzzle()
    document.body.append(puzzle.element)
    puzzle.show(view(onMove), { moves: 0, solved: false })

    byText(puzzle.element, 'Take from').click()
    buttons(puzzle.element)[1]?.click()

    expect(onMove).toHaveBeenCalledWith(0, 1)
  })

  it('will not take from an empty tower', () => {
    const puzzle = towerPuzzle()
    document.body.append(puzzle.element)
    puzzle.show(view(), { moves: 0, solved: false })

    expect(buttons(puzzle.element)[1]?.disabled).toBe(true)
  })

  it('refuses a destination the puzzle rejects', () => {
    const onMove = vi.fn()
    const puzzle = towerPuzzle()
    document.body.append(puzzle.element)
    puzzle.show(
      view(onMove, () => false),
      { moves: 0, solved: false },
    )

    buttons(puzzle.element)[0]?.click()
    // Illegal destinations are not offered at all.
    expect(buttons(puzzle.element)[1]?.disabled).toBe(true)
  })

  it('shows the discs on each tower', () => {
    const puzzle = towerPuzzle()
    document.body.append(puzzle.element)
    puzzle.show(view(), { moves: 0, solved: false })

    expect(puzzle.element.textContent).toContain('3')
    expect(puzzle.element.textContent).toContain('1')
  })
})
