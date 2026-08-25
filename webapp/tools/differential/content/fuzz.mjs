import { writeFileSync } from 'node:fs'

let seed = 0x2c9f61b3
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000
const pick = (a) => a[Math.floor(rnd() * a.length)]

const PREFIXES = [
  'Hero',
  'Class',
  'Skill',
  'Item',
  'ItemUnique',
  'Monster',
  'MonsterActivation',
  'Attack',
  'Evade',
  'Horror',
  'Token',
  'Image',
  'Puzzle',
  'Audio',
  'TileSide',
  'PackType',
  'Peril',
  'Unknown',
  '',
  'Tok',
  'MonsterX',
]

const KEYS = [
  'name',
  'priority',
  'traits',
  'image',
  'image2',
  'image3',
  'top',
  'left',
  'pps',
  'aspect',
  'reverse',
  'archetype',
  'hybridarchetype',
  'items',
  'item',
  'xp',
  'price',
  'minfame',
  'maxfame',
  'info',
  'imageplace',
  'activation',
  'health',
  'healthperhero',
  'horror',
  'awareness',
  'ability',
  'minion',
  'master',
  'movebutton',
  'move',
  'masterfirst',
  'minionfirst',
  'x',
  'y',
  'height',
  'width',
  'x_android',
  'y_android',
  'text',
  'target',
  'attacktype',
  'monster',
  'file',
]

const VALUES = [
  '',
  '0',
  '1',
  '-1',
  '2.5',
  '0,5',
  '1e3',
  'abc',
  'true',
  'True',
  'false',
  'yes',
  '{import}/a.png',
  'a.png',
  '{val:KEY}',
  '{ffg:X}',
  'a b c',
  '  spaced  ',
  '105',
  '*2',
  '2147483648',
  'insignificant',
  'legendary',
  'NaN',
  'Infinity',
  '1,000',
  '.5',
  '5.',
]

const cases = []
const N = Number(process.argv[2] ?? 3000)

for (let i = 0; i < N; i++) {
  const prefix = pick(PREFIXES)
  const suffix = pick(['Foo', 'Bar', '', '1', 'X_Y'])
  const fields = {}
  const fieldCount = Math.floor(rnd() * 6)
  for (let k = 0; k < fieldCount; k++) fields[pick(KEYS)] = pick(VALUES)

  // A token with height but no width crashes the C#; excluded so that the
  // documented deviation does not swamp the run. It is covered by a unit test.
  if ('height' in fields && !('width' in fields)) fields.width = '0'

  cases.push({
    name: `f-${i}`,
    kind: 'section',
    section: prefix + suffix,
    fields,
    path: '/pack',
    packId: pick(['base', 'exp1', '']),
    android: rnd() < 0.2,
    pps: pick([105, 1, 0, 42.5]),
  })
}

writeFileSync(process.argv[3], JSON.stringify(cases))
console.log('content fuzz cases:', cases.length)
