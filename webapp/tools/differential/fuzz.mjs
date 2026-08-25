import { writeFileSync } from 'node:fs'
// Deterministic PRNG so a failure is reproducible.
let seed = 0x5eed1234
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000
const pick = (a) => a[Math.floor(rnd() * a.length)]

const TOKENS = [
  '[',
  ']',
  '=',
  '#',
  ';',
  '"',
  ' ',
  '\t',
  'a',
  'B',
  '1',
  ' ',
  'ä',
  '[S]',
  'key',
  'value',
  '[[',
  ']]',
  '==',
  '""',
  '  ',
  'x=y',
  '\\',
]
const NEWLINES = ['\n', '\r\n', '\r']

function line() {
  const n = Math.floor(rnd() * 6)
  let s = ''
  for (let i = 0; i < n; i++) s += pick(TOKENS)
  return s
}
function doc() {
  const n = 1 + Math.floor(rnd() * 6)
  const parts = []
  for (let i = 0; i < n; i++) parts.push(line())
  let s = parts[0]
  for (let i = 1; i < parts.length; i++) s += pick(NEWLINES) + parts[i]
  return s
}

const N = Number(process.argv[2] ?? 4000)
const corpus = []
for (let i = 0; i < N; i++) {
  if (i % 4 === 3) {
    const lines = []
    const n = 1 + Math.floor(rnd() * 5)
    for (let k = 0; k < n; k++) lines.push(line())
    corpus.push({
      name: `fuzz-sec-${i}`,
      kind: 'readSection',
      lines,
      section: pick(['S', 'Quest', '', 'a']),
    })
  } else {
    corpus.push({ name: `fuzz-${i}`, kind: 'readFromString', input: doc() })
  }
}
writeFileSync(process.argv[3], JSON.stringify(corpus))
console.log('fuzz cases:', corpus.length)
