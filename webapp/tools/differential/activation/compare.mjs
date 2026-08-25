/**
 * Differential runner for `Quest.ActivationInstance`.
 *
 * Compiles the class sliced out of the real `Quest.cs` — together with the
 * extracted `OutputSymbolReplace` and the real `StringKey` / localization —
 * and compares it against the port. This is where activation text becomes
 * what the player reads, and the order of the steps is the part that is easy
 * to get wrong: translate, then `{0}`, then symbols, then newlines.
 *
 *   node compare.mjs [fuzzCount] [seed]
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ActivationInstance } from '../../../packages/core/src/quest/ActivationInstance.ts'
import { StringKey } from '../../../packages/core/src/i18n/StringKey.ts'
import { DictionaryI18n } from '../../../packages/core/src/i18n/DictionaryI18n.ts'
import { Localization } from '../../../packages/core/src/i18n/Localization.ts'
import { VarManager } from '../../../packages/core/src/quest/VarManager.ts'

const here = dirname(fileURLToPath(import.meta.url))
const fuzzCount = Number(process.argv[2] ?? 2000)
const seed0 = Number(process.argv[3] ?? 1)

const MARKERS = ['{heart}', '{fatigue}', '{might}', '{will}', '{action}', '{knowledge}']

function curated() {
  const cases = []
  const add = (name, body) => cases.push({ name, monsterName: 'Zombie', ...body })

  add('plain minion and master', { minion: 'Attack the nearest.', master: 'Attack twice.' })
  add('empty everywhere', { minion: '', master: '', ability: '', move: '' })
  add('monster name substitution', {
    ability: 'The {0} lurches forward.',
    minion: '{0} attacks.',
    master: '{0} attacks twice.',
    move: '{0} moves one space.',
  })
  add('substitution happens more than once', { minion: '{0} and {0} and {0}' })
  add('escaped newlines become real ones', {
    ability: 'Line one\\nLine two',
    move: 'Move one\\nMove two',
  })
  add('minion and master keep their escapes', {
    minion: 'Minion\\nsecond',
    master: 'Master\\nsecond',
  })
  // A literal StringKey unescapes during `Translate`, so the unescape *after*
  // symbol replacement is only reachable through a dictionary value. Without
  // these the step could be deleted and nothing would notice — a mutation test
  // showed exactly that.
  add('dictionary move carries escaped newlines', {
    move: '{val:MOVE}',
    dictionary: { MOVE: 'Move one\\nMove two' },
  })
  add('dictionary ability carries escaped newlines', {
    ability: '{val:ABILITY}',
    dictionary: { ABILITY: 'Line one\\nLine two' },
  })
  add('dictionary move with a marker and an escape', {
    move: '{val:MOVE}',
    dictionary: { MOVE: 'Spend {heart}\\nthen move' },
  })
  add('dictionary actions carry escaped newlines', {
    minion: '{val:MINION}',
    master: '{val:MASTER}',
    dictionary: { MINION: 'Minion\\nsecond', MASTER: 'Master\\nsecond' },
  })
  add('D2E dictionary ability carries escaped newlines', {
    gameType: 'D2E',
    ability: '{val:ABILITY}',
    heroName: 'Syrus',
    dictionary: { ABILITY: '{0} flees\\nfrom the {1}' },
  })

  for (const marker of MARKERS) {
    add(`marker ${marker} in ability`, { ability: `Spend ${marker}` })
    add(`marker ${marker} in actions`, { minion: `Spend ${marker}`, master: `Take ${marker}` })
    add(`marker ${marker} in move`, { move: `Move for ${marker}` })
  }

  add('variable in ability', { ability: 'Doom is {var:$doom}', vars: { $doom: 3 } })
  add('variable in actions', { minion: 'Gold {var:$g}', master: 'Gold {var:$g}', vars: { $g: 7 } })
  add('variable in move', { move: 'Move {var:$m}', vars: { $m: 2 } })
  add('unset variable reads zero', { minion: 'Value {var:$missing}' })

  // Descent puts a random hero in {0} and the monster in {1}; Mansions uses
  // {0} for the monster and has no hero at all.
  add('D2E ability names a hero', {
    gameType: 'D2E',
    ability: '{0} is attacked by the {1}.',
    heroName: 'Syrus',
  })
  add('D2E ignores move entirely', {
    gameType: 'D2E',
    move: 'This should never be read',
    heroName: 'Syrus',
  })
  add('D2E actions still substitute the monster', {
    gameType: 'D2E',
    minion: '{0} attacks',
    master: '{0} attacks',
    heroName: 'Syrus',
  })
  add('MoM ability uses the monster, not a hero', {
    ability: '{0} advances. {1} is ignored.',
    heroName: 'Syrus',
  })

  // Translated keys rather than literals.
  add('translated ability', {
    ability: '{val:ABILITY}',
    dictionary: { ABILITY: 'The {0} howls.' },
  })
  add('translated actions', {
    minion: '{val:MINION}',
    master: '{val:MASTER}',
    dictionary: { MINION: 'Minion: {0}', MASTER: 'Master: {0}' },
  })
  add('translated text carrying a marker and a variable', {
    ability: '{val:ABILITY}',
    dictionary: { ABILITY: 'Spend {heart} when doom is {var:$doom}' },
    vars: { $doom: 5 },
  })
  add('missing key falls through', { ability: '{val:NOPE}', dictionary: { OTHER: 'x' } })
  // Substitution happens *before* symbol replacement, so a marker arriving via
  // the monster or hero name still becomes a glyph. `{heart}` is only mapped in
  // Descent and `{will}` only in Mansions, so each game type needs its own
  // marker for these to bite.
  add('monster name containing a Mansions marker', {
    monsterName: '{will}',
    ability: 'The {0} moves.',
    minion: '{0} strikes',
    move: '{0} advances',
  })
  add('hero name containing a Descent marker', {
    gameType: 'D2E',
    heroName: '{heart}',
    ability: '{0} faces the {1}.',
  })
  add('monster name containing a Descent marker', {
    gameType: 'D2E',
    monsterName: '{heart}',
    ability: '{0} faces the {1}.',
    heroName: 'Syrus',
  })
  // The unescape after symbol replacement is only reachable through a name:
  // both a literal key and a dictionary value have already been unescaped by
  // the time `Translate` returns.
  add('monster name containing an escaped newline', {
    monsterName: 'Zom\\nbie',
    ability: 'The {0} moves.',
    move: '{0} advances',
  })
  add('hero name containing an escaped newline', {
    gameType: 'D2E',
    heroName: 'Sy\\nrus',
    ability: '{0} flees.',
  })
  add('monster name containing a marker', { monsterName: '{heart}', ability: 'The {0} moves.' })
  add('monster name containing a brace', { monsterName: '{0}', minion: '{0} attacks' })

  return cases
}

function fuzz(count, seed) {
  let state = seed >>> 0
  const rnd = () => (state = (state * 1664525 + 1013904223) >>> 0) / 0x100000000
  const pick = (a) => a[Math.floor(rnd() * a.length)]
  const chance = (p) => rnd() < p

  const FRAGMENTS = [
    '',
    '{0}',
    '{1}',
    'attacks',
    '{heart}',
    '{fatigue}',
    '{var:$doom}',
    '{var:$missing}',
    '\\n',
    '\n',
    '{',
    '}',
    '{var:',
    'text with spaces',
    '{val:KEY}',
  ]

  const text = () => {
    let out = ''
    for (let i = 0; i < Math.floor(rnd() * 4); i++)
      out += pick(FRAGMENTS) + (chance(0.5) ? ' ' : '')
    return out
  }

  const cases = []
  for (let i = 0; i < count; i++) {
    cases.push({
      name: `fuzz/${i}`,
      gameType: chance(0.5) ? 'MoM' : 'D2E',
      monsterName: pick([
        'Zombie',
        'Cultist',
        '{0}',
        '{heart}',
        '{will}',
        'Zom\\nbie',
        '',
        'Hound of Tindalos',
      ]),
      heroName: pick(['Syrus', 'Ashcan Pete', '{0}', '{heart}', 'Sy\\nrus', '']),
      ability: text(),
      minion: text(),
      master: text(),
      move: chance(0.25) ? '{val:KEY}' : text(),
      moveButton: text(),
      vars: chance(0.5) ? { $doom: Math.floor(rnd() * 10) - 3 } : {},
      dictionary: chance(0.6) ? { KEY: text() } : null,
    })
  }
  return cases
}

/** A quest ini's inline text is a literal; `{val:KEY}` is a reference. */
function key(text, localization) {
  if (text === undefined || text === null) return StringKey.NULL
  if (text.startsWith('{') && text.endsWith('}')) return StringKey.parse(text, localization)
  return new StringKey(null, text, false)
}

function runTs(cases) {
  return cases.map((c) => {
    const result = { name: c.name }
    try {
      const localization = new Localization()
      if (c.dictionary) {
        const lines = ['.,English']
        for (const [k, v] of Object.entries(c.dictionary)) lines.push(`${k},${v}`)
        localization.addDictionary('val', new DictionaryI18n(lines))
      }

      const vars = new VarManager()
      for (const [k, v] of Object.entries(c.vars ?? {})) vars.setValue(k, v)

      const view = {
        sectionName: c.section ?? 'MonsterActivationX',
        ability: key(c.ability, localization),
        minionActions: key(c.minion, localization),
        masterActions: key(c.master, localization),
        moveButton: key(c.moveButton, localization),
        move: key(c.move, localization),
        minionFirst: false,
        masterFirst: false,
      }

      const instance = new ActivationInstance(view, {
        monsterName: c.monsterName,
        gameType: c.gameType === 'D2E' ? 'D2E' : 'MoM',
        vars,
        localization,
        randomHeroName: () => key(c.heroName, localization).translate({ localization }),
      })

      result.ok = true
      result.effect = instance.effect
      result.move = instance.move
      result.minionActions = instance.minionActions
      result.masterActions = instance.masterActions
      result.section = instance.ad.sectionName
    } catch (error) {
      result.ok = false
      result.error = error?.constructor?.name ?? 'Error'
    }
    return result
  })
}

const work = join(here, '.work')
mkdirSync(work, { recursive: true })

const cases = [...curated(), ...fuzz(fuzzCount, seed0)]
const corpusPath = join(work, 'corpus.json')
writeFileSync(corpusPath, JSON.stringify(cases))

execFileSync('node', [join(here, 'extract.mjs')], { stdio: 'ignore' })
execFileSync('node', [join(here, '../symbols/extract.mjs')], { stdio: 'ignore' })
execFileSync('cp', [join(here, '../symbols/Extracted.cs'), join(here, 'Symbols.cs')])
execFileSync('dotnet', ['build', join(here, 'activationharness.csproj'), '-v', 'q', '--nologo'], {
  stdio: 'ignore',
})

const bin = execFileSync('find', [join(here, 'bin'), '-name', 'activationharness', '-type', 'f'], {
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean)[0]

const cs = JSON.parse(execFileSync(bin, [corpusPath], { encoding: 'utf8', maxBuffer: 1 << 28 }))
const ts = runTs(cases)

const FIELDS = ['ok', 'error', 'effect', 'move', 'minionActions', 'masterActions', 'section']
const j = (v) => JSON.stringify(v ?? null)
const diffs = []
let d2eMoveNull = 0
for (let i = 0; i < cs.length; i++) {
  let bad = FIELDS.filter((f) => j(cs[i][f]) !== j(ts[i][f]))
  // Descent never assigns `move`, so the C# leaves it null while the port
  // leaves it empty. Only Mansions reads the field, so nothing observes the
  // difference — but a null there is a crash waiting for a Descent dialog that
  // ever does. Counted, not hidden.
  if (
    bad.includes('move') &&
    cases[i].gameType === 'D2E' &&
    cs[i].move === null &&
    ts[i].move === ''
  ) {
    bad = bad.filter((f) => f !== 'move')
    d2eMoveNull++
  }
  if (bad.length > 0) diffs.push({ name: cs[i].name, bad, a: cs[i], b: ts[i] })
}

console.log(
  `activation: ${cases.length} cases, ${diffs.length} real divergences` +
    `, ${d2eMoveNull} where D2E leaves move null and the port leaves it empty`,
)
for (const d of diffs.slice(0, 5)) {
  console.log(`### ${d.name}  [${d.bad.join(', ')}]`)
  for (const f of d.bad) {
    console.log(`    C# ${f}: ${j(d.a[f])}`)
    console.log(`    TS ${f}: ${j(d.b[f])}`)
  }
}
process.exit(diffs.length === 0 ? 0 : 1)
