/**
 * Turning a puzzle the session is holding into the view its screen reads.
 *
 * `EventManager.cs:309` opens a window for the event's `class` and returns;
 * the event's buttons only appear once the puzzle is solved. The four screens
 * are already ported — this is the part that was missing, the bridge between
 * the state the session generates and what each screen expects.
 *
 * It lives in the app rather than in `@valkyrie/ui` because it has to reach
 * the quest's components for the puzzle's declared difficulty, which the
 * screens know nothing about.
 */

import {
  PuzzleCode,
  PuzzleImage,
  PuzzleSlide,
  PuzzleTower,
  Puzzle as QuestPuzzle,
  SLIDE_BOARD,
  TilePosition,
} from '@valkyrie/core'
import type { QuestComponent } from '@valkyrie/core'
import { codePuzzle, imagePuzzle, slidePuzzle, towerPuzzle } from '@valkyrie/ui'

/** What `playScreen` hands a puzzle renderer. */
export interface PuzzleRequest {
  name: string
  kind: string
  state: unknown
  solved: boolean
}

export interface PuzzleChromeRequest {
  moves: number
  solved: boolean
  onSolved: () => void
  onGiveUp: () => void
}

export interface PuzzleViewOptions {
  components: ReadonlyMap<string, QuestComponent>
}

/**
 * Builds the `onPuzzle` handler `playScreen` takes.
 *
 * The screens are rebuilt on every draw rather than kept: a move mutates the
 * state in place and asks for a refresh, which is the same shape the C# gets
 * from destroying and reconstructing its window.
 */
export function puzzleRenderer(options: PuzzleViewOptions) {
  return (
    puzzle: PuzzleRequest,
    chrome: PuzzleChromeRequest,
    into: HTMLElement,
    refresh: () => void,
  ): void => {
    // Both handlers go in: a solved puzzle offers the event's button and an
    // unsolved one offers the way out, and the screens' shared chrome is what
    // chooses between them.
    const state = {
      moves: chrome.moves,
      solved: chrome.solved,
      onSolved: chrome.onSolved,
      onGiveUp: chrome.onGiveUp,
    }

    // `puzzleLevel` and `puzzleAltLevel` are the size and difficulty a screen
    // draws itself at, and only the component carries them. The session builds
    // a puzzle from the same component, so this is present whenever a puzzle
    // is — drawing nothing beats drawing an empty board of the wrong size.
    const component = options.components.get(puzzle.name)
    if (!(component instanceof QuestPuzzle)) return
    const declared = component

    if (puzzle.kind === 'code' && puzzle.state instanceof PuzzleCode) {
      const code = puzzle.state
      const screen = codePuzzle()
      screen.show(
        {
          length: code.answer.state.length,
          // `puzzlealtlevel` is how many different symbols a guess draws from;
          // the answer itself does not record it.
          options: declared.puzzleAltLevel,
          guesses: code.guess.map((guess) => ({
            values: guess.guess,
            correctSpot: guess.correctSpot(),
            correctType: guess.correctType(),
          })),
          onGuess: (values) => {
            code.addGuess(values)
            refresh()
          },
        },
        state,
      )
      into.append(screen.element)
      return
    }

    if (puzzle.kind === 'image' && puzzle.state instanceof PuzzleImage) {
      const image = puzzle.state
      const screen = imagePuzzle()
      screen.show(
        {
          width: declared.puzzleLevel,
          height: declared.puzzleAltLevel,
          pieces: [...image.state.values()].map(([slot, piece]) => ({
            slot: { x: slot.x, y: slot.y },
            piece: { x: piece.x, y: piece.y },
          })),
          onSwap: (a, b) => {
            image.swap(new TilePosition(a.x, a.y), new TilePosition(b.x, b.y))
            refresh()
          },
        },
        state,
      )
      into.append(screen.element)
      return
    }

    if (puzzle.kind === 'slide' && puzzle.state instanceof PuzzleSlide) {
      const slide = puzzle.state
      const screen = slidePuzzle()
      screen.show(
        {
          size: SLIDE_BOARD,
          blocks: slide.puzzle.map((block, index) => ({
            index,
            x: block.xpos,
            y: block.ypos,
            width: block.rotation ? 1 : block.xlen,
            height: block.rotation ? block.ylen : 1,
            target: block.target,
            moves: slide.destinations(index),
          })),
          onMove: (index, x, y) => {
            slide.moveBlock(index, x, y)
            refresh()
          },
        },
        state,
      )
      into.append(screen.element)
      return
    }

    if (puzzle.kind === 'tower' && puzzle.state instanceof PuzzleTower) {
      const tower = puzzle.state
      const screen = towerPuzzle()
      screen.show(
        {
          towers: tower.puzzle.map((discs) => [...discs]),
          canMove: (from, to) => tower.moveOK(from, to),
          onMove: (from, to) => {
            tower.move(from, to)
            refresh()
          },
        },
        state,
      )
      into.append(screen.element)
    }
  }
}
