import { writeFileSync } from 'node:fs'

let seed = 0x7f4a2b91
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000
const pick = (a) => a[Math.floor(rnd() * a.length)]
const chance = (p) => rnd() < p

const SEP_TOKENS = ['a', 'b', 'KEY', ':', '::', ':::', '{0}', 'x', '', 'val']
const ENTRY_TOKENS = [
  'a',
  'b',
  '"',
  '""',
  '|||',
  '\\n',
  ',',
  ' ',
  'value',
  'x',
  '{0}',
  '[b]',
  '[/b]',
  '[i]',
  '[u]',
]
const LINE_TOKENS = [
  'KEY,value',
  'A,1',
  'B,2',
  'KEY,"quoted',
  'more"',
  'KEY,|||trip',
  'trip|||',
  '//comment',
  '',
  'KEY,',
  'NOCOMMA',
  'KEY,a"b',
  'KEY,"a""b"',
  'KEY,|||a"b|||',
  'KEY,line\\nbreak',
  ' ',
]
const LANGS = ['English', 'French', 'German', 'Spanish']

const build = (tokens, max) => {
  const n = 1 + Math.floor(rnd() * max)
  let s = ''
  for (let i = 0; i < n; i++) s += pick(tokens)
  return s
}

const cases = []
const N = Number(process.argv[2] ?? 4000)

for (let i = 0; i < N; i++) {
  const mode = i % 4
  if (mode === 0) {
    cases.push({ name: `f-split-${i}`, kind: 'split3', input: build(SEP_TOKENS, 7) })
  } else if (mode === 1) {
    cases.push({ name: `f-entry-${i}`, kind: 'parseEntry', entry: build(ENTRY_TOKENS, 8) })
  } else if (mode === 2) {
    const lines = [`.,${pick(LANGS)}`]
    const n = 1 + Math.floor(rnd() * 6)
    for (let k = 0; k < n; k++) lines.push(build(LINE_TOKENS, 3))
    cases.push({ name: `f-adddata-${i}`, kind: 'addData', blocks: [lines] })
  } else {
    const dicts = ['ffg', 'val', 'qst'].filter(() => chance(0.7))
    const parts = []
    const n = 1 + Math.floor(rnd() * 4)
    for (let k = 0; k < n; k++)
      parts.push(pick(['{val:', '{ffg:', 'KEY', ':', '}', '{', 'x', '{0}']))
    cases.push({ name: `f-sk-${i}`, kind: 'stringKey', input: parts.join(''), dicts })
  }
}

writeFileSync(process.argv[3], JSON.stringify(cases))
console.log('i18n fuzz cases:', cases.length)
