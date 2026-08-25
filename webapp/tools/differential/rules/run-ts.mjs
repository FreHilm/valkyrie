import { readFileSync, writeFileSync } from 'node:fs'
import { VarManager } from '../../../packages/core/src/quest/VarManager.ts'
import { VarOperation, VarTests } from '../../../packages/core/src/quest/VarTests.ts'
import {
  isBeta,
  versionCodeGenerate,
  versionNewer,
  versionNewerOrEqual,
} from '../../../packages/core/src/version/version.ts'
import {
  PuzzleCode,
  PuzzleImage,
  PuzzleSlide,
  PuzzleTower,
} from '../../../packages/core/src/quest/puzzles.ts'

const corpus = JSON.parse(readFileSync(process.argv[2], 'utf8'))

const fields = (o) => new Map(Object.entries(o).map(([k, v]) => [k, String(v)]))

/** Mirrors the C# shim: replays a script, clamped into the requested range. */
function scriptedRandom(script = []) {
  let cursor = 0
  return (min, max) => {
    const value = cursor < script.length ? script[cursor] : min
    cursor++
    if (max <= min) return min
    const span = max - min
    return min + (((value % span) + span) % span)
  }
}

const renderNumber = (n) => {
  if (Number.isNaN(n)) return 'NaN'
  if (!Number.isFinite(n)) return n > 0 ? 'Infinity' : '-Infinity'
  return n
}

const dumpVars = (vm) => [...vm.vars].map(([k, v]) => [k, renderNumber(v)])

function makeVarManager(c, notices) {
  const options = {
    notice: (m) => notices.push(m),
    randomRange: scriptedRandom(c.random),
  }
  return c.saved === undefined
    ? new VarManager(options)
    : VarManager.fromSaved(fields(c.saved), options)
}

const results = corpus.map((c) => {
  const r = { name: c.name }
  try {
    r.ok = true
    const notices = []

    if (c.kind === 'vars') {
      const vm = makeVarManager(c, notices)

      for (const op of c.ops ?? []) vm.perform(new VarOperation(op))
      if (c.trim === true) vm.trimQuest()
      for (const [key, value] of Object.entries(c.set ?? {})) vm.setValue(key, value)

      const o = { vars: dumpVars(vm), toString: vm.toString() }
      if (c.get !== undefined) o.get = renderNumber(vm.getValue(c.get))
      if (c.prefix !== undefined) {
        o.prefix = [...vm.getPrefixVars(c.prefix)].map(([k, v]) => [k, renderNumber(v)])
      }
      o.notices = notices
      r.data = o
    } else if (c.kind === 'test') {
      const vm = makeVarManager(c, notices)
      const tests = new VarTests()
      for (const part of c.tests ?? []) tests.addFromString(part)

      r.data = { result: vm.test(tests), vars: dumpVars(vm) }
    } else if (c.kind === 'code') {
      const puzzle =
        c.saved !== undefined
          ? PuzzleCode.fromSaved(fields(c.saved))
          : PuzzleCode.create(c.items, c.options, c.solution ?? '', scriptedRandom(c.random))

      for (const guess of c.guesses ?? []) puzzle.addGuess(guess)

      r.data = {
        answer: puzzle.answer.toString(),
        solved: puzzle.solved(),
        toString: puzzle.toSectionString('1'),
        guesses: puzzle.guess.map((g) => [
          g.toString(),
          g.correct(),
          g.correctSpot(),
          g.correctType(),
        ]),
      }
    } else if (c.kind === 'image') {
      const puzzle =
        c.saved !== undefined
          ? PuzzleImage.fromSaved(fields(c.saved))
          : PuzzleImage.generate(c.x, c.y, scriptedRandom(c.random))

      r.data = { solved: puzzle.solved(), toString: puzzle.toSectionString('1') }
    } else if (c.kind === 'slide') {
      const puzzle = PuzzleSlide.fromSaved(fields(c.saved))
      const o = { solved: puzzle.solved(), toString: puzzle.toSectionString('1') }
      if (c.empty !== undefined) {
        o.empty = c.empty.map(([x, y]) => [x, y, PuzzleSlide.empty(puzzle.puzzle, x, y)])
      }
      r.data = o
    } else if (c.kind === 'tower') {
      const puzzle =
        c.saved !== undefined
          ? PuzzleTower.fromSaved(fields(c.saved))
          : PuzzleTower.generate(c.depth, scriptedRandom(c.random))

      for (const [from, to] of c.moves ?? []) puzzle.move(from, to)

      const o = {
        solved: puzzle.solved(),
        toString: puzzle.toSectionString('1'),
        state: puzzle.puzzle,
      }
      if (c.countStates !== undefined) {
        o.stateCount = PuzzleTower.buildPuzzles(c.countStates).length
      }
      r.data = o
    } else if (c.kind === 'version') {
      const a = c.a
      const b = c.b ?? ''
      r.data = {
        isBetaA: isBeta(a),
        isBetaB: isBeta(b),
        newer: versionNewer(a, b),
        newerOrEqual: versionNewerOrEqual(a, b),
        codeA: versionCodeGenerate(a),
        codeB: versionCodeGenerate(b),
      }
    } else {
      throw new Error('unknown kind')
    }
  } catch (e) {
    r.ok = false
    r.error = e.constructor.name
    delete r.data
  }
  return r
})

writeFileSync(process.argv[3], JSON.stringify(results))
console.log('ts cases:', results.length)
