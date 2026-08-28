/**
 * Migrated from `VarManagerTests.cs`, `VarTestsTests.cs`, `PuzzleTests.cs` and
 * `PuzzleCodeTests.cs` (T-009).
 *
 * Equivalence with the C# is established by the differential harness over
 * 3,081 cases.
 */

import { describe, expect, it } from 'vitest'
import { VarManager } from '../src/quest/VarManager.js'
import { VarOperation, VarTests } from '../src/quest/VarTests.js'
import {
  CodeAnswer,
  PuzzleCode,
  PuzzleImage,
  PuzzleSlide,
  PuzzleTower,
  SlideBlock,
  TilePosition,
} from '../src/quest/puzzles.js'
import { slidePuzzleLayouts } from '../src/quest/slidePuzzles.js'

const fields = (o: Record<string, string>) => new Map(Object.entries(o))

/** Replays a fixed sequence, so generation is reproducible. */
const scripted = (values: number[]) => {
  let cursor = 0
  return (min: number, max: number) => {
    const value = cursor < values.length ? values[cursor]! : min
    cursor++
    if (max <= min) return min
    const span = max - min
    return min + (((value % span) + span) % span)
  }
}

const manager = (saved: Record<string, string> = {}, random?: (a: number, b: number) => number) => {
  const notices: string[] = []
  const options = {
    notice: (m: string) => notices.push(m),
    ...(random ? { randomRange: random } : {}),
  }
  const vm = VarManager.fromSaved(fields(saved), options)
  return { vm, notices }
}

const tests = (...parts: string[]) => {
  const result = new VarTests()
  for (const part of parts) result.addFromString(part)
  return result
}

describe('VarManager arithmetic', () => {
  it('assigns, adds, subtracts, multiplies, divides and takes a modulus', () => {
    const { vm } = manager({ $a: '6' })

    vm.perform(new VarOperation('$a,+,3'))
    expect(vm.getValue('$a')).toBe(9)
    vm.perform(new VarOperation('$a,-,4'))
    expect(vm.getValue('$a')).toBe(5)
    vm.perform(new VarOperation('$a,*,3'))
    expect(vm.getValue('$a')).toBe(15)
    vm.perform(new VarOperation('$a,/,5'))
    expect(vm.getValue('$a')).toBe(3)
    vm.perform(new VarOperation('$a,%,2'))
    expect(vm.getValue('$a')).toBe(1)
    vm.perform(new VarOperation('$a,=,42'))
    expect(vm.getValue('$a')).toBe(42)
  })

  it('divides by zero to Infinity rather than throwing', () => {
    const { vm } = manager({ $a: '6' })
    vm.perform(new VarOperation('$a,/,0'))

    expect(vm.getValue('$a')).toBe(Number.POSITIVE_INFINITY)
  })

  it('narrows every result to 32-bit precision', () => {
    // Quest variables are `float` in the C#, so a value that a double would
    // keep exactly is rounded.
    const { vm } = manager({ $a: '7' })
    vm.perform(new VarOperation('$a,/,6'))

    expect(vm.getValue('$a')).toBe(Math.fround(7 / 6))
    expect(vm.toString()).toContain('$a=1.1666666')
  })

  it('ignores an unknown operation', () => {
    const { vm } = manager({ $a: '5' })
    vm.perform(new VarOperation('$a,?,3'))

    expect(vm.getValue('$a')).toBe(5)
  })

  it('treats variables starting with # as read-only', () => {
    const { vm } = manager({ '#x': '5' })
    vm.perform(new VarOperation('#x,=,9'))

    expect(vm.getValue('#x')).toBe(5)
  })

  it('resolves the right-hand side from another variable', () => {
    const { vm } = manager({ $a: '1', $b: '7' })
    vm.perform(new VarOperation('$a,=,$b'))

    expect(vm.getValue('$a')).toBe(7)
  })

  it('creates a referenced variable at zero and says so', () => {
    const { vm, notices } = manager()
    vm.perform(new VarOperation('$a,=,$missing'))

    expect(vm.getValue('$missing')).toBe(0)
    expect(notices).toContain('Notice: Adding quest var: $missing')
  })

  it('draws #rand from the injected source', () => {
    const { vm } = manager({}, scripted([3]))
    vm.perform(new VarOperation('$a,=,#rand6'))

    expect(vm.getValue('$a')).toBe(4)
  })

  it('reads a missing variable as zero without creating it', () => {
    const { vm } = manager()

    expect(vm.getValue('$nope')).toBe(0)
    expect(vm.vars.has('$nope')).toBe(false)
  })

  it('collects variables by prefix', () => {
    const { vm } = manager({ $a: '1', $ab: '2', b: '3' })

    expect([...vm.getPrefixVars('$a').keys()]).toEqual(['$a', '$ab'])
  })
})

describe('VarManager persistence', () => {
  it('unescapes a name starting with #', () => {
    const { vm } = manager({ '\\#x': '5' })

    expect(vm.getValue('#x')).toBe(5)
  })

  it('escapes it again on the way out, and skips zero values', () => {
    const { vm } = manager({ '\\#x': '5', $zero: '0', $b: '2' })

    const text = vm.toString()
    expect(text).toContain('\\#x=5')
    expect(text).toContain('$b=2')
    expect(text).not.toContain('$zero')
  })

  it('keeps only campaign variables when trimmed', () => {
    const { vm } = manager({ '%camp': '1', '$%also': '2', $quest: '3' })
    vm.trimQuest()

    expect([...vm.vars.keys()].sort()).toEqual(['$%also', '%camp'])
  })

  it('trims a single-character name without throwing (DEVIATION)', () => {
    // The C# calls Substring(0, 2) unguarded and throws here.
    const { vm } = manager({ x: '1', '%camp': '2' })

    expect(() => vm.trimQuest()).not.toThrow()
    expect([...vm.vars.keys()]).toEqual(['%camp'])
  })
})

describe('VarManager.test', () => {
  it('an empty condition passes', () => {
    expect(manager().vm.test(new VarTests())).toBe(true)
    expect(manager().vm.test(null)).toBe(true)
  })

  it('evaluates each comparison operator', () => {
    const { vm } = manager({ $a: '1' })

    expect(vm.test(tests('VarOperation:$a,==,1'))).toBe(true)
    expect(vm.test(tests('VarOperation:$a,!=,2'))).toBe(true)
    expect(vm.test(tests('VarOperation:$a,>,0'))).toBe(true)
    expect(vm.test(tests('VarOperation:$a,>=,1'))).toBe(true)
    expect(vm.test(tests('VarOperation:$a,<,2'))).toBe(true)
    expect(vm.test(tests('VarOperation:$a,<=,1'))).toBe(true)
  })

  it('fails an unknown operator', () => {
    expect(manager({ $a: '1' }).vm.test(tests('VarOperation:$a,?,1'))).toBe(false)
  })

  it('combines with AND and OR', () => {
    const { vm } = manager({ $a: '1', $b: '2' })

    expect(
      vm.test(tests('VarOperation:$a,==,1', 'VarTestsLogicalOperator:AND', 'VarOperation:$b,==,2')),
    ).toBe(true)
    expect(
      vm.test(tests('VarOperation:$a,==,9', 'VarTestsLogicalOperator:OR', 'VarOperation:$b,==,2')),
    ).toBe(true)
    expect(
      vm.test(tests('VarOperation:$a,==,1', 'VarTestsLogicalOperator:AND', 'VarOperation:$b,==,9')),
    ).toBe(false)
  })

  it('folds left to right rather than by precedence', () => {
    // false OR true AND false == (false OR true) AND false == false, not
    // false OR (true AND false).
    const { vm } = manager({ $a: '1', $b: '2', $c: '3' })

    expect(
      vm.test(
        tests(
          'VarOperation:$a,==,9',
          'VarTestsLogicalOperator:OR',
          'VarOperation:$b,==,2',
          'VarTestsLogicalOperator:AND',
          'VarOperation:$c,==,9',
        ),
      ),
    ).toBe(false)
  })

  it('groups with parentheses', () => {
    const { vm } = manager({ $a: '1', $b: '2', $c: '3' })

    expect(
      vm.test(
        tests(
          'VarOperation:$a,==,1',
          'VarTestsLogicalOperator:AND',
          'VarTestsParenthesis:(',
          'VarOperation:$b,==,9',
          'VarTestsLogicalOperator:OR',
          'VarOperation:$c,==,3',
          'VarTestsParenthesis:)',
        ),
      ),
    ).toBe(true)
  })

  it('short-circuits the nested test, so it creates no variables', () => {
    // A hoisted recursion would evaluate the parenthesised group even when the
    // result is already false, creating $inner along the way.
    const { vm } = manager({ $a: '1' })

    vm.test(
      tests(
        'VarOperation:$a,==,9',
        'VarTestsLogicalOperator:AND',
        'VarTestsParenthesis:(',
        'VarOperation:$inner,==,0',
        'VarTestsParenthesis:)',
      ),
    )

    expect(vm.vars.has('$inner')).toBe(false)
  })
})

describe('PuzzleCode', () => {
  it('uses a fixed solution when one is given', () => {
    const puzzle = PuzzleCode.create(4, 6, '1 3 5 4', scripted([]))

    expect(puzzle.answer.state).toEqual([1, 3, 5, 4])
  })

  it('generates within the option range otherwise', () => {
    const puzzle = PuzzleCode.create(4, 6, '', scripted([0, 2, 4, 1]))

    expect(puzzle.answer.state).toEqual([1, 3, 5, 2])
  })

  it('is solved only when the most recent guess is correct', () => {
    const puzzle = PuzzleCode.create(4, 6, '1 2 3 4', scripted([]))

    expect(puzzle.solved()).toBe(false)
    puzzle.addGuess([1, 2, 3, 4])
    expect(puzzle.solved()).toBe(true)
    puzzle.addGuess([4, 3, 2, 1])
    expect(puzzle.solved()).toBe(false)
  })

  it('counts right values in the right and wrong places', () => {
    const puzzle = PuzzleCode.create(4, 6, '1 2 3 4', scripted([]))
    puzzle.addGuess([1, 3, 2, 5])
    const guess = puzzle.guess[0]!

    expect(guess.correctSpot()).toBe(1)
    expect(guess.correctType()).toBe(2)
  })

  it('does not double-count a repeated value', () => {
    const puzzle = PuzzleCode.create(4, 6, '1 1 2 2', scripted([]))
    puzzle.addGuess([2, 2, 1, 1])

    expect(puzzle.guess[0]!.correctSpot()).toBe(0)
    expect(puzzle.guess[0]!.correctType()).toBe(4)
  })

  it('round-trips through a saved section', () => {
    const puzzle = PuzzleCode.fromSaved(fields({ answer: '1 2 3 4', guess: '1 2 3 4,4 3 2 1' }))

    expect(puzzle.answer.state).toEqual([1, 2, 3, 4])
    expect(puzzle.guess).toHaveLength(2)
    expect(puzzle.toSectionString('1')).toContain('guess=1 2 3 4,4 3 2 1')
  })

  it('drops the = when there are no guesses (PRESERVED BUG)', () => {
    // The C# appends "guess=" then chops one character off the end, which eats
    // the '=' when the list is empty.
    const puzzle = PuzzleCode.create(4, 6, '1 2 3 4', scripted([]))

    expect(puzzle.toSectionString('1')).toBe('[PuzzleCode1]\nanswer=1 2 3 4\nguess\n\n')
  })

  it('parses a saved answer', () => {
    expect(CodeAnswer.parse('3 1 4 1').state).toEqual([3, 1, 4, 1])
  })
})

describe('PuzzleImage', () => {
  it('is solved when every piece is in its own slot', () => {
    const solved = PuzzleImage.fromSaved(
      fields({ moves: '3', state: '0 0,0 0:0 1,0 1:1 0,1 0:1 1,1 1' }),
    )
    expect(solved.solved()).toBe(true)

    const scrambled = PuzzleImage.fromSaved(fields({ moves: '1', state: '0 0,1 1:1 1,0 0' }))
    expect(scrambled.solved()).toBe(false)
  })

  it('generates a full grid', () => {
    const puzzle = PuzzleImage.generate(2, 2, scripted([0, 0, 1, 2]))

    expect(puzzle.state.size).toBe(4)
  })

  it('round-trips through a saved section', () => {
    const text = PuzzleImage.fromSaved(
      fields({ moves: '3', state: '0 0,1 1:1 1,0 0' }),
    ).toSectionString('2')

    expect(text).toBe('[PuzzleImage2]\nmoves=3\nstate=0 0,1 1:1 1,0 0\n\n')
  })
})

describe('PuzzleSlide', () => {
  const hardCoded = () => PuzzleSlide.fromSaved(PuzzleSlide.hardCodedPuzzle())

  it('is solved when the target block reaches the exit', () => {
    expect(hardCoded().solved()).toBe(false)
    expect(
      PuzzleSlide.fromSaved(fields({ moves: '9', block0: 'False,1,0,6,2,True' })).solved(),
    ).toBe(true)
  })

  it('knows which squares are free', () => {
    const blocks = hardCoded().puzzle

    expect(PuzzleSlide.empty(blocks, -1, 0)).toBe(false)
    expect(PuzzleSlide.empty(blocks, 0, -1)).toBe(false)
    expect(PuzzleSlide.empty(blocks, 0, 6)).toBe(false)
    // The exit lane runs past x=5 only at y=2.
    expect(PuzzleSlide.empty(blocks, 6, 3)).toBe(false)
    expect(PuzzleSlide.empty(blocks, 8, 2)).toBe(false)
    expect(PuzzleSlide.empty(blocks, 6, 2)).toBe(true)
  })

  it('parses and re-serialises a block', () => {
    const block = SlideBlock.parse('True,0,1,5,2,False')

    expect([block.rotation, block.xlen, block.ylen, block.xpos, block.ypos, block.target]).toEqual([
      true,
      0,
      1,
      5,
      2,
      false,
    ])
    expect(block.toString()).toBe('True,0,1,5,2,False')
  })

  it('detects overlap between blocks', () => {
    const a = SlideBlock.parse('False,1,0,0,2,True')
    const b = SlideBlock.parse('False,1,0,1,2,False')
    const far = SlideBlock.parse('False,1,0,4,5,False')

    expect(a.blocksBlock(b)).toBe(true)
    expect(a.blocksBlock(far)).toBe(false)
    expect(a.blocksAny([far, b])).toBe(true)
  })

  it('computes the square a move would occupy', () => {
    const horizontal = SlideBlock.parse('False,1,0,2,2,True')
    expect(horizontal.getMove(1)).toEqual({ x: 4, y: 2 })
    expect(horizontal.getMove(-1)).toEqual({ x: 1, y: 2 })

    const vertical = SlideBlock.parse('True,0,1,5,0,False')
    expect(vertical.getMove(1)).toEqual({ x: 5, y: 2 })
  })
})

describe('PuzzleTower', () => {
  const saved = (o: Record<string, string>) => PuzzleTower.fromSaved(fields(o))

  it('is solved when every tower is empty or holds all eight in order', () => {
    expect(saved({ moves: '0', 0: '7 6 5 4 3 2 1 0', 1: '', 2: '' }).solved()).toBe(true)
    expect(saved({ moves: '2', 0: '7 6 5 4 3 2', 1: '1', 2: '0' }).solved()).toBe(false)
  })

  it('rejects an out-of-order stack even when complete', () => {
    expect(saved({ moves: '0', 0: '0 1 2 3 4 5 6 7', 1: '', 2: '' }).solved()).toBe(false)
  })

  it('allows a smaller disc onto a larger one', () => {
    const puzzle = saved({ moves: '0', 0: '7 6 5', 1: '', 2: '' })

    expect(puzzle.moveOK(0, 1)).toBe(true)
    puzzle.move(0, 1)
    expect(puzzle.puzzle).toEqual([[7, 6], [5], []])
  })

  it('refuses a larger disc onto a smaller one', () => {
    const puzzle = saved({ moves: '0', 0: '7 6 5', 1: '1', 2: '' })
    puzzle.move(0, 1)

    expect(puzzle.puzzle).toEqual([[7, 6, 5], [1], []])
  })

  it('refuses a move from an empty tower or out of range', () => {
    const puzzle = saved({ moves: '0', 0: '', 1: '3', 2: '' })
    puzzle.move(0, 1)
    puzzle.move(1, 9)

    expect(puzzle.puzzle).toEqual([[], [3], []])
  })

  it('builds the state space by reverse breadth-first search', () => {
    // One legal reverse move from solved, then two, then three.
    expect(PuzzleTower.buildPuzzles(0)).toHaveLength(1)
    expect(PuzzleTower.buildPuzzles(1)).toHaveLength(2)
    expect(PuzzleTower.buildPuzzles(2).length).toBeGreaterThan(2)
  })

  it('generates a board and shuffles the tower order', () => {
    const puzzle = PuzzleTower.generate(2, scripted([1, 1, 0]))

    expect(puzzle.puzzle).toHaveLength(3)
    expect(puzzle.puzzle.flat().sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it('drops the = for an empty tower on the way out (PRESERVED BUG)', () => {
    const text = saved({ moves: '4', 0: '7 6', 1: '', 2: '5' }).toSectionString('1')

    expect(text).toBe('[PuzzleTower1]\nmoves=4\n0=7 6\n1\n2=5\n\n')
  })
})

describe('puzzle moves', () => {
  describe('PuzzleImage.swap', () => {
    const puzzle = (): PuzzleImage => PuzzleImage.generate(2, 2, (min) => min)

    it('exchanges the pieces in two slots and counts the move', () => {
      const image = puzzle()
      const before = [...image.state.values()].map(([slot, piece]) => `${slot.key}:${piece.key}`)

      expect(image.swap(new TilePosition(0, 0), new TilePosition(1, 0))).toBe(true)
      expect(image.moves).toBe(1)
      const after = [...image.state.values()].map(([slot, piece]) => `${slot.key}:${piece.key}`)
      expect(after).not.toEqual(before)
    })

    it('leaves the slots where they are and moves only the pieces', () => {
      const image = puzzle()
      image.swap(new TilePosition(0, 0), new TilePosition(1, 0))
      const slots = [...image.state.values()].map(([slot]) => slot.key).sort()

      expect(slots).toEqual(['0 0', '0 1', '1 0', '1 1'])
    })

    it('refuses a slot that is not on the board', () => {
      // Counting a move that did not happen would let a player "solve" a
      // puzzle by dragging into empty space.
      const image = puzzle()

      expect(image.swap(new TilePosition(0, 0), new TilePosition(9, 9))).toBe(false)
      expect(image.moves).toBe(0)
    })

    it('refuses to swap a slot with itself', () => {
      const image = puzzle()

      expect(image.swap(new TilePosition(0, 0), new TilePosition(0, 0))).toBe(false)
      expect(image.moves).toBe(0)
    })

    it('is solved once every piece is back in its own slot', () => {
      const image = PuzzleImage.generate(2, 1, (min) => min)
      // The generator's shuffle is deterministic here, so undo it by swapping
      // until it reports solved.
      if (!image.solved()) image.swap(new TilePosition(0, 0), new TilePosition(1, 0))

      expect(image.solved()).toBe(true)
    })
  })

  describe('PuzzleSlide.moveBlock', () => {
    const slide = (blocks: string[]): PuzzleSlide => {
      const data = new Map(blocks.map((b, i) => [`Block${String(i)}`, b]))
      return PuzzleSlide.fromSaved(data)
    }

    it('slides a horizontal block along its row', () => {
      const puzzle = slide(['false,2,1,0,2,true'])

      expect(puzzle.moveBlock(0, 1, 2)).toBe(true)
      expect(puzzle.puzzle[0]?.xpos).toBe(1)
      expect(puzzle.moves).toBe(1)
    })

    it('refuses to move a horizontal block off its row', () => {
      // A block does not merely fail to move sideways; that is not a thing a
      // block does.
      const puzzle = slide(['false,2,1,0,2,true'])

      expect(puzzle.moveBlock(0, 0, 3)).toBe(false)
      expect(puzzle.moves).toBe(0)
    })

    it('refuses a move blocked by another block', () => {
      const puzzle = slide(['false,2,1,0,2,true', 'false,2,1,2,2,false'])

      expect(puzzle.moveBlock(0, 1, 2)).toBe(false)
      expect(puzzle.puzzle[0]?.xpos).toBe(0)
    })

    it('refuses a move off the board', () => {
      const puzzle = slide(['false,2,1,0,2,true'])

      expect(puzzle.moveBlock(0, -1, 2)).toBe(false)
    })

    it('lets the target block leave through the exit lane', () => {
      // The one square beyond the board is how the puzzle is won.
      const puzzle = slide(['false,2,1,4,2,true'])

      expect(puzzle.moveBlock(0, 5, 2)).toBe(true)
    })

    it('keeps a non-target block on the board', () => {
      const puzzle = slide(['false,2,1,4,2,false'])

      expect(puzzle.moveBlock(0, 5, 2)).toBe(false)
    })

    it('does not count a move that changes nothing', () => {
      const puzzle = slide(['false,2,1,0,2,true'])

      expect(puzzle.moveBlock(0, 0, 2)).toBe(false)
      expect(puzzle.moves).toBe(0)
    })

    it('ignores a block that is not there', () => {
      const puzzle = slide(['false,2,1,0,2,true'])

      expect(puzzle.moveBlock(9, 1, 2)).toBe(false)
    })
  })
})

describe('PuzzleSlide destinations', () => {
  // A screen that offers a block's legal squares rather than accepting a drag
  // has to ask before moving. The C# only ever asks while moving, inside
  // `MoveBlock`, so these cover the split.
  const hardCodedBoard = () => PuzzleSlide.fromSaved(PuzzleSlide.hardCodedPuzzle())

  it('offers only the squares a block can actually reach', () => {
    const puzzle = hardCodedBoard()
    for (const [index] of puzzle.puzzle.entries()) {
      for (const square of puzzle.destinations(index)) {
        expect(puzzle.canMove(index, square.x, square.y)).toBe(true)
      }
    }
  })

  it('never offers a block its own square', () => {
    const puzzle = hardCodedBoard()
    const block = puzzle.puzzle[0]
    expect(block).toBeDefined()
    expect(puzzle.destinations(0)).not.toContainEqual({ x: block?.xpos, y: block?.ypos })
  })

  it('offers squares along the axis the block slides on', () => {
    // A block that does not rotate slides in x, and keeps its y throughout.
    const puzzle = hardCodedBoard()
    const index = puzzle.puzzle.findIndex((b) => !b.rotation)
    const block = puzzle.puzzle[index]
    expect(block).toBeDefined()
    for (const square of puzzle.destinations(index)) expect(square.y).toBe(block?.ypos)
  })

  it('asking does not move anything', () => {
    const puzzle = hardCodedBoard()
    const before = puzzle.puzzle.map((b) => `${String(b.xpos)},${String(b.ypos)}`).join(' ')
    const movesBefore = puzzle.moves
    for (const [index] of puzzle.puzzle.entries()) puzzle.destinations(index)

    expect(puzzle.puzzle.map((b) => `${String(b.xpos)},${String(b.ypos)}`).join(' ')).toBe(before)
    expect(puzzle.moves).toBe(movesBefore)
  })

  it('still refuses an illegal move through moveBlock', () => {
    const puzzle = hardCodedBoard()
    expect(puzzle.moveBlock(0, 99, 99)).toBe(false)
  })
})

describe('PuzzleTower moves', () => {
  it('counts a move that happened, and not one that did not', () => {
    // The C# counts in `PuzzleTowerWindow`; this port counts in the model, as
    // it already does for slide and image, so a save carries the tally.
    const tower = PuzzleTower.generate(3, (min, max) => min + ((max - min) >> 1))
    const legal: [number, number][] = []
    for (let a = 0; a < tower.puzzle.length; a++) {
      for (let b = 0; b < tower.puzzle.length; b++) {
        if (a !== b && tower.moveOK(a, b)) legal.push([a, b])
      }
    }
    expect(legal.length).toBeGreaterThan(0)

    const [from, to] = legal[0] as [number, number]
    tower.move(from, to)
    expect(tower.moves).toBe(1)

    // Moving a larger disc onto a smaller one is refused, and uncounted.
    const illegal = tower.puzzle.findIndex((_, i) => i !== to && !tower.moveOK(to, i))
    if (illegal >= 0) {
      tower.move(to, illegal)
      expect(tower.moves).toBe(1)
    }
  })
})

describe('slidePuzzleLayouts', () => {
  it('ships every layout the C# resource carries', () => {
    // `Assets/Resources/slidepuzzles.txt`. Without these `PuzzleSlide.generate`
    // returns null for every difficulty and the event draws itself as an
    // ordinary dialog instead of a puzzle.
    expect(slidePuzzleLayouts().size).toBe(35)
  })

  it('answers every difficulty a scenario can ask for', () => {
    const layouts = slidePuzzleLayouts()
    for (const depth of [1, 2, 3, 4, 5]) {
      const puzzle = PuzzleSlide.generate(depth, layouts, (min) => min)
      expect(puzzle, `depth ${String(depth)}`).not.toBeNull()
      expect(puzzle?.puzzle.length).toBeGreaterThan(0)
      // A freshly generated puzzle starts with no moves against it, whatever
      // the layout recorded as its solution length.
      expect(puzzle?.moves).toBe(0)
    }
  })

  it('parses each layout into blocks rather than raw fields', () => {
    const layouts = slidePuzzleLayouts()
    for (const [name, fields] of layouts) {
      expect(fields.get('moves'), name).toBeDefined()
      expect(PuzzleSlide.fromSaved(fields).puzzle.length, name).toBeGreaterThan(0)
    }
  })
})
