/**
 * Port of the puzzle logic in `unity/Assets/Scripts/Quest/Puzzle*.cs`.
 *
 * Four puzzle types, each with generation, save/load and a solved check. The
 * window classes that draw them are UI and belong with T-018.
 *
 * Generation is deterministic given the random source, which is injected so a
 * quest's puzzle can be reproduced. `UnityEngine.Random.Range(min, max)` is
 * inclusive-exclusive for the integer overload.
 */

import { parseIntInvariant } from '../config/parse.js'
import { log } from '../ini/logger.js'
import type { ContentFields } from '../content/types.js'

export type RandomRange = (minInclusive: number, maxExclusive: number) => number

export const defaultRandomRange: RandomRange = (min, max) =>
  min + Math.floor(Math.random() * (max - min))

const intOrZero = (value: string | undefined) =>
  value === undefined ? 0 : (parseIntInvariant(value) ?? 0)

const boolOrFalse = (value: string | undefined) =>
  value !== undefined && value.trim().toLowerCase() === 'true'

/**
 * The C# builds these lists by appending `item + separator` and then chopping
 * one character off the end. When the list is empty that chop eats the `=` of
 * the field name instead, so `guess=` is written as `guess`. Reproduced, since
 * saved games in the wild contain it.
 */
function appendTrimmed(prefix: string, items: readonly string[], separator: string): string {
  return `${prefix}${items.map((item) => item + separator).join('')}`.slice(0, -1)
}

/**
 * Common shape: every puzzle serialises to its own ini section.
 *
 * Named `PuzzleState` rather than `Puzzle` because `QuestComponent` already
 * exports a `Puzzle` — the quest section that *configures* one of these.
 */
export interface PuzzleState {
  toSectionString(id: string): string
  solved(): boolean
}

// ---------------------------------------------------------------------------
// Code — the mastermind-style puzzle
// ---------------------------------------------------------------------------

export class CodeAnswer {
  readonly state: number[]

  private constructor(state: number[]) {
    this.state = state
  }

  /** Random answer of `items` positions, each 1..options. */
  static generate(items: number, options: number, random: RandomRange): CodeAnswer {
    const state: number[] = []
    for (let i = 0; i < items; i++) state.push(random(0, options) + 1)
    return new CodeAnswer(state)
  }

  /** Parses a saved answer such as "1 3 5 4". */
  static parse(source: string): CodeAnswer {
    return new CodeAnswer(source.split(' ').map((part) => intOrZero(part)))
  }

  toString(): string {
    return appendTrimmed('', this.state.map(String), ' ')
  }
}

export class CodeGuess {
  readonly guess: number[]

  constructor(
    private readonly answer: CodeAnswer,
    guess: number[] | string,
  ) {
    this.guess = typeof guess === 'string' ? guess.split(' ').map((s) => intOrZero(s)) : guess
  }

  correct(): boolean {
    return this.answer.state.every((value, i) => value === this.guess[i])
  }

  /** How many positions hold the right value. */
  correctSpot(): number {
    return this.answer.state.filter((value, i) => value === this.guess[i]).length
  }

  /**
   * How many values are present but misplaced.
   *
   * Each answer position is consumed at most once, and positions already
   * counted by {@link correctSpot} are excluded from both sides.
   */
  correctType(): number {
    let count = 0
    const used = new Array<boolean>(this.answer.state.length).fill(false)

    for (let i = 0; i < this.guess.length; i++) {
      if (this.guess[i] === this.answer.state[i]) continue
      for (let j = 0; j < this.answer.state.length; j++) {
        if (i === j || used[j]) continue
        if (this.answer.state[j] === this.guess[j]) continue
        if (this.answer.state[j] === this.guess[i]) {
          count++
          used[j] = true
          break
        }
      }
    }
    return count
  }

  toString(): string {
    return appendTrimmed('', this.guess.map(String), ' ')
  }
}

export class PuzzleCode implements PuzzleState {
  answer: CodeAnswer
  readonly guess: CodeGuess[] = []

  private constructor(answer: CodeAnswer) {
    this.answer = answer
  }

  /** A fixed `solution` wins over random generation. */
  static create(items: number, options: number, solution: string, random: RandomRange): PuzzleCode {
    if (solution.length > 0) {
      log(`Setting solution to ${solution}`)
      return new PuzzleCode(CodeAnswer.parse(solution))
    }
    return new PuzzleCode(CodeAnswer.generate(items, options, random))
  }

  static fromSaved(data: ContentFields): PuzzleCode {
    const answerText = data.get('answer')
    const puzzle = new PuzzleCode(CodeAnswer.parse(answerText ?? ''))

    const guesses = data.get('guess')
    if (guesses !== undefined) {
      for (const part of guesses.split(',')) puzzle.guess.push(new CodeGuess(puzzle.answer, part))
    }
    return puzzle
  }

  addGuess(guess: number[]): void {
    this.guess.push(new CodeGuess(this.answer, guess))
  }

  /** Solved when the most recent guess is correct. */
  solved(): boolean {
    const last = this.guess[this.guess.length - 1]
    return last !== undefined && last.correct()
  }

  toSectionString(id: string): string {
    const guesses = appendTrimmed(
      'guess=',
      this.guess.map((g) => g.toString()),
      ',',
    )
    return `[PuzzleCode${id}]\nanswer=${this.answer.toString()}\n${guesses}\n\n`
  }
}

// ---------------------------------------------------------------------------
// Image — the sliding-tile picture puzzle
// ---------------------------------------------------------------------------

export class TilePosition {
  readonly x: number
  readonly y: number

  constructor(x: number | string, y?: number) {
    if (typeof x === 'string') {
      const parts = x.split(' ')
      this.x = intOrZero(parts[0])
      this.y = intOrZero(parts[1])
    } else {
      this.x = x
      this.y = y ?? 0
    }
  }

  get key(): string {
    return `${this.x} ${this.y}`
  }

  toString(): string {
    return `${this.x} ${this.y}`
  }
}

export class PuzzleImage implements PuzzleState {
  /** Board slot -> which piece currently sits there. */
  readonly state = new Map<string, [TilePosition, TilePosition]>()
  moves = 0

  /**
   * Shuffles an `x` by `y` grid.
   *
   * The C# builds the shuffled list by inserting each piece at a random index,
   * which is not a uniform shuffle — reproduced so a given seed matches.
   */
  static generate(x: number, y: number, random: RandomRange): PuzzleImage {
    const puzzle = new PuzzleImage()
    const list: TilePosition[] = []
    for (let i = 0; i < x; i++) {
      for (let j = 0; j < y; j++) {
        list.splice(random(0, list.length), 0, new TilePosition(i, j))
      }
    }

    let count = 0
    for (let i = 0; i < x; i++) {
      for (let j = 0; j < y; j++) {
        const slot = new TilePosition(i, j)
        puzzle.state.set(slot.key, [slot, list[count++]!])
      }
    }
    return puzzle
  }

  static fromSaved(data: ContentFields): PuzzleImage {
    const puzzle = new PuzzleImage()
    puzzle.moves = intOrZero(data.get('moves'))

    const state = data.get('state')
    if (state !== undefined) {
      for (const pair of state.split(':')) {
        const [slot, piece] = pair.split(',')
        const key = new TilePosition(slot ?? '')
        puzzle.state.set(key.key, [key, new TilePosition(piece ?? '')])
      }
    }
    return puzzle
  }

  /**
   * Swaps the pieces in two slots.
   *
   * The C# does this inside a drag handler, mixing pointer arithmetic with the
   * state change (`PuzzleImageWindow.cs:318`). Separating it is what lets the
   * move be made from a keyboard as well as a mouse, and be tested at all.
   *
   * Returns false when either slot is not on the board, so a caller cannot
   * silently count a move that did not happen.
   */
  swap(a: TilePosition, b: TilePosition): boolean {
    const from = this.state.get(a.key)
    const to = this.state.get(b.key)
    if (from === undefined || to === undefined) return false
    if (a.key === b.key) return false

    this.state.set(a.key, [from[0], to[1]])
    this.state.set(b.key, [to[0], from[1]])
    this.moves++
    return true
  }

  solved(): boolean {
    for (const [slot, piece] of this.state.values()) {
      if (slot.x !== piece.x || slot.y !== piece.y) return false
    }
    return true
  }

  toSectionString(id: string): string {
    const pairs = appendTrimmed(
      'state=',
      [...this.state.values()].map(([slot, piece]) => `${slot.toString()},${piece.toString()}`),
      ':',
    )
    return `[PuzzleImage${id}]\nmoves=${this.moves}\n${pairs}\n\n`
  }
}

// ---------------------------------------------------------------------------
// Slide — the "rush hour" block puzzle
// ---------------------------------------------------------------------------

export class SlideBlock {
  rotation = false
  xlen = 1
  ylen = 0
  xpos = 0
  ypos = 2
  target = true

  /** Parses a saved block: `rotation,xlen,ylen,xpos,ypos,target`. */
  static parse(data: string): SlideBlock {
    const block = new SlideBlock()
    const parts = data.split(',')
    block.rotation = boolOrFalse(parts[0])
    block.xlen = intOrZero(parts[1])
    block.ylen = intOrZero(parts[2])
    block.xpos = intOrZero(parts[3])
    block.ypos = intOrZero(parts[4])
    block.target = boolOrFalse(parts[5])
    return block
  }

  clone(): SlideBlock {
    const block = new SlideBlock()
    block.rotation = this.rotation
    block.xlen = this.xlen
    block.ylen = this.ylen
    block.xpos = this.xpos
    block.ypos = this.ypos
    block.target = this.target
    return block
  }

  /** Whether this block covers the given square. */
  blocksSquare(x: number, y: number): boolean {
    if (y < this.ypos) return false
    if (x < this.xpos) return false
    if (y > this.ypos + this.ylen) return false
    if (x > this.xpos + this.xlen) return false
    return true
  }

  /** Whether this block overlaps another. */
  blocksBlock(other: SlideBlock): boolean {
    if (other.ypos + other.ylen < this.ypos) return false
    if (other.xpos + other.xlen < this.xpos) return false
    if (other.ypos > this.ypos + this.ylen) return false
    if (other.xpos > this.xpos + this.xlen) return false
    return true
  }

  blocksAny(blocks: readonly SlideBlock[]): boolean {
    return blocks.some((b) => this.blocksBlock(b))
  }

  /** The square this block would occupy after moving `distance` in `dir`. */
  getMove(dir: number, distance = 1): { x: number; y: number } {
    const result = { x: this.xpos, y: this.ypos }
    if (dir > 0) {
      if (this.rotation) result.y += this.ylen + distance
      else result.x += this.xlen + distance
    } else {
      if (this.rotation) result.y -= distance
      else result.x -= distance
    }
    return result
  }

  toString(): string {
    // C# bool.ToString() is "True"/"False".
    const bool = (v: boolean) => (v ? 'True' : 'False')
    return `${bool(this.rotation)},${this.xlen},${this.ylen},${this.xpos},${this.ypos},${bool(this.target)}`
  }
}

/** The slide puzzle is played on a six-by-six board. */
const SLIDE_BOARD = 6

export class PuzzleSlide implements PuzzleState {
  puzzle: SlideBlock[] = []
  moves = 0

  static fromSaved(data: ContentFields): PuzzleSlide {
    const puzzle = new PuzzleSlide()
    for (const [key, value] of data) {
      if (key === 'moves') puzzle.moves = intOrZero(value)
      else puzzle.puzzle.push(SlideBlock.parse(value))
    }
    return puzzle
  }

  /** The target block escapes at x = 6. */
  /**
   * Moves a block along its own axis.
   *
   * A block slides only the way it is laid: `rotation` false is horizontal.
   * The C# works this out from pointer position inside a drag handler
   * (`PuzzleSlideWindow.cs:313`) and clamps against the other blocks as it
   * goes; here the legality is one question with one answer, which is what
   * makes it testable and reachable from a keyboard.
   *
   * Returns false when the move is blocked or off its axis, so a caller cannot
   * count a move that did not happen.
   */
  moveBlock(index: number, x: number, y: number): boolean {
    const block = this.puzzle[index]
    if (block === undefined) return false
    if (block.xpos === x && block.ypos === y) return false

    // Off-axis moves are not merely illegal, they are not what a block does.
    if (block.rotation ? x !== block.xpos : y !== block.ypos) return false

    const moved = block.clone()
    moved.xpos = x
    moved.ypos = y

    // The board is six squares wide; the exit lane is the one square a target
    // block may occupy beyond it.
    const width = moved.rotation ? 1 : moved.xlen
    const height = moved.rotation ? moved.ylen : 1
    if (moved.xpos < 0 || moved.ypos < 0) return false
    if (moved.ypos + height > SLIDE_BOARD) return false
    if (moved.xpos + width > SLIDE_BOARD && !moved.target) return false

    for (const [other, candidate] of this.puzzle.entries()) {
      if (other === index) continue
      if (candidate.blocksBlock(moved)) return false
    }

    block.xpos = x
    block.ypos = y
    this.moves++
    return true
  }

  solved(): boolean {
    return this.puzzle[0]?.xpos === 6
  }

  /**
   * Whether a square is free.
   *
   * The board is 6x6 with an exit lane at y = 2 extending to x = 7.
   */
  static empty(state: readonly SlideBlock[], x: number, y: number): boolean {
    if (x < 0 || y < 0 || y > 5) return false
    if (x > 5 && y !== 2) return false
    if (x > 7) return false
    return !state.some((b) => b.blocksSquare(x, y))
  }

  toSectionString(id: string): string {
    let result = `[PuzzleSlide${id}]\nmoves=${this.moves}\n`
    this.puzzle.forEach((block, i) => {
      result += `block${i}=${block.toString()}\n`
    })
    return `${result}\n`
  }

  /** The fallback board used when no generated puzzle is available. */
  static hardCodedPuzzle(): Map<string, string> {
    return new Map([
      ['moves', '0'],
      ['block0', 'False,1,0,0,2,True'],
      ['block1', 'False,2,0,0,1,False'],
      ['block2', 'True,0,1,5,0,False'],
      ['block3', 'True,0,1,4,1,False'],
      ['block4', 'False,3,0,0,5,False'],
      ['block5', 'False,2,0,0,4,False'],
      ['block6', 'False,1,0,2,0,False'],
      ['block7', 'False,4,0,0,3,False'],
      ['block8', 'True,0,1,5,2,False'],
      ['block9', 'False,1,0,4,4,False'],
    ])
  }
}

// ---------------------------------------------------------------------------
// Tower — Hanoi
// ---------------------------------------------------------------------------

export class PuzzleTower implements PuzzleState {
  puzzle: number[][] = []
  moves = 0

  /**
   * Generates a board `depth` legal moves away from solved, by breadth-first
   * search backwards from the finished state.
   */
  static generate(depth: number, random: RandomRange): PuzzleTower {
    const options = PuzzleTower.buildPuzzles(depth)
    const chosen = options[random(0, options.length)]!.map((tower) => [...tower])

    const puzzle = new PuzzleTower()
    // The three towers are drawn in a random order.
    let pos = random(0, 3)
    puzzle.puzzle.push(chosen[pos]!)
    chosen.splice(pos, 1)
    pos = random(0, 2)
    puzzle.puzzle.push(chosen[pos]!)
    chosen.splice(pos, 1)
    puzzle.puzzle.push(chosen[0]!)
    return puzzle
  }

  /** Keys are tower indices, so `0=7 6 5` fills the first tower. */
  static fromSaved(data: ContentFields): PuzzleTower {
    const puzzle = new PuzzleTower()
    puzzle.puzzle = [[], [], []]

    for (const [key, value] of data) {
      if (key === 'moves') {
        puzzle.moves = intOrZero(value)
        continue
      }
      const tower = intOrZero(key)
      const target = puzzle.puzzle[tower]
      if (target === undefined) continue
      for (const part of value.split(' ').filter((s) => s.length > 0)) {
        target.push(intOrZero(part))
      }
    }
    return puzzle
  }

  /**
   * Solved when every tower is either empty or holds all eight discs in
   * descending order — so a partially stacked tower fails.
   */
  solved(): boolean {
    for (const tower of this.puzzle) {
      if (tower.length > 0 && tower.length < 8) return false
      let lastSize = 10
      for (const size of tower) {
        if (size > lastSize) return false
        lastSize = size
      }
    }
    return true
  }

  /** Whether moving the top disc of `fromTower` onto `toTower` is legal. */
  static moveOK(fromTower: number, toTower: number, p: readonly number[][]): boolean {
    if (p.length <= fromTower || fromTower < 0) return false
    const from = p[fromTower]!
    if (from.length === 0) return false
    if (p.length <= toTower || toTower < 0) return false
    const to = p[toTower]!
    if (to.length === 0) return true
    return from[from.length - 1]! < to[to.length - 1]!
  }

  moveOK(fromTower: number, toTower: number): boolean {
    return PuzzleTower.moveOK(fromTower, toTower, this.puzzle)
  }

  /** Performs a move if it is legal, otherwise does nothing. */
  move(fromTower: number, toTower: number): void {
    if (!this.moveOK(fromTower, toTower)) return
    const from = this.puzzle[fromTower]!
    this.puzzle[toTower]!.push(from[from.length - 1]!)
    from.pop()
  }

  /** Every distinct state reachable in exactly `depth` reverse moves. */
  static buildPuzzles(depth: number): number[][][] {
    const end: number[][] = [[], [], []]
    for (let i = 0; i < 8; i++) end[0]!.push(7 - i)

    const allStates: number[][][][] = [[end]]

    for (let level = 0; level < depth; level++) {
      allStates.push([])
      for (const state of allStates[level]!) PuzzleTower.addStates(state, allStates, level)
    }
    return allStates[depth]!
  }

  private static addStates(state: number[][], allStates: number[][][][], level: number): void {
    for (let i = 0; i < state.length; i++) {
      if (!PuzzleTower.reverseMoveOK(i, state)) continue

      for (let j = 0; j < state.length; j++) {
        if (j === i) continue

        const newState = state.map((tower) => [...tower])
        newState[j]!.push(state[i]![state[i]!.length - 1]!)
        newState[i]!.pop()

        // Only keep a state not already reachable in this or fewer moves.
        let unique = true
        for (const seen of allStates) {
          for (const other of seen) {
            if (PuzzleTower.sameState(other, newState)) {
              unique = false
              break
            }
          }
          if (!unique) break
        }
        if (unique) allStates[level + 1]!.push(newState)
      }
    }
  }

  /**
   * Whether the top disc of `fromTower` could legally have arrived there.
   *
   * A single disc always could; otherwise it must be smaller than the one
   * beneath it.
   */
  static reverseMoveOK(fromTower: number, p: readonly number[][]): boolean {
    if (p.length <= fromTower || fromTower < 0) return false
    const from = p[fromTower]!
    if (from.length === 0) return false
    if (from.length === 1) return true
    return from[from.length - 1]! < from[from.length - 2]!
  }

  private static sameState(a: number[][], b: number[][]): boolean {
    if (a.length !== b.length) return false
    return a.every((tower, i) => {
      const other = b[i]!
      return tower.length === other.length && tower.every((v, j) => v === other[j])
    })
  }

  toSectionString(id: string): string {
    let result = `[PuzzleTower${id}]\nmoves=${this.moves}\n`
    this.puzzle.forEach((tower, i) => {
      result += `${appendTrimmed(`${i}=`, tower.map(String), ' ')}\n`
    })
    return `${result}\n`
  }
}
