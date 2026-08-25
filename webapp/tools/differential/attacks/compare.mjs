/**
 * Differential runner for investigator attack selection.
 *
 * Compiles `GetAttackTypes`, `GetRandomAttack` and the `QuestMonster` override
 * sliced out of the real sources, and compares them against the port. These
 * two calls are all `InvestigatorAttack.cs` does: which buttons the dialog
 * offers, and which line of text pressing one produces.
 *
 *   node compare.mjs [fuzzCount] [seed]
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { StringKey } from '../../../packages/core/src/i18n/StringKey.ts'
import { setLogSink } from '../../../packages/core/src/ini/logger.ts'
import { attackTypes, randomAttack } from '../../../packages/core/src/quest/monsterAttacks.ts'

const here = dirname(fileURLToPath(import.meta.url))
const fuzzCount = Number(process.argv[2] ?? 2000)
const seed0 = Number(process.argv[3] ?? 11)

const attack = (target, attackType, text) => ({
  section: `Attack${target}${attackType}`,
  target,
  attackType,
  text,
})

function curated() {
  const cases = []
  const add = (name, body) =>
    cases.push({ name, type: 'MonsterZombie', traits: ['human'], random: [0], ...body })

  const HUMAN_HEAVY = attack('human', 'heavy', 'You strike the {0} hard.')
  const HUMAN_LIGHT = attack('human', 'unarmed', 'You swing at the {0}.')
  const SPIRIT_HEAVY = attack('spirit', 'heavy', 'Your blow passes through.')

  add('one trait, one attack', { attacks: [HUMAN_HEAVY], attackType: 'heavy' })
  add('no attacks at all', { attacks: [], attackType: 'heavy' })
  add('no traits means no buttons', { traits: [], attacks: [HUMAN_HEAVY] })
  add('trait that matches nothing', { traits: ['ghost'], attacks: [HUMAN_HEAVY] })
  add('two types from one trait', {
    attacks: [HUMAN_HEAVY, HUMAN_LIGHT],
    attackType: 'unarmed',
  })
  add('duplicate types collapse', {
    attacks: [HUMAN_HEAVY, attack('human', 'heavy', 'second')],
    attackType: 'heavy',
  })
  add('button order follows the content order', {
    attacks: [HUMAN_LIGHT, HUMAN_HEAVY],
  })
  add('two traits gather both', {
    traits: ['human', 'spirit'],
    attacks: [HUMAN_HEAVY, SPIRIT_HEAVY, HUMAN_LIGHT],
  })
  add('draws among matching attacks', {
    attacks: [HUMAN_HEAVY, attack('human', 'heavy', 'second')],
    attackType: 'heavy',
    random: [1],
  })
  add('other traits are filtered out of the draw', {
    traits: ['human'],
    attacks: [SPIRIT_HEAVY, HUMAN_HEAVY],
    attackType: 'heavy',
  })
  add('a type with no matching attack', {
    traits: ['human'],
    attacks: [HUMAN_HEAVY],
    attackType: 'bite',
  })

  // A quest monster's own text replaces content entirely for that type.
  add('quest monster overrides a type', {
    quest: true,
    attacks: [HUMAN_HEAVY],
    investigatorAttacks: { heavy: ['The {0} recoils.'] },
    attackType: 'heavy',
  })
  add('quest monster draws among its own text', {
    quest: true,
    attacks: [HUMAN_HEAVY],
    investigatorAttacks: { heavy: ['first', 'second'] },
    attackType: 'heavy',
    random: [1],
  })
  add('quest monster falls through for other types', {
    quest: true,
    attacks: [HUMAN_HEAVY, HUMAN_LIGHT],
    investigatorAttacks: { heavy: ['own'] },
    attackType: 'unarmed',
  })
  add('quest monster registering a type with no text', {
    // `attacks=heavy:0` in a scenario reaches this. The C# indexes an empty
    // list and dies.
    quest: true,
    attacks: [HUMAN_HEAVY],
    investigatorAttacks: { heavy: [] },
    attackType: 'heavy',
  })
  add('quest monster with no overrides at all', {
    quest: true,
    attacks: [HUMAN_HEAVY],
    investigatorAttacks: {},
    attackType: 'heavy',
  })

  return cases
}

function fuzz(count, seed) {
  let state = seed >>> 0
  const rnd = () => (state = (state * 1664525 + 1013904223) >>> 0) / 0x100000000
  const pick = (a) => a[Math.floor(rnd() * a.length)]
  const int = (max) => Math.floor(rnd() * max)
  const chance = (p) => rnd() < p

  const TARGETS = ['human', 'spirit', 'beast', '']
  const TYPES = ['heavy', 'unarmed', 'fire', '']
  const cases = []

  for (let i = 0; i < count; i++) {
    const attacks = []
    for (let a = 0; a < int(5); a++) {
      attacks.push(attack(pick(TARGETS), pick(TYPES), pick(['hit', 'The {0} reels', ''])))
    }
    const quest = chance(0.4)
    const overrides = {}
    if (quest) {
      for (const type of TYPES) {
        if (!chance(0.35)) continue
        const texts = []
        for (let t = 0; t < int(3); t++) texts.push(pick(['own', 'The {0} flinches']))
        overrides[type] = texts
      }
    }
    const traits = []
    for (let t = 0; t < int(3); t++) traits.push(pick(TARGETS))

    cases.push({
      name: `fuzz/${i}`,
      type: 'MonsterZombie',
      quest,
      traits,
      attacks,
      investigatorAttacks: overrides,
      attackType: pick(TYPES),
      random: [int(5), int(5)],
    })
  }
  return cases
}

function runTs(cases) {
  return cases.map((c) => {
    const trace = []
    const result = { name: c.name }
    setLogSink((message) => trace.push(`debug:${message}`))
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

      const attacks = (c.attacks ?? []).map((a) => ({
        target: a.target,
        attackType: a.attackType,
        text: new StringKey(null, a.text, false),
      }))

      const monster = {
        traits: c.traits ?? [],
        ...(c.quest === true
          ? {
              investigatorAttacks: new Map(
                Object.entries(c.investigatorAttacks ?? {}).map(([type, texts]) => [
                  type,
                  texts.map((t) => new StringKey(null, t, false)),
                ]),
              ),
            }
          : {}),
      }

      result.ok = true
      result.types = attackTypes(monster, attacks)
      if (c.attackType !== undefined) {
        const text = randomAttack(monster, c.attackType, attacks, random)
        result.attack = text === null ? null : text.fullKey
      }
    } catch (error) {
      result.ok = false
      result.error = error?.constructor?.name ?? 'Error'
    } finally {
      setLogSink(null)
    }
    result.trace = trace
    return result
  })
}

const work = join(here, '.work')
mkdirSync(work, { recursive: true })

const cases = [...curated(), ...fuzz(fuzzCount, seed0)]
const corpusPath = join(work, 'corpus.json')
writeFileSync(corpusPath, JSON.stringify(cases))

execFileSync('node', [join(here, 'extract.mjs')], { stdio: 'ignore' })
execFileSync('dotnet', ['build', join(here, 'attacksharness.csproj'), '-v', 'q', '--nologo'], {
  stdio: 'ignore',
})
const bin = execFileSync('find', [join(here, 'bin'), '-name', 'attacksharness', '-type', 'f'], {
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean)[0]

const cs = JSON.parse(execFileSync(bin, [corpusPath], { encoding: 'utf8', maxBuffer: 1 << 28 }))
const ts = runTs(cases)

const FIELDS = ['ok', 'types', 'attack', 'trace']
const j = (v) => JSON.stringify(v ?? null)
const diffs = []
let crashes = 0
for (let i = 0; i < cs.length; i++) {
  // The C# indexes an empty result list and dies; the port returns null. A
  // documented deviation, counted rather than hidden.
  if (cs[i].error === 'ArgumentOutOfRangeException' && ts[i].attack === null) {
    crashes++
    continue
  }
  const bad = FIELDS.filter((f) => j(cs[i][f]) !== j(ts[i][f]))
  if (bad.length > 0) diffs.push({ name: cs[i].name, bad, a: cs[i], b: ts[i] })
}

console.log(
  `attacks: ${cases.length} cases, ${diffs.length} real divergences` +
    `, ${crashes} where the C# crashed on an empty attack list`,
)
for (const d of diffs.slice(0, 5)) {
  console.log(`### ${d.name}  [${d.bad.join(', ')}]`)
  for (const f of d.bad) {
    console.log(`    C# ${f}: ${j(d.a[f])}`)
    console.log(`    TS ${f}: ${j(d.b[f])}`)
  }
}
process.exit(diffs.length === 0 ? 0 : 1)
