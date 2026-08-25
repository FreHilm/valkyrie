/**
 * Differential runner for evade and horror text selection.
 *
 * Compiles the real `InvestigatorEvade.cs` and `HorrorCheck.cs` unmodified
 * against UI shims. What is under test is the selection: which entry a monster
 * gets, what the fallback to a derived type does, when a custom event wins
 * instead, and when nothing is drawn at all.
 *
 *   node compare.mjs [fuzzCount] [seed]
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { StringKey } from '../../../packages/core/src/i18n/StringKey.ts'
import {
  customMonsterEvent,
  pickMonsterText,
} from '../../../packages/core/src/quest/monsterText.ts'

const here = dirname(fileURLToPath(import.meta.url))
const fuzzCount = Number(process.argv[2] ?? 2000)
const seed0 = Number(process.argv[3] ?? 7)

function curated() {
  const cases = []
  const add = (name, body) =>
    cases.push({
      name,
      kind: 'evade',
      type: 'MonsterZombie',
      monsterName: 'Zombie',
      random: [0],
      ...body,
    })

  const evade = (monster, text = `Evade the ${monster}`) => ({
    section: `Evade${monster}`,
    monster,
    text,
  })
  const horror = (monster, text = `Horror at the ${monster}`) => ({
    section: `Horror${monster}`,
    monster,
    text,
  })

  for (const kind of ['evade', 'horror']) {
    const entries = kind === 'evade' ? 'evades' : 'horrors'
    const make = kind === 'evade' ? evade : horror

    add(`${kind}/exact match`, { kind, [entries]: [make('Zombie')] })
    add(`${kind}/no match draws nothing`, { kind, [entries]: [make('Cultist')] })
    add(`${kind}/empty content draws nothing`, { kind, [entries]: [] })
    add(`${kind}/two matches pick the second`, {
      kind,
      [entries]: [make('Zombie', 'first'), make('Zombie', 'second')],
      random: [1],
    })
    add(`${kind}/substitutes the monster name`, {
      kind,
      [entries]: [make('Zombie', 'The {0} is upon you.')],
    })
    add(`${kind}/quest monster falls back to its derived type`, {
      kind,
      quest: true,
      type: 'MonsterCustomThing',
      derivedType: 'MonsterZombie',
      [entries]: [make('Zombie')],
    })
    add(`${kind}/derived fallback only when nothing matched`, {
      kind,
      quest: true,
      type: 'MonsterCustomThing',
      derivedType: 'MonsterZombie',
      [entries]: [make('CustomThing', 'own'), make('Zombie', 'derived')],
    })
    add(`${kind}/blank derived type is no fallback`, {
      kind,
      quest: true,
      type: 'MonsterCustomThing',
      derivedType: '   ',
      [entries]: [make('Zombie')],
    })
    add(`${kind}/absent derived type is no fallback`, {
      kind,
      quest: true,
      type: 'MonsterCustomThing',
      derivedType: '',
      [entries]: [make('Zombie')],
    })
    add(`${kind}/a content monster never falls back`, {
      kind,
      type: 'MonsterCustomThing',
      [entries]: [make('Zombie')],
    })
    add(`${kind}/prefix must match exactly`, {
      kind,
      type: 'MonsterZombie',
      [entries]: [make('Zomb'), make('ZombieLord')],
    })
    add(`${kind}/newlines are escaped into the log`, {
      kind,
      [entries]: [make('Zombie', 'Line one\nLine two')],
    })

    // The custom event short-circuits the whole selection.
    const eventField = kind === 'evade' ? 'evadeEvent' : 'horrorEvent'
    add(`${kind}/custom event wins over content text`, {
      kind,
      quest: true,
      [eventField]: 'EventCustom',
      questComponents: ['EventCustom'],
      [entries]: [make('Zombie')],
    })
    add(`${kind}/custom event naming a missing component falls through`, {
      kind,
      quest: true,
      [eventField]: 'EventMissing',
      questComponents: [],
      [entries]: [make('Zombie')],
    })
    add(`${kind}/no custom event named`, {
      kind,
      quest: true,
      [eventField]: '',
      questComponents: ['EventCustom'],
      [entries]: [make('Zombie')],
    })
  }

  // Evade greys out its Finished button when the monster is already dead.
  add('evade/finished disabled at full damage', {
    evades: [evade('Zombie')],
    healthBase: 2,
    damage: 2,
    heroes: 0,
  })
  add('evade/finished enabled below full damage', {
    evades: [evade('Zombie')],
    healthBase: 2,
    damage: 1,
    heroes: 0,
  })

  return cases
}

function fuzz(count, seed) {
  let state = seed >>> 0
  const rnd = () => (state = (state * 1664525 + 1013904223) >>> 0) / 0x100000000
  const pick = (a) => a[Math.floor(rnd() * a.length)]
  const int = (max) => Math.floor(rnd() * max)
  const chance = (p) => rnd() < p

  const MONSTERS = ['Zombie', 'Cultist', 'Zomb', 'ZombieLord', 'CustomThing', '']
  const cases = []

  for (let i = 0; i < count; i++) {
    const kind = chance(0.5) ? 'evade' : 'horror'
    const entries = []
    for (let e = 0; e < int(4); e++) {
      const monster = pick(MONSTERS)
      entries.push({
        section: `${kind}${monster}${e}`,
        monster,
        text: pick(['plain', 'The {0} is here', 'Line\nbreak', '{0}{0}', '']),
      })
    }
    const quest = chance(0.5)
    cases.push({
      name: `fuzz/${i}`,
      kind,
      quest,
      type: `Monster${pick(MONSTERS)}`,
      monsterName: pick(['Zombie', 'The Thing', '{0}', '']),
      derivedType: quest ? pick(['', '   ', 'MonsterZombie', 'MonsterCultist']) : '',
      evadeEvent: quest && chance(0.4) ? pick(['EventA', 'EventMissing', '']) : '',
      horrorEvent: quest && chance(0.4) ? pick(['EventA', 'EventMissing', '']) : '',
      questComponents: chance(0.6) ? ['EventA'] : [],
      evades: kind === 'evade' ? entries : [],
      horrors: kind === 'horror' ? entries : [],
      healthBase: int(4),
      damage: int(4),
      heroes: int(3),
      random: [int(5), int(5)],
    })
  }
  return cases
}

/** Mirrors what the C# dialogs do once the selection has been made. */
function runTs(cases) {
  return cases.map((c) => {
    const trace = []
    const result = { name: c.name }
    try {
      let cursor = 0
      const random = (count) => {
        const value = c.random?.[cursor] ?? 0
        cursor++
        if (count <= 0) return 0
        const picked = value % count
        trace.push(`random(${count})=${picked}`)
        return picked
      }

      const monster = {
        monsterName: c.type,
        spawnedBy: '',
        unique: false,
        health: 0,
        damage: c.damage ?? 0,
        activated: false,
        minionStarted: false,
        masterStarted: false,
        currentActivation: null,
      }
      const type =
        c.quest === true
          ? { sectionName: c.type, activations: [], derivedType: c.derivedType ?? '' }
          : { sectionName: c.type, activations: [] }

      const components = new Set(c.questComponents ?? [])
      const eventName =
        c.quest === true
          ? customMonsterEvent(
              (c.kind === 'evade' ? c.evadeEvent : c.horrorEvent) ?? '',
              components,
            )
          : null

      let monsterImage = null
      if (eventName !== null) {
        monsterImage = 'm1'
        trace.push(`queue:${eventName}`)
      } else {
        const entries = (c.kind === 'evade' ? c.evades : c.horrors).map((e) => ({
          monster: e.monster,
          text: new StringKey(null, e.text, false),
        }))
        const chosen = pickMonsterText(monster, type, entries, random)
        if (chosen !== null) {
          const text = chosen.text.translate().split('{0}').join(c.monsterName)
          if (c.kind === 'evade') {
            // Evade logs before drawing; horror draws before logging.
            trace.push(`log:${text.split('\n').join('\\n')}`)
            trace.push(`text:${text.split('\n').join('\\n')}`)
            const health = (c.healthBase ?? 0) + 0
            if ((c.damage ?? 0) === health) trace.push('key:FINISHED:grey')
            else {
              trace.push('key:FINISHED')
              trace.push('button')
            }
          } else {
            trace.push(`text:${text.split('\n').join('\\n')}`)
            trace.push(`log:${text.split('\n').join('\\n')}`)
            trace.push('key:FINISHED')
            trace.push('button')
          }
        }
      }

      result.ok = true
      result.trace = trace
      result.monsterImage = monsterImage
    } catch (error) {
      result.ok = false
      result.error = error?.constructor?.name ?? 'Error'
      result.trace = trace
      result.monsterImage = null
    }
    return result
  })
}

const work = join(here, '.work')
mkdirSync(work, { recursive: true })

const cases = [...curated(), ...fuzz(fuzzCount, seed0)]
const corpusPath = join(work, 'corpus.json')
writeFileSync(corpusPath, JSON.stringify(cases))

execFileSync('dotnet', ['build', join(here, 'monstertextharness.csproj'), '-v', 'q', '--nologo'], {
  stdio: 'ignore',
})
const bin = execFileSync('find', [join(here, 'bin'), '-name', 'monstertextharness', '-type', 'f'], {
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean)[0]

const cs = JSON.parse(execFileSync(bin, [corpusPath], { encoding: 'utf8', maxBuffer: 1 << 28 }))
const ts = runTs(cases)

const FIELDS = ['ok', 'error', 'trace', 'monsterImage']
const j = (v) => JSON.stringify(v ?? null)
const diffs = []
for (let i = 0; i < cs.length; i++) {
  const bad = FIELDS.filter((f) => j(cs[i][f]) !== j(ts[i][f]))
  if (bad.length > 0) diffs.push({ name: cs[i].name, bad, a: cs[i], b: ts[i] })
}

console.log(`monstertext: ${cases.length} cases, ${diffs.length} real divergences`)
for (const d of diffs.slice(0, 5)) {
  console.log(`### ${d.name}  [${d.bad.join(', ')}]`)
  const a = d.a.trace ?? []
  const b = d.b.trace ?? []
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === b[i]) continue
    console.log(`    line ${i}:  C# ${a[i] ?? '(end)'}`)
    console.log(`              TS ${b[i] ?? '(end)'}`)
  }
  for (const f of d.bad.filter((x) => x !== 'trace')) {
    console.log(`    C# ${f}: ${j(d.a[f])}   TS ${f}: ${j(d.b[f])}`)
  }
}
process.exit(diffs.length === 0 ? 0 : 1)
