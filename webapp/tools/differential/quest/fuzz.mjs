import { writeFileSync } from 'node:fs'

let seed = 0x51a3d7e9
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000
const pick = (a) => a[Math.floor(rnd() * a.length)]

const PREFIXES = [
  'Event',
  'Tile',
  'Token',
  'Door',
  'UI',
  'Spawn',
  'MPlace',
  'QItem',
  'Puzzle',
  'CustomMonster',
  'Activation',
  'StartingItem',
  'Unknown',
  'Even',
  'Tok',
]

const KEYS = [
  'xposition',
  'yposition',
  'comment',
  'operations',
  'vartests',
  'conditions',
  'display',
  'buttons',
  'hero',
  'quota',
  'minhero',
  'maxhero',
  'add',
  'remove',
  'trigger',
  'randomevents',
  'mincam',
  'maxcam',
  'audio',
  'music',
  'highlight',
  'side',
  'rotation',
  'customImage',
  'top',
  'left',
  'color',
  'type',
  'tokensize',
  'clickeffect',
  'image',
  'fadespeed',
  'vunits',
  'size',
  'textsize',
  'textaspect',
  'textcolor',
  'textbackgroundcolor',
  'halign',
  'valign',
  'textAlignment',
  'richText',
  'border',
  'monster',
  'traits',
  'traitpool',
  'placement0',
  'placement1',
  'unique',
  'activated',
  'uniquehealth',
  'uniquehealthhero',
  'master',
  'rotate',
  'class',
  'skill',
  'puzzlelevel',
  'puzzlealtlevel',
  'puzzlesolution',
  'itemname',
  'starting',
  'inspect',
  'base',
  'imageplace',
  'activation',
  'health',
  'healthperhero',
  'evadeevent',
  'horrorevent',
  'horror',
  'awareness',
  'attacks',
  'minionfirst',
  'masterfirst',
  'button1',
  'event1',
  'event1Condition',
  'event1ConditionAction',
  'buttoncolor1',
]

const VALUES = [
  '',
  '0',
  '1',
  '-1',
  '2.5',
  '0,5',
  'true',
  'True',
  'FALSE',
  'yes',
  'abc',
  'a b c',
  'a  b',
  ' spaced ',
  'left',
  'right',
  'top',
  'bottom',
  'center',
  'a\\b\\c.png',
  '{qst:KEY}',
  '$a,>,1',
  'VarOperation:$a,>,1',
  'VarOperation:$a,>,1 VarTestsLogicalOperator:AND VarOperation:$b,<,2',
  'EventA EventB',
  'EventA,$a,>,1',
  'EventA,$a,>,1,hide',
  'melee:3 ranged',
  'melee:bad',
  '2147483648',
  'small',
  '#FF0000',
  'NaN',
  'TileSide1',
]

const cases = []
const N = Number(process.argv[2] ?? 3000)

for (let i = 0; i < N; i++) {
  const fields = {}
  const n = Math.floor(rnd() * 7)
  for (let k = 0; k < n; k++) fields[pick(KEYS)] = pick(VALUES)

  const prefix = pick(PREFIXES)
  // A Tile with neither side nor customImage aborts the C# via
  // Application.Quit; the documented deviation is covered by a unit test, so
  // it is kept out of the fuzz to avoid swamping the run.
  if (prefix === 'Tile' && !('side' in fields) && !('customImage' in fields)) {
    fields.side = 'TileSide1'
  }

  cases.push({
    name: `f-${i}`,
    kind: 'section',
    section: prefix + pick(['A', 'B', '1', '', 'X_Y']),
    fields,
    source: 'quest.ini',
    format: pick([4, 8, 9, 16, 17, 21]),
    maxHeroes: pick([4, 5, 6]),
    defaultHeroes: 4,
  })
}

writeFileSync(process.argv[3], JSON.stringify(cases))
console.log('quest fuzz cases:', cases.length)
