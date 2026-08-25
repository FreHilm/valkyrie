/** Shared differential corpus for the rules engine (VarManager + puzzles). */

const vars = (name, extra) => ({ name: `vars:${name}`, kind: 'vars', ...extra })
const test = (name, tests, extra = {}) => ({ name: `test:${name}`, kind: 'test', tests, ...extra })

export const corpus = [
  // ---- VarManager arithmetic --------------------------------------------
  vars('empty', {}),
  vars('set', { set: { $a: 5 } }),
  vars('assign', { ops: ['$a,=,5'] }),
  vars('add', { saved: { $a: '5' }, ops: ['$a,+,3'] }),
  vars('subtract', { saved: { $a: '5' }, ops: ['$a,-,3'] }),
  vars('multiply', { saved: { $a: '5' }, ops: ['$a,*,3'] }),
  vars('divide', { saved: { $a: '6' }, ops: ['$a,/,3'] }),
  vars('divide-by-zero', { saved: { $a: '6' }, ops: ['$a,/,0'] }),
  vars('modulus', { saved: { $a: '7' }, ops: ['$a,%,3'] }),
  vars('modulus-by-zero', { saved: { $a: '7' }, ops: ['$a,%,0'] }),
  vars('unknown-operation', { saved: { $a: '5' }, ops: ['$a,?,3'] }),
  vars('chain', { ops: ['$a,=,2', '$a,*,3', '$a,+,1'] }),
  vars('var-to-var', { saved: { $a: '2', $b: '7' }, ops: ['$a,=,$b'] }),
  vars('var-to-unknown-var', { saved: { $a: '2' }, ops: ['$a,=,$missing'] }),
  vars('readonly-hash-var', { saved: { '#x': '5' }, ops: ['#x,=,9'] }),
  vars('negative-literal', { ops: ['$a,=,-3'] }),
  vars('decimal-literal', { ops: ['$a,=,.5'] }),
  vars('comma-literal', { ops: ['$a,=,0,5'] }),
  vars('rand', { ops: ['$a,=,#rand6'], random: [3] }),
  vars('rand-zero', { ops: ['$a,=,#rand0'], random: [0] }),
  vars('rand-bad', { ops: ['$a,=,#randX'], random: [0] }),
  vars('get-missing', { get: '$nope' }),
  vars('get-present', { saved: { $a: '4' }, get: '$a' }),
  vars('prefix', { saved: { $a: '1', $ab: '2', b: '3' }, prefix: '$a' }),
  vars('escaped-hash-load', { saved: { '\\#x': '5' } }),
  vars('trim-quest', { saved: { '%camp': '1', '$%also': '2', $quest: '3', x: '4' }, trim: true }),
  vars('trim-single-char', { saved: { x: '1' }, trim: true }),
  vars('tostring-skips-zero', { saved: { $a: '0', $b: '2' } }),
  vars('tostring-escapes-hash', { saved: { '\\#x': '5' } }),

  // ---- VarManager.Test ---------------------------------------------------
  test('empty', []),
  test('eq-true', ['VarOperation:$a,==,1'], { saved: { $a: '1' } }),
  test('eq-false', ['VarOperation:$a,==,2'], { saved: { $a: '1' } }),
  test('neq', ['VarOperation:$a,!=,2'], { saved: { $a: '1' } }),
  test('gt', ['VarOperation:$a,>,0'], { saved: { $a: '1' } }),
  test('gte', ['VarOperation:$a,>=,1'], { saved: { $a: '1' } }),
  test('lt', ['VarOperation:$a,<,2'], { saved: { $a: '1' } }),
  test('lte', ['VarOperation:$a,<=,1'], { saved: { $a: '1' } }),
  test('unknown-operator', ['VarOperation:$a,?,1'], { saved: { $a: '1' } }),
  test('missing-var-defaults-zero', ['VarOperation:$nope,==,0']),
  test(
    'and-both-true',
    ['VarOperation:$a,==,1', 'VarTestsLogicalOperator:AND', 'VarOperation:$b,==,2'],
    {
      saved: { $a: '1', $b: '2' },
    },
  ),
  test(
    'and-one-false',
    ['VarOperation:$a,==,1', 'VarTestsLogicalOperator:AND', 'VarOperation:$b,==,9'],
    {
      saved: { $a: '1', $b: '2' },
    },
  ),
  test(
    'or-one-true',
    ['VarOperation:$a,==,9', 'VarTestsLogicalOperator:OR', 'VarOperation:$b,==,2'],
    {
      saved: { $a: '1', $b: '2' },
    },
  ),
  test(
    'or-both-false',
    ['VarOperation:$a,==,9', 'VarTestsLogicalOperator:OR', 'VarOperation:$b,==,9'],
    {
      saved: { $a: '1', $b: '2' },
    },
  ),
  test(
    'left-to-right-not-precedence',
    [
      'VarOperation:$a,==,9',
      'VarTestsLogicalOperator:OR',
      'VarOperation:$b,==,2',
      'VarTestsLogicalOperator:AND',
      'VarOperation:$c,==,9',
    ],
    { saved: { $a: '1', $b: '2', $c: '3' } },
  ),
  test(
    'parenthesised',
    [
      'VarOperation:$a,==,1',
      'VarTestsLogicalOperator:AND',
      'VarTestsParenthesis:(',
      'VarOperation:$b,==,9',
      'VarTestsLogicalOperator:OR',
      'VarOperation:$c,==,3',
      'VarTestsParenthesis:)',
    ],
    { saved: { $a: '1', $b: '2', $c: '3' } },
  ),
  test(
    'nested-parentheses',
    [
      'VarTestsParenthesis:(',
      'VarTestsParenthesis:(',
      'VarOperation:$a,==,1',
      'VarTestsParenthesis:)',
      'VarTestsParenthesis:)',
    ],
    { saved: { $a: '1' } },
  ),
  test('unbalanced-open', ['VarTestsParenthesis:(', 'VarOperation:$a,==,1'], {
    saved: { $a: '1' },
  }),
  test('leading-close', ['VarTestsParenthesis:)', 'VarOperation:$a,==,9'], { saved: { $a: '1' } }),
  test('operator-first', ['VarTestsLogicalOperator:OR', 'VarOperation:$a,==,9'], {
    saved: { $a: '1' },
  }),
  test('rand-in-test', ['VarOperation:$a,==,#rand3'], { saved: { $a: '1' }, random: [0] }),
]

// ---- PuzzleCode ----------------------------------------------------------
const code = (name, extra) => ({ name: `code:${name}`, kind: 'code', ...extra })

corpus.push(
  code('fixed-solution', { items: 4, options: 6, solution: '1 3 5 4' }),
  code('generated', { items: 4, options: 6, random: [0, 2, 4, 1] }),
  code('generated-longer', { items: 6, options: 3, random: [0, 1, 2, 0, 1, 2] }),
  code('saved', { saved: { answer: '1 2 3 4', guess: '1 2 3 4,4 3 2 1' } }),
  code('correct-guess', { items: 4, options: 6, solution: '1 2 3 4', guesses: [[1, 2, 3, 4]] }),
  code('wrong-guess', { items: 4, options: 6, solution: '1 2 3 4', guesses: [[4, 3, 2, 1]] }),
  code('partial-guess', { items: 4, options: 6, solution: '1 2 3 4', guesses: [[1, 3, 2, 5]] }),
  code('repeated-values', { items: 4, options: 6, solution: '1 1 2 2', guesses: [[2, 2, 1, 1]] }),
  code('last-guess-wins', {
    items: 4,
    options: 6,
    solution: '1 2 3 4',
    guesses: [
      [1, 2, 3, 4],
      [4, 3, 2, 1],
    ],
  }),
  code('no-guesses', { items: 4, options: 6, solution: '1 2 3 4' }),
)

// ---- PuzzleImage ---------------------------------------------------------
const image = (name, extra) => ({ name: `image:${name}`, kind: 'image', ...extra })

corpus.push(
  image('generated-2x2', { x: 2, y: 2, random: [0, 0, 1, 2] }),
  image('generated-3x3', { x: 3, y: 3, random: [0, 1, 0, 2, 1, 3, 0, 4, 2] }),
  image('saved-solved', { saved: { moves: '3', state: '0 0,0 0:0 1,0 1:1 0,1 0:1 1,1 1' } }),
  image('saved-unsolved', { saved: { moves: '1', state: '0 0,1 1:1 1,0 0' } }),
)

// ---- PuzzleSlide ---------------------------------------------------------
const HARD_CODED = {
  moves: '0',
  block0: 'False,1,0,0,2,True',
  block1: 'False,2,0,0,1,False',
  block2: 'True,0,1,5,0,False',
  block3: 'True,0,1,4,1,False',
  block4: 'False,3,0,0,5,False',
  block5: 'False,2,0,0,4,False',
  block6: 'False,1,0,2,0,False',
  block7: 'False,4,0,0,3,False',
  block8: 'True,0,1,5,2,False',
  block9: 'False,1,0,4,4,False',
}

corpus.push(
  { name: 'slide:hardcoded', kind: 'slide', saved: HARD_CODED },
  {
    name: 'slide:solved',
    kind: 'slide',
    saved: { moves: '12', block0: 'False,1,0,6,2,True' },
  },
  {
    name: 'slide:empty-checks',
    kind: 'slide',
    saved: HARD_CODED,
    empty: [
      [0, 0],
      [3, 3],
      [-1, 0],
      [0, -1],
      [0, 6],
      [6, 2],
      [6, 3],
      [8, 2],
      [7, 2],
      [5, 5],
    ],
  },
)

// ---- PuzzleTower ---------------------------------------------------------
const tower = (name, extra) => ({ name: `tower:${name}`, kind: 'tower', ...extra })

corpus.push(
  tower('saved-solved', { saved: { moves: '0', 0: '7 6 5 4 3 2 1 0', 1: '', 2: '' } }),
  tower('saved-partial', { saved: { moves: '2', 0: '7 6 5 4 3 2', 1: '1', 2: '0' } }),
  tower('saved-out-of-order', { saved: { moves: '0', 0: '0 1 2 3 4 5 6 7', 1: '', 2: '' } }),
  tower('generated-depth-1', { depth: 1, random: [0, 0, 0] }),
  tower('generated-depth-2', { depth: 2, random: [1, 1, 0] }),
  tower('generated-depth-3', { depth: 3, random: [2, 2, 1] }),
  tower('state-count-1', { saved: { moves: '0' }, countStates: 1 }),
  tower('state-count-2', { saved: { moves: '0' }, countStates: 2 }),
  tower('state-count-3', { saved: { moves: '0' }, countStates: 3 }),
  tower('state-count-4', { saved: { moves: '0' }, countStates: 4 }),
  tower('legal-move', {
    saved: { moves: '0', 0: '7 6 5', 1: '', 2: '' },
    moves: [[0, 1]],
  }),
  tower('illegal-move', {
    saved: { moves: '0', 0: '7 6 5', 1: '1', 2: '' },
    moves: [[0, 1]],
  }),
  tower('move-from-empty', {
    saved: { moves: '0', 0: '', 1: '3', 2: '' },
    moves: [[0, 1]],
  }),
  tower('move-out-of-range', {
    saved: { moves: '0', 0: '3', 1: '', 2: '' },
    moves: [[0, 9]],
  }),
)
