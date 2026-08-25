/**
 * The four puzzle screens.
 *
 * Each C# window builds itself in a constructor and reads the mouse directly,
 * so a puzzle can only be played by dragging: `PuzzleSlideWindow` works out a
 * move from pointer position, and `PuzzleImageWindow` from drag distance.
 * These are buttons and a grid instead, so the puzzles can be played from a
 * keyboard and asserted in a test — the logic underneath is the ported one,
 * verified against the C#.
 */

import { button, label, panel } from '../components.js'
import { clear, el } from '../dom.js'
import { rawText } from '../text.js'
import type { Text } from '../text.js'

export interface PuzzleChrome {
  /** Moves taken so far, shown as the C# does. */
  moves: number
  solved: boolean
  /** `PuzzleData.skill`: what the investigators roll to give up. */
  onGiveUp?: () => void
  onSolved?: () => void
}

export interface PuzzleStrings {
  moves: Text
  solved: Text
  giveUp: Text
  finish: Text
  guess: Text
  correctSpot: Text
  correctType: Text
  select: Text
  towerFrom: Text
  towerTo: Text
}

const DEFAULT_STRINGS: PuzzleStrings = {
  moves: rawText('Moves'),
  solved: rawText('Solved'),
  giveUp: rawText('Give up'),
  finish: rawText('Finish'),
  guess: rawText('Guess'),
  correctSpot: rawText('right place'),
  correctType: rawText('right symbol'),
  select: rawText('Select'),
  towerFrom: rawText('Take from'),
  towerTo: rawText('Place on'),
}

/** State shared by every puzzle screen. */
interface Common {
  element: HTMLElement
  strings: PuzzleStrings
}

function chrome(host: Common, state: PuzzleChrome): void {
  const bar = el('div', { class: 'vk-puzzle__chrome' })
  bar.append(
    label(rawText(`${textOf(host.strings.moves)}: ${String(state.moves)}`), {
      class: 'vk-puzzle__moves',
    }),
  )
  if (state.solved) {
    bar.append(label(host.strings.solved, { class: 'vk-puzzle__solved' }))
    if (state.onSolved !== undefined) {
      bar.append(button(host.strings.finish, { onPress: state.onSolved, variant: 'primary' }))
    }
  } else if (state.onGiveUp !== undefined) {
    bar.append(button(host.strings.giveUp, { onPress: state.onGiveUp }))
  }
  host.element.append(bar)
}

/* ---- code ------------------------------------------------------------- */

export interface CodePuzzleView {
  /** How many symbols make up a guess. */
  length: number
  /** How many different symbols there are. */
  options: number
  /** Past guesses, newest last, as the C# lists them. */
  guesses: readonly { values: readonly number[]; correctSpot: number; correctType: number }[]
  onGuess: (values: number[]) => void
}

export interface PuzzleScreen {
  element: HTMLElement
  show: (view: never, state: PuzzleChrome) => void
}

export function codePuzzle(strings: Partial<PuzzleStrings> = {}): {
  element: HTMLElement
  show: (view: CodePuzzleView, state: PuzzleChrome) => void
} {
  const merged = { ...DEFAULT_STRINGS, ...strings }
  const element = panel({ class: 'vk-puzzle vk-puzzle--code' })
  let working: number[] = []
  // The guess being built lives outside the view, so cycling a symbol has to
  // redraw from what was last shown.
  let last: { view: CodePuzzleView; state: PuzzleChrome } | null = null

  const render = (): void => {
    if (last === null) return
    const { view, state } = last
    {
      if (working.length !== view.length) working = new Array<number>(view.length).fill(1)
      clear(element)

      // Past guesses first: the whole game is reading them.
      const history = el('ol', { class: 'vk-puzzle__guesses' })
      for (const guess of view.guesses) {
        history.append(
          el('li', {
            text:
              `${guess.values.join(' ')} — ${String(guess.correctSpot)} ${textOf(merged.correctSpot)}, ` +
              `${String(guess.correctType)} ${textOf(merged.correctType)}`,
          }),
        )
      }
      element.append(history)

      if (!state.solved) {
        const row = el('div', { class: 'vk-puzzle__entry', attrs: { role: 'group' } })
        working.forEach((value, index) => {
          const control = button(rawText(String(value)), {
            onPress: () => {
              // One button cycling through the symbols, rather than a picker
              // per symbol: fewer targets, and it works on a phone.
              working[index] = (value % view.options) + 1
              render()
            },
            describedBy: merged.select,
          })
          row.append(control)
        })
        row.append(
          button(merged.guess, {
            onPress: () => view.onGuess([...working]),
            variant: 'primary',
          }),
        )
        element.append(row)
      }

      chrome({ element, strings: merged }, state)
    }
  }

  return {
    element,
    show: (view, state) => {
      last = { view, state }
      render()
    },
  }
}

/* ---- image ------------------------------------------------------------ */

export interface ImagePuzzleView {
  width: number
  height: number
  /** Slot to the piece currently in it. */
  pieces: readonly { slot: { x: number; y: number }; piece: { x: number; y: number } }[]
  onSwap: (a: { x: number; y: number }, b: { x: number; y: number }) => void
}

export function imagePuzzle(strings: Partial<PuzzleStrings> = {}): {
  element: HTMLElement
  show: (view: ImagePuzzleView, state: PuzzleChrome) => void
} {
  const merged = { ...DEFAULT_STRINGS, ...strings }
  const element = panel({ class: 'vk-puzzle vk-puzzle--image' })
  let selected: { x: number; y: number } | null = null

  let last: { view: ImagePuzzleView; state: PuzzleChrome } | null = null

  const render = (): void => {
    if (last === null) return
    const { view, state } = last
    {
      clear(element)
      const grid = el('div', { class: 'vk-puzzle__grid', attrs: { role: 'group' } })
      grid.style.gridTemplateColumns = `repeat(${String(view.width)}, 1fr)`

      for (const { slot, piece } of view.pieces) {
        const isSelected = selected?.x === slot.x && selected.y === slot.y
        const control = button(rawText(`${String(piece.x)},${String(piece.y)}`), {
          onPress: () => {
            // Two taps rather than a drag: the C# reads drag distance, which
            // no keyboard can produce.
            if (selected === null) {
              selected = slot
            } else {
              view.onSwap(selected, slot)
              selected = null
            }
            render()
          },
          class: isSelected ? ['vk-puzzle__tile', 'vk-puzzle__tile--selected'] : 'vk-puzzle__tile',
          disabled: state.solved,
        })
        control.setAttribute('aria-pressed', isSelected ? 'true' : 'false')
        grid.append(control)
      }

      element.append(grid)
      chrome({ element, strings: merged }, state)
    }
  }

  return {
    element,
    show: (view, state) => {
      last = { view, state }
      render()
    },
  }
}

/* ---- slide ------------------------------------------------------------ */

export interface SlidePuzzleView {
  /** Board size in squares. */
  size: number
  blocks: readonly {
    index: number
    x: number
    y: number
    width: number
    height: number
    target: boolean
    /** Where this block could legally go. */
    moves: readonly { x: number; y: number }[]
  }[]
  onMove: (index: number, x: number, y: number) => void
}

export function slidePuzzle(strings: Partial<PuzzleStrings> = {}): {
  element: HTMLElement
  show: (view: SlidePuzzleView, state: PuzzleChrome) => void
} {
  const merged = { ...DEFAULT_STRINGS, ...strings }
  const element = panel({ class: 'vk-puzzle vk-puzzle--slide' })
  let chosen: number | null = null

  let last: { view: SlidePuzzleView; state: PuzzleChrome } | null = null

  const render = (): void => {
    if (last === null) return
    const { view, state } = last
    {
      clear(element)
      const board = el('div', { class: 'vk-puzzle__board', attrs: { role: 'group' } })
      board.style.gridTemplateColumns = `repeat(${String(view.size)}, 1fr)`

      for (const block of view.blocks) {
        const control = button(rawText(block.target ? '★' : '■'), {
          onPress: () => {
            chosen = chosen === block.index ? null : block.index
            render()
          },
          class: block.target
            ? ['vk-puzzle__block', 'vk-puzzle__block--target']
            : 'vk-puzzle__block',
          disabled: state.solved || block.moves.length === 0,
          describedBy: merged.select,
        })
        control.style.gridColumn = `${String(block.x + 1)} / span ${String(block.width)}`
        control.style.gridRow = `${String(block.y + 1)} / span ${String(block.height)}`
        control.setAttribute('aria-pressed', chosen === block.index ? 'true' : 'false')
        board.append(control)
      }
      element.append(board)

      // The legal destinations, listed rather than dragged to.
      const block = view.blocks.find((b) => b.index === chosen)
      if (block !== undefined && !state.solved) {
        const moves = el('div', { class: 'vk-puzzle__moves-row', attrs: { role: 'group' } })
        for (const move of block.moves) {
          moves.append(
            button(rawText(`${String(move.x)},${String(move.y)}`), {
              onPress: () => {
                view.onMove(block.index, move.x, move.y)
                chosen = null
                render()
              },
            }),
          )
        }
        element.append(moves)
      }

      chrome({ element, strings: merged }, state)
    }
  }

  return {
    element,
    show: (view, state) => {
      last = { view, state }
      render()
    },
  }
}

/* ---- tower ------------------------------------------------------------ */

export interface TowerPuzzleView {
  /** Discs on each tower, largest first. */
  towers: readonly (readonly number[])[]
  canMove: (from: number, to: number) => boolean
  onMove: (from: number, to: number) => void
}

export function towerPuzzle(strings: Partial<PuzzleStrings> = {}): {
  element: HTMLElement
  show: (view: TowerPuzzleView, state: PuzzleChrome) => void
} {
  const merged = { ...DEFAULT_STRINGS, ...strings }
  const element = panel({ class: 'vk-puzzle vk-puzzle--tower' })
  let from: number | null = null

  let last: { view: TowerPuzzleView; state: PuzzleChrome } | null = null

  const render = (): void => {
    if (last === null) return
    const { view, state } = last
    {
      clear(element)
      const row = el('div', { class: 'vk-puzzle__towers', attrs: { role: 'group' } })

      view.towers.forEach((discs, index) => {
        const tower = el('div', { class: 'vk-puzzle__tower' })
        for (const disc of discs) {
          const piece = el('div', { class: 'vk-puzzle__disc', text: String(disc) })
          piece.style.width = `${String(20 + disc * 20)}%`
          tower.append(piece)
        }
        // The tower is the target, not the disc: only the top one can move, so
        // asking which disc would be a question with one answer.
        const pick = button(from === null ? merged.towerFrom : merged.towerTo, {
          onPress: () => {
            if (from === null) {
              from = index
            } else {
              if (view.canMove(from, index)) view.onMove(from, index)
              from = null
            }
            render()
          },
          disabled:
            state.solved ||
            (from === null ? discs.length === 0 : from !== index && !view.canMove(from, index)),
        })
        pick.setAttribute('aria-pressed', from === index ? 'true' : 'false')
        tower.append(pick)
        row.append(tower)
      })

      element.append(row)
      chrome({ element, strings: merged }, state)
    }
  }

  return {
    element,
    show: (view, state) => {
      last = { view, state }
      render()
    },
  }
}

function textOf(text: Text): string {
  return text.kind === 'raw' ? text.value : text.key.fullKey
}
