/**
 * Differential runner for monster selection.
 *
 * Compiles `AttemptMonsterMatch` and `RuntimeMonsterSelection` sliced out of
 * the real `Quest.cs` and compares them against the port. Which monster a
 * spawn places decides what a scenario actually throws at the players, and the
 * rules are subtle: required traits, a trait pool, exclusions, spawns that
 * reference other spawns, and a Descent-only pass that avoids repeating a type.
 *
 *   node compare.mjs [fuzzCount] [seed]
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { setLogSink } from '../../../packages/core/src/ini/logger.ts'
import { QuestLog } from '../../../packages/core/src/quest/QuestLog.ts'
import {
  attemptMonsterMatch,
  runtimeMonsterSelection,
} from '../../../packages/core/src/quest/monsterSelection.ts'

const here = dirname(fileURLToPath(import.meta.url))
const fuzzCount = Number(process.argv[2] ?? 2000)
const seed0 = Number(process.argv[3] ?? 17)

function curated() {
  const cases = []
  const add = (name, body) =>
    cases.push({
      name,
      gameType: 'MoM',
      spawn: 'SpawnA',
      random: [0],
      contentMonsters: { MonsterZombie: ['undead'], MonsterCultist: ['human'] },
      ...body,
    })

  // --- named types ---------------------------------------------------------
  add('names a content monster outright', { spawns: { SpawnA: { types: ['MonsterZombie'] } } })
  add('Monster prefix is optional', { spawns: { SpawnA: { types: ['Zombie'] } } })
  add('CustomMonster prefix is left alone', {
    spawns: { SpawnA: { types: ['CustomMonsterEdith'] } },
    questMonsters: { CustomMonsterEdith: { traits: ['human'] } },
  })
  add('unknown type matches nothing', { spawns: { SpawnA: { types: ['MonsterNope'] } } })
  add('tries each named type in order', {
    spawns: { SpawnA: { types: ['MonsterNope', 'MonsterCultist'] } },
  })
  add('a quest monster wins over content of the same name', {
    spawns: { SpawnA: { types: ['MonsterZombie'] } },
    questMonsters: { MonsterZombie: { traits: ['special'] } },
  })
  add('reuses another spawn’s choice', {
    spawns: { SpawnA: { types: ['SpawnB'] }, SpawnB: { types: ['MonsterZombie'] } },
    selected: { SpawnB: 'MonsterZombie' },
  })
  add('an unresolved spawn reference gives up', {
    spawns: { SpawnA: { types: ['SpawnB'] }, SpawnB: { types: ['MonsterZombie'] } },
  })
  add('an unresolved spawn reference gives up even with a later match', {
    // The abort has to happen at the reference: without it the loop falls
    // through and quietly places the wrong kind of monster.
    spawns: {
      SpawnA: { types: ['SpawnB', 'MonsterZombie'] },
      SpawnB: { types: ['MonsterCultist'] },
    },
  })
  add('already resolved returns immediately', {
    spawns: { SpawnA: { types: ['MonsterZombie'] } },
    selected: { SpawnA: 'MonsterCultist' },
  })
  add('no types at all', { spawns: { SpawnA: { types: [] } } })

  // --- traits --------------------------------------------------------------
  add('required trait narrows to one', {
    spawns: { SpawnA: { types: [], required: ['undead'] } },
  })
  add('required traits must all be present', {
    contentMonsters: { MonsterA: ['undead'], MonsterB: ['undead', 'huge'] },
    spawns: { SpawnA: { types: [], required: ['undead', 'huge'] } },
  })
  add('a pool needs only one hit', {
    contentMonsters: { MonsterA: ['undead'], MonsterB: ['human'] },
    spawns: { SpawnA: { types: [], pool: ['undead', 'human'] } },
    random: [1],
  })
  add('an empty pool imposes nothing', {
    spawns: { SpawnA: { types: [], required: ['undead'], pool: [] } },
  })
  add('no match at all reports an error', {
    spawns: { SpawnA: { types: [], required: ['nonexistent'] } },
  })
  add('named types become exclusions in the trait branch', {
    contentMonsters: { MonsterA: ['undead'], MonsterB: ['undead'] },
    spawns: { SpawnA: { types: ['MonsterA'], required: ['undead'] } },
  })
  add('an already-chosen spawn contributes its choice as an exclusion', {
    contentMonsters: { MonsterA: ['undead'], MonsterB: ['undead'] },
    spawns: { SpawnA: { types: ['SpawnB'], required: ['undead'] }, SpawnB: { types: [] } },
    selected: { SpawnB: 'MonsterA' },
  })
  add('force=false aborts on an unresolved spawn reference', {
    force: false,
    contentMonsters: { MonsterA: ['undead'] },
    spawns: { SpawnA: { types: ['SpawnB'], required: ['undead'] }, SpawnB: { types: [] } },
  })
  add('force=true treats it as a plain exclusion', {
    force: true,
    contentMonsters: { MonsterA: ['undead'] },
    spawns: { SpawnA: { types: ['SpawnB'], required: ['undead'] }, SpawnB: { types: [] } },
  })

  // --- quest monsters in the trait branch ----------------------------------
  add('a custom monster matches on its own traits', {
    contentMonsters: {},
    questMonsters: { CustomMonsterEdith: { traits: ['human'] } },
    spawns: { SpawnA: { types: [], required: ['human'] } },
  })
  add('a custom monster with no traits inherits its base type’s', {
    contentMonsters: { MonsterCultist: ['human', 'cultist'] },
    questMonsters: { CustomMonsterEdith: { traits: [], base: 'MonsterCultist' } },
    spawns: { SpawnA: { types: [], required: ['cultist'] } },
  })
  add('a custom monster with no traits and no base matches nothing', {
    contentMonsters: {},
    questMonsters: { CustomMonsterEdith: { traits: [], base: 'MonsterMissing' } },
    spawns: { SpawnA: { types: [], required: ['human'] } },
  })
  add('content and quest monsters are pooled together', {
    contentMonsters: { MonsterZombie: ['undead'] },
    questMonsters: { CustomMonsterGhoul: { traits: ['undead'] } },
    spawns: { SpawnA: { types: [], required: ['undead'] } },
    random: [1],
  })

  // --- Descent deduplication -----------------------------------------------
  add('D2E excludes a type already chosen elsewhere', {
    gameType: 'D2E',
    contentMonsters: { MonsterA: ['undead'], MonsterB: ['undead'] },
    spawns: { SpawnA: { types: [], required: ['undead'] } },
    selected: { SpawnOther: 'MonsterA' },
  })
  add('D2E excludes a type already on the board', {
    gameType: 'D2E',
    contentMonsters: { MonsterA: ['undead'], MonsterB: ['undead'] },
    spawns: { SpawnA: { types: [], required: ['undead'] } },
    onBoard: ['MonsterA'],
  })
  add('MoM allows a repeat', {
    gameType: 'MoM',
    contentMonsters: { MonsterA: ['undead'], MonsterB: ['undead'] },
    spawns: { SpawnA: { types: [], required: ['undead'] } },
    onBoard: ['MonsterA'],
    selected: { SpawnOther: 'MonsterA' },
  })
  add('D2E exclusions can leave nothing', {
    gameType: 'D2E',
    contentMonsters: { MonsterA: ['undead'] },
    spawns: { SpawnA: { types: [], required: ['undead'] } },
    onBoard: ['MonsterA'],
  })

  // --- through RuntimeMonsterSelection --------------------------------------
  add('runtime selection on a known spawn', {
    viaRuntime: true,
    spawns: { SpawnA: { types: ['MonsterZombie'] } },
  })
  add('runtime selection on an unknown spawn', {
    viaRuntime: true,
    spawn: 'SpawnMissing',
    spawns: { SpawnA: { types: ['MonsterZombie'] } },
  })

  return cases
}

function fuzz(count, seed) {
  let state = seed >>> 0
  const rnd = () => (state = (state * 1664525 + 1013904223) >>> 0) / 0x100000000
  const pick = (a) => a[Math.floor(rnd() * a.length)]
  const int = (max) => Math.floor(rnd() * max)
  const chance = (p) => rnd() < p

  const TRAITS = ['undead', 'human', 'huge', 'cultist', 'beast']
  const cases = []

  for (let i = 0; i < count; i++) {
    const contentMonsters = {}
    for (let m = 0; m < int(5); m++) {
      const traits = []
      for (let t = 0; t < int(3); t++) traits.push(pick(TRAITS))
      contentMonsters[`Monster${'ABCDE'[m]}`] = traits
    }
    const questMonsters = {}
    for (let m = 0; m < int(3); m++) {
      const traits = []
      for (let t = 0; t < int(2); t++) traits.push(pick(TRAITS))
      questMonsters[`CustomMonster${'XYZ'[m]}`] = {
        traits,
        base: chance(0.5) ? pick(['MonsterA', 'MonsterB', 'MonsterMissing', '']) : '',
      }
    }
    const spawns = {
      SpawnA: {
        types: chance(0.5) ? [] : [pick(['MonsterA', 'A', 'SpawnB', 'CustomMonsterX', 'Nope'])],
        required: chance(0.5) ? [pick(TRAITS)] : [],
        pool: chance(0.4) ? [pick(TRAITS), pick(TRAITS)] : [],
      },
      SpawnB: { types: [pick(['MonsterB', 'MonsterA'])] },
    }
    const selected = {}
    if (chance(0.3)) selected.SpawnB = pick(['MonsterA', 'MonsterB'])
    if (chance(0.15)) selected.SpawnA = 'MonsterA'

    cases.push({
      name: `fuzz/${i}`,
      gameType: chance(0.5) ? 'MoM' : 'D2E',
      spawn: 'SpawnA',
      force: !chance(0.25),
      viaRuntime: chance(0.2),
      contentMonsters,
      questMonsters,
      spawns,
      selected,
      onBoard: chance(0.3) ? [pick(['MonsterA', 'MonsterB'])] : [],
      random: [int(6), int(6)],
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

      const questLog = new QuestLog()
      const questMonsters = new Map(
        Object.entries(c.questMonsters ?? {}).map(([name, m]) => [
          name,
          { traits: m.traits ?? [], baseMonster: m.base ?? '' },
        ]),
      )
      const spawns = new Map(
        Object.entries(c.spawns ?? {}).map(([name, s]) => [
          name,
          {
            sectionName: name,
            mTypes: s.types ?? [],
            mTraitsRequired: s.required ?? [],
            mTraitsPool: s.pool ?? [],
          },
        ]),
      )
      // The quest's components are its custom monsters and its spawns.
      const questComponents = new Set([...questMonsters.keys(), ...spawns.keys()])

      const context = {
        contentMonsters: new Map(
          Object.entries(c.contentMonsters ?? {}).map(([name, traits]) => [name, { traits }]),
        ),
        questMonsters,
        questComponents,
        selected: new Map(Object.entries(c.selected ?? {})),
        onBoard: c.onBoard ?? [],
        gameType: c.gameType === 'D2E' ? 'D2E' : 'MoM',
        random,
        log: questLog,
      }

      const force = c.force !== false
      const value =
        c.viaRuntime === true
          ? runtimeMonsterSelection(c.spawn, spawns, context)
          : attemptMonsterMatch(spawns.get(c.spawn), context, force)

      for (const entry of questLog.toArray()) trace.push(`log:${entry.entry}`)

      result.ok = true
      result.result = value
      result.selected = Object.fromEntries(
        [...context.selected.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      )
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
execFileSync('dotnet', ['build', join(here, 'spawnharness.csproj'), '-v', 'q', '--nologo'], {
  stdio: 'ignore',
})
const bin = execFileSync('find', [join(here, 'bin'), '-name', 'spawnharness', '-type', 'f'], {
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean)[0]

const cs = JSON.parse(execFileSync(bin, [corpusPath], { encoding: 'utf8', maxBuffer: 1 << 28 }))
const ts = runTs(cases)

const FIELDS = ['ok', 'result', 'selected', 'trace']
const j = (v) => JSON.stringify(v ?? null)
const diffs = []
for (let i = 0; i < cs.length; i++) {
  const bad = FIELDS.filter((f) => j(cs[i][f]) !== j(ts[i][f]))
  if (bad.length > 0) diffs.push({ name: cs[i].name, bad, a: cs[i], b: ts[i] })
}

console.log(`spawn: ${cases.length} cases, ${diffs.length} real divergences`)
for (const d of diffs.slice(0, 5)) {
  console.log(`### ${d.name}  [${d.bad.join(', ')}]`)
  for (const f of d.bad) {
    console.log(`    C# ${f}: ${j(d.a[f])?.slice(0, 220)}`)
    console.log(`    TS ${f}: ${j(d.b[f])?.slice(0, 220)}`)
  }
}
process.exit(diffs.length === 0 ? 0 : 1)
