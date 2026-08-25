/**
 * Differential runner for quest-text symbol replacement.
 *
 * Compiles the extracted `OutputSymbolReplace` / `InputSymbolReplace` from the
 * real `EventManager.cs` and compares them against the port. Every line of
 * text a quest shows goes through this, so it is worth checking exactly.
 *
 *   node compare.mjs [fuzzCount] [seed]
 */
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { VarManager } from '../../../packages/core/src/quest/VarManager.ts'
import {
  inputSymbolReplace,
  outputSymbolReplace,
} from '../../../packages/core/src/quest/symbols.ts'

const here = dirname(fileURLToPath(import.meta.url))
const fuzzCount = Number(process.argv[2] ?? 2000)
const seed = Number(process.argv[3] ?? 1)

const MARKERS = [
  '{heart}',
  '{fatigue}',
  '{might}',
  '{will}',
  '{action}',
  '{knowledge}',
  '{success}',
  '{shield}',
  '{surge}',
]

/**
 * Expansion markers, which come from a second table merged on top.
 *
 * A mutation test showed the corpus never reached them: dropping the pack
 * table entirely produced no divergence, because nothing exercised it.
 */
const PACK_MARKERS = ['{MAD01}', '{MAD20}', '{MAD22}', '{MAD27}', '{MAD28}']

function curated() {
  const cases = []
  const add = (label, input, vars = {}, gameType = 'MoM') =>
    cases.push({ label, input, vars, gameType })

  add('plain text', 'The door is locked.')
  add('empty', '')
  add('one variable', 'You have {var:$gold} gold.', { $gold: 7 })
  add('unset variable reads zero', 'Count: {var:$missing}')
  add('two variables', '{var:$a} and {var:$b}', { $a: 1, $b: 2 })
  add('same variable twice', '{var:$a}{var:$a}', { $a: 3 })
  add('fractional value', 'Value {var:$x}', { $x: 2.5 })
  add('negative value', 'Value {var:$x}', { $x: -4 })

  for (const marker of MARKERS) {
    add(`marker ${marker}`, `Spend ${marker} now`)
    add(`marker ${marker} in D2E`, `Spend ${marker} now`, {}, 'D2E')
  }

  for (const marker of PACK_MARKERS) {
    add(`expansion marker ${marker}`, `From ${marker} expansion`)
    // The pack table is MoM-only, so the same marker is inert in D2E.
    add(`expansion marker ${marker} in D2E`, `From ${marker} expansion`, {}, 'D2E')
  }

  add('marker and variable', 'Pay {var:$cost} {heart}', { $cost: 2 })
  add('repeated marker', '{heart}{heart}{heart}')
  add('unknown marker left alone', 'A {nonsense} marker')
  add('unknown game type', 'A {heart} marker', {}, 'Nonexistent')

  // Malformed clauses: the C# catches and leaves the text part-substituted.
  add('unclosed var clause', 'Broken {var:$a and more', { $a: 1 })
  add('var clause after a good one', '{var:$a} then {var:$b', { $a: 1, $b: 2 })
  add('bare braces', 'Just { and } braces')
  add('empty var name', 'Empty {var:}')

  add('multiline', 'First line\nSecond {var:$a}', { $a: 9 })
  add('unicode text', 'Café {heart} naïve')

  return cases
}

function fuzz(count, seedValue) {
  let state = seedValue >>> 0
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
  const pick = (list) => list[Math.floor(next() * list.length)]

  const FRAGMENTS = [
    'text ',
    '{var:$a}',
    '{var:$b}',
    '{var:$missing}',
    ...MARKERS,
    '{unclosed',
    '}',
    '{',
    '\n',
    'é',
  ]

  const cases = []
  for (let i = 0; i < count; i++) {
    let input = ''
    const parts = 1 + Math.floor(next() * 8)
    for (let p = 0; p < parts; p++) input += pick(FRAGMENTS)

    cases.push({
      label: `fuzz ${i}`,
      input,
      vars: { $a: Math.floor(next() * 20) - 5, $b: Math.floor(next() * 10) },
      gameType: pick(['MoM', 'D2E']),
    })
  }
  return cases
}

const cases = [...curated(), ...fuzz(fuzzCount, seed)]

execFileSync('node', [join(here, 'extract.mjs')], { stdio: 'pipe' })
const raw = execFileSync(
  'dotnet',
  ['run', '--project', join(here, 'symbolsharness.csproj'), '-c', 'Release', '-v', 'quiet'],
  { input: JSON.stringify(cases), maxBuffer: 1 << 28, encoding: 'utf8' },
)
const cs = JSON.parse(raw.slice(raw.indexOf('[')))

let divergences = 0
let warningsSeen = 0
let expectedThrows = 0

for (let i = 0; i < cases.length; i++) {
  const expected = cs[i]
  const testCase = cases[i]

  // `GetCharacterMap` returns null for an unknown game type, and the caller
  // iterates it without checking — so the C# throws NullReferenceException
  // outside its own try/catch. The port returns the text unchanged. Counted
  // as an expected deviation, the way the other harnesses count C# throws.
  if (expected.error !== null && expected.error !== undefined) {
    expectedThrows++
    if (expectedThrows <= 3) {
      console.log(`### ${testCase.label}: C# threw ${expected.error}, TS succeeded`)
    }
    continue
  }

  const vars = new VarManager()
  for (const [name, value] of Object.entries(testCase.vars)) vars.setValue(name, value)

  let warnings = 0
  const output = outputSymbolReplace(testCase.input, {
    gameType: testCase.gameType,
    vars,
    onWarning: () => warnings++,
  })
  const roundTrip = inputSymbolReplace(output, testCase.gameType)
  warningsSeen += warnings

  const differs =
    output !== expected.output || roundTrip !== expected.roundTrip || warnings !== expected.warnings

  if (!differs) continue

  divergences++
  if (divergences <= 8) {
    console.log(`\n${testCase.label}  (${testCase.gameType})`)
    console.log(`  input   : ${JSON.stringify(testCase.input)}`)
    if (output !== expected.output) {
      console.log(`  C#      : ${JSON.stringify(expected.output)}`)
      console.log(`  TS      : ${JSON.stringify(output)}`)
    }
    if (roundTrip !== expected.roundTrip) {
      console.log(`  C# back : ${JSON.stringify(expected.roundTrip)}`)
      console.log(`  TS back : ${JSON.stringify(roundTrip)}`)
    }
    if (warnings !== expected.warnings) {
      console.log(`  warnings: C# ${expected.warnings}, TS ${warnings}`)
    }
  }
}

console.log(
  `\nsymbols: ${cases.length} cases, ${divergences} real divergences, ` +
    `${expectedThrows} C# throws, ${warningsSeen} malformed clauses exercised`,
)
process.exit(divergences === 0 ? 0 : 1)
