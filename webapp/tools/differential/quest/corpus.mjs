/** Shared differential corpus for the quest data port. */

const section = (name, fields, extra = {}) => ({
  name: `section:${name}:${JSON.stringify(fields).slice(0, 60)}`,
  kind: 'section',
  section: name,
  fields,
  source: 'quest.ini',
  format: 21,
  ...extra,
})

const varTests = (name, parts, extra = {}) => ({
  name: `vartests:${name}`,
  kind: 'varTests',
  parts,
  ...extra,
})

const button = (name, fields, position = 1, extra = {}) => ({
  name: `button:${name}`,
  kind: 'button',
  fields,
  position,
  section: 'EventFoo',
  ...extra,
})

const quest = (name, fields, extra = {}) => ({
  name: `quest:${name}`,
  kind: 'quest',
  identifier: 'testquest',
  fields,
  ...extra,
})

export const corpus = [
  // ---- QuestComponent basics --------------------------------------------
  section('EventFoo', {}),
  section('EventFoo', { xposition: '3.5', yposition: '-2' }),
  section('EventFoo', { xposition: '0,5' }),
  section('EventFoo', { comment: 'a note' }),
  section('EventFoo', { operations: '$a,=,1 $b,+,2' }),
  section('EventFoo', { operations: '' }),
  section('EventFoo', { vartests: 'VarOperation:$a,>,1' }),
  section('EventFoo', {
    vartests: 'VarOperation:$a,>,1 VarTestsLogicalOperator:AND VarOperation:$b,<,2',
  }),
  section('EventFoo', { conditions: '$a,>,1 $b,<,2' }),
  section('EventFoo', { conditions: '$a,>,1' }),
  section('EventEnd', {}, { format: 8 }),
  section('EventEnd', {}, { format: 9 }),
  section('EventFoo', { operations: '#fire,=,1' }),

  // ---- Event -------------------------------------------------------------
  section('EventFoo', { display: 'true' }),
  section('EventFoo', { display: 'false' }),
  section('EventFoo', { buttons: '3' }),
  section('EventFoo', { display: 'false', buttons: '0' }),
  section('EventFoo', { hero: 'EventOther', minhero: '2', maxhero: '4' }),
  section('EventFoo', { quota: '3' }),
  section('EventFoo', { quota: '$counter' }),
  section('EventFoo', { quota: '' }),
  section('EventFoo', { add: 'A B  C', remove: 'D E' }),
  section('EventFoo', { trigger: 'DefeatedMonsterX' }),
  section('EventFoo', { randomevents: 'true', highlight: 'true' }),
  section('EventFoo', { mincam: 'true', xposition: '1' }),
  section('EventFoo', { maxcam: 'true', yposition: '1' }),
  section('EventFoo', { audio: 'a\\b\\c.ogg' }),
  section('EventFoo', { music: 'a\\1.ogg b\\2.ogg' }),
  section('EventFoo', { button1: 'Go', event1: 'EventNext' }),
  section('EventFoo', { buttons: '2', event1: 'A B', event2: 'C' }),

  // ---- Tile --------------------------------------------------------------
  section('TileRoom', { side: 'TileSide1' }),
  section('TileRoom', { side: 'TileSide1', rotation: '90', top: '1.5', left: '-2' }),
  section('TileRoom', { customImage: 'img.png' }),
  section('TileRoom', {}),

  // ---- Door / Token ------------------------------------------------------
  section('DoorA', {}),
  section('DoorA', { rotation: '90', color: '#FF0000' }),
  section('TokenA', { type: 'TokenSearch' }),
  section('TokenA', {
    type: 'TokenSearch',
    rotation: '45',
    tokensize: 'small',
    clickeffect: 'false',
    customImage: 'x.png',
  }),
  section('TokenA', { vartests: 'VarOperation:$a,>,1' }),
  section('TokenA', { rotation: 'bad' }),

  // ---- UI ----------------------------------------------------------------
  section('UIThing', {}),
  section('UIThing', {
    image: 'a\\b.png',
    fadespeed: 'slow',
    vunits: 'true',
    size: '2.5',
    textsize: '1.5',
    textaspect: '2',
    textcolor: 'red',
    textbackgroundcolor: 'black',
    halign: 'left',
    valign: 'bottom',
    border: 'true',
    clickeffect: 'false',
  }),
  section('UIThing', { halign: 'right', valign: 'top' }),
  section('UIThing', { halign: 'nonsense', valign: 'nonsense' }),
  section('UIThing', { textAlignment: 'left' }),
  section('UIThing', { textAlignment: 'RIGHT' }),
  section('UIThing', { textAlignment: 'garbage' }),
  // Enum.Parse takes numbers, lists and surrounding whitespace, none of which
  // are member names. A name-only parser silently rewrites these to CENTER.
  section('UIThing', { textAlignment: '0' }),
  section('UIThing', { textAlignment: '1' }),
  section('UIThing', { textAlignment: '2' }),
  section('UIThing', { textAlignment: '-1' }),
  section('UIThing', { textAlignment: '7' }),
  section('UIThing', { textAlignment: '  top  ' }),
  section('UIThing', { textAlignment: 'TOP,BOTTOM' }),
  section('UIThing', { textAlignment: 'CENTER, BOTTOM' }),
  section('UIThing', { textAlignment: 'TOP,' }),
  section('UIThing', { textAlignment: 'TOP,sideways' }),
  section('UIThing', { textAlignment: '0,1' }),
  section('UIThing', { textAlignment: '+2' }),
  section('UIThing', { richText: 'true' }),
  section('UIThing', { richText: 'garbage' }),
  section('UIThing', { size: 'bad' }),

  // ---- Spawn -------------------------------------------------------------
  section('SpawnA', { monster: 'MonsterZombie MonsterGhoul' }),
  section('SpawnA', {
    monster: 'MonsterZombie',
    traits: 'undead',
    traitpool: 'a b',
    placement0: 'MPlaceA',
    placement1: 'MPlaceB MPlaceC',
    unique: 'true',
    activated: 'true',
    uniquehealth: '5.5',
    uniquehealthhero: '1.5',
  }),
  section('SpawnA', {}, { maxHeroes: 6, defaultHeroes: 6 }),
  section('SpawnA', { placement3: 'X' }),

  // ---- MPlace / Puzzle / QItem / CustomMonster / Activation --------------
  section('MPlaceA', {}),
  section('MPlaceA', { master: 'true', rotate: 'true', tokensize: 'big' }),
  section('PuzzleA', {}),
  section('PuzzleA', {
    class: 'code',
    image: 'a\\b.png',
    fadespeed: 'fast',
    skill: '{lore}',
    puzzlelevel: '6',
    puzzlealtlevel: '2',
    puzzlesolution: '1234',
  }),
  section('QItemA', {}),
  section('QItemA', {
    itemname: 'ItemA ItemB',
    starting: 'false',
    traits: 'weapon',
    inspect: 'EventX',
  }),
  section('CustomMonsterA', {}),
  section('CustomMonsterA', {
    base: 'MonsterZombie',
    traits: 'undead massive',
    image: 'a\\b.png',
    imageplace: 'c.png',
    activation: 'ActA ActB',
    health: '5',
    healthperhero: '2',
    evadeevent: 'EventE',
    horrorevent: 'EventH',
    horror: '3',
    awareness: '2',
    attacks: 'melee:3 ranged',
  }),
  section('CustomMonsterA', { attacks: 'melee:0' }),
  section('CustomMonsterA', { attacks: 'melee:bad' }),
  section('ActivationA', {}),
  section('ActivationA', { minionfirst: 'true', masterfirst: 'true' }),

  // ---- StartingItem rename ----------------------------------------------
  section('StartingItemA', { itemname: 'ItemX' }),

  // ---- unclaimed ---------------------------------------------------------
  section('SomethingElse', { x: '1' }),
]

// ---- VarTests ------------------------------------------------------------
corpus.push(
  varTests('single', ['VarOperation:$a,>,1']),
  varTests('and', ['VarOperation:$a,>,1', 'VarTestsLogicalOperator:AND', 'VarOperation:$b,<,2']),
  varTests('parens', ['VarTestsParenthesis:(', 'VarOperation:$a,>,1', 'VarTestsParenthesis:)']),
  varTests('unknown-kind', ['Nonsense:x']),
  varTests('malformed-operation', ['VarOperation:$a,>']),
  varTests('empty-value', ['VarOperation:,,']),
  varTests('fire-rename', ['VarOperation:#fire,=,1']),
  varTests(
    'find-closing',
    ['VarTestsParenthesis:(', 'VarOperation:$a,>,1', 'VarTestsParenthesis:)'],
    { findClosing: 0 },
  ),
  varTests(
    'find-closing-nested',
    [
      'VarTestsParenthesis:(',
      'VarTestsParenthesis:(',
      'VarOperation:$a,>,1',
      'VarTestsParenthesis:)',
      'VarTestsParenthesis:)',
    ],
    { findClosing: 0 },
  ),
  varTests(
    'find-opening',
    ['VarTestsParenthesis:(', 'VarOperation:$a,>,1', 'VarTestsParenthesis:)'],
    { findOpening: 2 },
  ),
  varTests('find-closing-missing', ['VarTestsParenthesis:('], { findClosing: 0 }),
  varTests('find-closing-oob', ['VarOperation:$a,>,1'], { findClosing: 5 }),
  varTests(
    'remove-with-operator-before',
    ['VarOperation:$a,>,1', 'VarTestsLogicalOperator:AND', 'VarOperation:$b,<,2'],
    { remove: 2 },
  ),
  varTests(
    'remove-with-operator-after',
    ['VarOperation:$a,>,1', 'VarTestsLogicalOperator:AND', 'VarOperation:$b,<,2'],
    { remove: 0 },
  ),
  varTests('remove-only', ['VarOperation:$a,>,1'], { remove: 0 }),
  varTests(
    'remove-parenthesis-open',
    ['VarTestsParenthesis:(', 'VarOperation:$a,>,1', 'VarTestsParenthesis:)'],
    { remove: 0 },
  ),
  varTests(
    'remove-parenthesis-close',
    ['VarTestsParenthesis:(', 'VarOperation:$a,>,1', 'VarTestsParenthesis:)'],
    { remove: 2 },
  ),
  varTests(
    'next-position-op-up',
    ['VarOperation:$a,>,1', 'VarTestsLogicalOperator:AND', 'VarOperation:$b,<,2'],
    { nextPos: 2, up: true },
  ),
  varTests(
    'next-position-op-down',
    ['VarOperation:$a,>,1', 'VarTestsLogicalOperator:AND', 'VarOperation:$b,<,2'],
    { nextPos: 0, up: false },
  ),
  varTests(
    'move-op-up',
    ['VarOperation:$a,>,1', 'VarTestsLogicalOperator:AND', 'VarOperation:$b,<,2'],
    { move: 2, up: true },
  ),
  varTests(
    'move-op-down',
    ['VarOperation:$a,>,1', 'VarTestsLogicalOperator:AND', 'VarOperation:$b,<,2'],
    { move: 0, up: false },
  ),
)

// ---- Buttons -------------------------------------------------------------
corpus.push(
  button('plain', {}),
  button('with-label', { button1: 'Continue' }),
  button('label-key', { button1: '{qst:MY_LABEL}' }),
  button('event-names', { event1: 'EventA EventB' }),
  button('event-with-condition', { event1: 'EventA,$a,>,1' }),
  button('event-with-action', { event1: 'EventA,$a,>,1,hide' }),
  button('event-with-bad-action', { event1: 'EventA,$a,>,1,nonsense' }),
  button('event-partial-condition', { event1: 'EventA,$a,>' }),
  button('empty-event', { event1: '' }),
  button('separate-condition', { event1: 'EventA', event1Condition: 'VarOperation:$a,>,1' }),
  button('separate-condition-action', {
    event1: 'EventA',
    event1Condition: 'VarOperation:$a,>,1',
    event1ConditionAction: 'HIDE',
  }),
  button('blank-condition', { event1: 'EventA', event1Condition: '   ' }),
  button('color', { event1: 'EventA', buttoncolor1: 'red' }),
  button('position-2', { event2: 'EventB', button2: 'Second' }, 2),
)

// ---- Quest metadata ------------------------------------------------------
corpus.push(
  quest('minimal', { format: '21' }),
  quest('too-old', { format: '3' }),
  quest('too-new', { format: '99' }),
  quest('no-format', {}),
  quest('full', {
    format: '21',
    type: 'D2E',
    packs: 'base MoM1E FA CotW extra',
    defaultlanguage: 'German',
    defaultmusicon: 'false',
    hidden: 'true',
    minhero: '1',
    maxhero: '3',
    difficulty: '0.75',
    lengthmin: '30',
    lengthmax: '90',
    image: 'a\\b.png',
    version: '1.2.3',
  }),
  quest('minhero-clamped', { format: '21', minhero: '0' }),
  quest('maxhero-clamped', { format: '21', maxhero: '99' }),
  quest('difficulty-comma', { format: '21', difficulty: '0,5' }),
  quest('languages', {
    format: '21',
    defaultlanguage: 'English',
    'name.English': 'A Quest',
    'name.German': 'Eine Quest',
    'synopsys.English': 'Short',
    'synopsys.German': 'Kurz',
    'authors_short.English': 'Me',
  }),
  quest('languages-missing-default', {
    format: '21',
    defaultlanguage: 'English',
    'name.German': 'Eine Quest',
  }),
  quest('conversion-kit', { format: '16' }, { identifier: 'HolyMansion', isMoM: true }),
  quest(
    'conversion-kit-newer-format',
    { format: '17' },
    { identifier: 'HolyMansion', isMoM: true },
  ),
  quest('conversion-kit-not-mom', { format: '16' }, { identifier: 'HolyMansion', isMoM: false }),
)

// ---- Whole-ini loads -----------------------------------------------------
corpus.push(
  {
    name: 'loadIni:mixed',
    kind: 'loadIni',
    format: 21,
    lines: [
      '[EventStart]',
      'text=Hello',
      'buttons=1',
      'event1=EventNext',
      '[TileRoom1]',
      'side=TileSide1',
      '[TokenSearch1]',
      'type=TokenSearch',
      '[SpawnGoblins]',
      'monster=MonsterGoblin',
      '[MPlaceA]',
      'master=true',
      '[UnknownSection]',
      'x=1',
    ],
  },
  {
    name: 'loadIni:duplicate-section',
    kind: 'loadIni',
    format: 21,
    lines: ['[EventA]', 'text=1', '[EventA]', 'text=2'],
  },
)
