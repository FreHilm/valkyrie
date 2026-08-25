import { writeFileSync } from 'node:fs'

let seed = 0x3fa71c05
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000
const pick = (a) => a[Math.floor(rnd() * a.length)]
const int = (max) => Math.floor(rnd() * max)

const VAR_NAMES = ['$a', '$b', '%camp', '$%both', '#read', 'plain', '$x']
const OPS = ['=', '+', '-', '*', '/', '%', '?', '==']
const VALUES = [
  '0',
  '1',
  '-3',
  '2.5',
  '.5',
  '0,5',
  '$a',
  '$b',
  '$missing',
  '#rand6',
  '#rand0',
  'abc',
  '',
]
const TEST_OPS = ['==', '!=', '>', '<', '>=', '<=', '?']

const cases = []
const N = Number(process.argv[2] ?? 3000)

for (let i = 0; i < N; i++) {
  const mode = i % 5

  if (mode === 0) {
    // Variable arithmetic. Single-character names are excluded: they make the
    // C#'s TrimQuest throw, which is a documented deviation covered elsewhere.
    const saved = {}
    for (let k = 0; k < int(4); k++) saved[pick(VAR_NAMES)] = pick(['0', '1', '-2', '3.5'])
    const ops = []
    for (let k = 0; k < 1 + int(4); k++) {
      ops.push(`${pick(VAR_NAMES)},${pick(OPS)},${pick(VALUES)}`)
    }
    cases.push({
      name: `f-vars-${i}`,
      kind: 'vars',
      saved,
      ops,
      random: [int(10), int(10), int(10)],
    })
  } else if (mode === 1) {
    const saved = {}
    for (let k = 0; k < int(4); k++) saved[pick(VAR_NAMES)] = pick(['0', '1', '-2', '3.5'])

    const tests = []
    for (let k = 0; k < 1 + int(6); k++) {
      const roll = rnd()
      if (roll < 0.55)
        tests.push(`VarOperation:${pick(VAR_NAMES)},${pick(TEST_OPS)},${pick(VALUES)}`)
      else if (roll < 0.8) tests.push(`VarTestsLogicalOperator:${pick(['AND', 'OR'])}`)
      else tests.push(`VarTestsParenthesis:${pick(['(', ')'])}`)
    }
    cases.push({ name: `f-test-${i}`, kind: 'test', saved, tests, random: [int(10)] })
  } else if (mode === 2) {
    const items = 1 + int(6)
    const options = 1 + int(8)
    const guesses = []
    for (let k = 0; k < int(4); k++) {
      guesses.push(Array.from({ length: items }, () => 1 + int(options)))
    }
    cases.push({
      name: `f-code-${i}`,
      kind: 'code',
      items,
      options,
      solution: rnd() < 0.5 ? Array.from({ length: items }, () => 1 + int(options)).join(' ') : '',
      guesses,
      random: Array.from({ length: items }, () => int(20)),
    })
  } else if (mode === 4) {
    const parts = ['0', '1', '2', '3', '12', '20', '99', '300', 'a', 'b', 'BETA', 'MAJOR', '']
    const build = () => {
      const n = 1 + int(4)
      const chunks = []
      for (let k = 0; k < n; k++) chunks.push(pick(parts))
      let text = chunks.join('.')
      if (rnd() < 0.3) text += ` ${pick(['BETA', 'MAJOR', 'beta', 'x'])}`
      return text
    }
    cases.push({ name: `f-version-${i}`, kind: 'version', a: build(), b: build() })
  } else {
    const towers = [[], [], []]
    const discs = Array.from({ length: 8 }, (_, d) => 7 - d)
    for (const disc of discs) towers[int(3)].push(disc)

    const moves = []
    for (let k = 0; k < int(5); k++) moves.push([int(4), int(4)])

    cases.push({
      name: `f-tower-${i}`,
      kind: 'tower',
      saved: {
        moves: String(int(30)),
        0: towers[0].join(' '),
        1: towers[1].join(' '),
        2: towers[2].join(' '),
      },
      moves,
    })
  }
}

writeFileSync(process.argv[3], JSON.stringify(cases))
console.log('rules fuzz cases:', cases.length)
