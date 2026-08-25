/** Shared differential corpus for the i18n port. */

const parseEntry = (name, entry) => ({ name, kind: 'parseEntry', entry })
const split3 = (input) => ({ name: `split3:${JSON.stringify(input)}`, kind: 'split3', input })
const addData = (name, blocks) => ({ name, kind: 'addData', blocks })
const stringKey = (input, dicts = ['ffg', 'val', 'qst']) => ({
  name: `stringKey:${JSON.stringify(input)}:${dicts.join('+') || 'none'}`,
  kind: 'stringKey',
  input,
  dicts,
})

const EN = (...lines) => ['.,English', ...lines]
const FR = (...lines) => ['.,French', ...lines]
const DE = (...lines) => ['.,German', ...lines]

export const corpus = [
  // ---- ParseEntry -------------------------------------------------------
  parseEntry('plain', 'simple value'),
  parseEntry('escaped-newline', 'line1\\nline2'),
  parseEntry('multiple-newlines', 'a\\nb\\nc'),
  parseEntry('quoted', '"quoted value"'),
  parseEntry('quoted-escaped-quotes', '"value with ""quotes"" inside"'),
  parseEntry('triple', '|||triple value|||'),
  parseEntry('triple-with-quotes', '|||has "quotes" inside|||'),
  parseEntry('triple-trailing-space', '|||value|||   '),
  parseEntry('empty-quoted', '""'),
  parseEntry('single-char', 'x'),
  parseEntry('empty', ''),
  parseEntry('one-quote', '"'),
  parseEntry('quote-then-newline', '"a\\nb"'),
  parseEntry('triple-then-quoted', '|||"quoted"|||'),
  parseEntry('quoted-inside-not-at-ends', 'a"b'),
  parseEntry('triple-too-short', '|||'),
  parseEntry('triple-exact', '||||||'),
  parseEntry('nested-triple', '|||a|||b|||'),
  parseEntry('newline-then-triple', '\\n|||x|||'),
  parseEntry('unbalanced-quote-start', '"abc'),
  parseEntry('unbalanced-quote-end', 'abc"'),
  parseEntry('quoted-with-comma', '"a,b"'),
  parseEntry('escaped-quote-only', '""""'),

  // ---- Split(":", 3, RemoveEmptyEntries) --------------------------------
  split3('val:KEY'),
  split3('val:KEY:{0}:x'),
  split3('val::KEY'),
  split3('val:'),
  split3(':val:KEY'),
  split3('val'),
  split3(''),
  split3(':::'),
  split3('a:b:c:d:e'),
  split3('a::b::c'),
  split3('::a'),

  // ---- StringKey parsing ------------------------------------------------
  stringKey('{val:KEY}'),
  stringKey('{ffg:MONSTER_NAME}'),
  stringKey('{qst:X:{0}:y}'),
  stringKey('{val:KEY:{0}:param}'),
  stringKey('plain text'),
  stringKey('{unknown:KEY}'),
  stringKey('{val:}'),
  stringKey('{val:KEY} trailing'),
  stringKey('leading {val:KEY}'),
  stringKey('{val:KEY}{val:OTHER}'),
  stringKey('{val:A:B}'),
  stringKey('{:KEY}'),
  stringKey('{}'),
  stringKey('{val:KEY'),
  stringKey('val:KEY}'),
  stringKey('{val:KEY}', []),
  stringKey('plain', []),
  stringKey('{val:KEY}', ['val']),

  // ---- AddData line assembly -------------------------------------------
  addData('single-line', [EN('KEY,value')]),
  addData('two-keys', [EN('A,1', 'B,2')]),
  addData('quoted-multiline', [EN('KEY,"line one', 'line two"', 'NEXT,plain')]),
  addData('triple-quoted', [EN('KEY,|||has "quotes"|||', 'NEXT,plain')]),
  addData('triple-multiline', [EN('KEY,|||line one', 'line two|||', 'NEXT,plain')]),
  addData('comment-line', [EN('//a comment', 'KEY,value')]),
  addData('crlf-lines', [EN('KEY,value\r', 'OTHER,x\r')]),
  addData('empty-value', [EN('KEY,')]),
  addData('key-only-no-comma', [EN('KEYONLY')]),
  addData('quoted-with-escaped-quotes', [EN('KEY,"say ""hi"" now"')]),
  addData('unterminated-quote-block', [EN('KEY,"never closed')]),
  addData('two-languages', [EN('KEY,english'), FR('KEY,french')]),
  addData('same-language-twice', [EN('A,1'), EN('B,2')]),
  addData('quoted-language-header', [['.,"English"', 'KEY,v']]),
  addData('header-with-spaces', [['.,Brazilian Portuguese', 'KEY,v']]),
  addData('blank-line-between', [EN('A,1', '', 'B,2')]),
  addData('value-with-quote-mid', [EN('KEY,a"b')]),
  addData('duplicate-key', [EN('KEY,first', 'KEY,second')]),
]

// ---- GetValue resolution ------------------------------------------------
const langBlocks = [
  EN('KEY,english value', 'ONLY_EN,en only', 'BLANK_ELSEWHERE,en fallback'),
  FR('KEY,French value', 'BLANK_ELSEWHERE,'),
  DE('KEY,German value'),
]

const getValue = (name, extra) => ({
  name,
  kind: 'getValue',
  blocks: langBlocks,
  key: 'KEY',
  ...extra,
})

corpus.push(
  getValue('current-present', { currentLanguage: 'French' }),
  getValue('current-missing-fallback-present', {
    currentLanguage: 'Ukrainian',
    fallbackLanguage: 'French',
  }),
  getValue('current-and-fallback-missing', {
    currentLanguage: 'Ukrainian',
    fallbackLanguage: 'Klingon',
  }),
  getValue('empty-fallback', { currentLanguage: 'Ukrainian', fallbackLanguage: '' }),
  getValue('fallback-same-as-current', {
    currentLanguage: 'French',
    fallbackLanguage: 'French',
  }),
  getValue('fallback-same-as-default', {
    currentLanguage: 'Ukrainian',
    fallbackLanguage: 'English',
  }),
  getValue('missing-key', { key: 'NOT_PRESENT', currentLanguage: 'English' }),
  getValue('blank-value-falls-through', {
    key: 'BLANK_ELSEWHERE',
    currentLanguage: 'French',
  }),
  getValue('only-in-english', { key: 'ONLY_EN', currentLanguage: 'German' }),
  getValue('group-second-language', {
    currentLanguage: 'English',
    group: { key: 'KEY', groupId: 'g1', language: 'French' },
  }),
  getValue('group-same-value', {
    currentLanguage: 'French',
    group: { key: 'KEY', groupId: 'g1', language: 'French' },
  }),
  getValue('group-blank-language', {
    currentLanguage: 'English',
    group: { key: 'KEY', groupId: 'g1', language: '  ' },
  }),
  getValue('extract-all', { currentLanguage: 'English', extractAll: true }),
  getValue('serialize-after-edit', { currentLanguage: 'English', serialize: true }),
)

// ---- DictLookup ---------------------------------------------------------
const lookupDicts = [
  { name: 'val', blocks: [EN('GREETING,Hello', 'NESTED,Say {val:GREETING}', 'PARAM,Hi {0}')] },
  { name: 'ffg', blocks: [EN('MONSTER,Zombie', 'MARKUP,[b]bold[/b] and [i]it[/i]')] },
  {
    name: 'qst',
    blocks: [EN('LOOP,{qst:LOOP}', 'UNCLOSED,[b]never closed', 'UNDERLINE,[u]u[/u]')],
  },
]

const lookup = (name, extra) => ({ name, kind: 'dictLookup', dicts: lookupDicts, ...extra })

corpus.push(
  lookup('simple', { dict: 'val', key: 'GREETING' }),
  lookup('nested', { dict: 'val', key: 'NESTED' }),
  lookup('missing-key', { dict: 'val', key: 'NOPE' }),
  lookup('missing-dict', { dict: 'zzz', key: 'GREETING' }),
  lookup('markup-bold-italic', { dict: 'ffg', key: 'MARKUP' }),
  lookup('markup-underline-becomes-bold', { dict: 'qst', key: 'UNDERLINE' }),
  lookup('unclosed-tag-gets-closed', { dict: 'qst', key: 'UNCLOSED' }),
  lookup('recursive-loop', { dict: 'qst', key: 'LOOP' }),
  lookup('raw-embedded', { raw: 'Prefix {val:GREETING} suffix' }),
  lookup('raw-plain', { raw: 'no keys here' }),
  lookup('raw-param', { raw: '{val:PARAM:{0}:World}' }),
  lookup('raw-two-keys', { raw: '{val:GREETING} and {ffg:MONSTER}' }),
  lookup('raw-escaped-newline', { raw: 'line1\\nline2' }),
)
