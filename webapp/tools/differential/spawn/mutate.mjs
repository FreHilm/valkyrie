/**
 * Mutation testing for the spawn harness.
 *
 * The rules that decide which monster a scenario throws at the players are all
 * small conditions — a prefix test, an inclusive-or over a pool, a
 * game-type-only exclusion pass. Each one is broken here on purpose.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const SOURCE = new URL('../../../packages/core/src/quest/monsterSelection.ts', import.meta.url)
const WEBAPP = new URL('../../../', import.meta.url).pathname
const original = readFileSync(SOURCE, 'utf8')

const MUTATIONS = [
  [
    'already-resolved spawns re-resolve',
    'if (context.selected.has(spawn.sectionName)) return true',
    'if (false) return true',
  ],
  [
    'trait branch taken when no traits are given',
    'if (spawn.mTraitsPool.length + spawn.mTraitsRequired.length === 0) {',
    'if (false) {',
  ],
  [
    'name branch taken even with traits',
    'if (spawn.mTraitsPool.length + spawn.mTraitsRequired.length === 0) {',
    'if (true) {',
  ],
  [
    'Monster prefix always added',
    "type.startsWith('Monster') || type.startsWith('CustomMonster') ? type : `Monster${type}`",
    '`Monster${type}`',
  ],
  [
    'CustomMonster prefix not recognised',
    "type.startsWith('Monster') || type.startsWith('CustomMonster')",
    "type.startsWith('Monster')",
  ],
  [
    'unresolved spawn reference does not abort',
    "if (type.startsWith('Spawn')) return false",
    'if (false) return false',
  ],
  [
    'another spawn’s choice is ignored',
    'const alreadyChosen = context.selected.get(type)\n    if (alreadyChosen !== undefined) {\n      context.selected.set(spawn.sectionName, alreadyChosen)',
    'const alreadyChosen = undefined\n    if (alreadyChosen !== undefined) {\n      context.selected.set(spawn.sectionName, alreadyChosen)',
  ],
  [
    'quest components not consulted',
    'context.questComponents.has(monster) || context.contentMonsters.has(monster)',
    'context.contentMonsters.has(monster)',
  ],
  [
    'content monsters not consulted',
    'context.questComponents.has(monster) || context.contentMonsters.has(monster)',
    'context.questComponents.has(monster)',
  ],
  [
    'required traits treated as a pool',
    'for (const required of spawn.mTraitsRequired) {\n    if (!traits.includes(required)) return false\n  }',
    'if (spawn.mTraitsRequired.length > 0 && !spawn.mTraitsRequired.some((t) => traits.includes(t))) return false',
  ],
  [
    'empty pool excludes everything',
    'spawn.mTraitsPool.length === 0 || spawn.mTraitsPool.some((t) => traits.includes(t))',
    'spawn.mTraitsPool.some((t) => traits.includes(t))',
  ],
  [
    'pool treated as required',
    'spawn.mTraitsPool.length === 0 || spawn.mTraitsPool.some((t) => traits.includes(t))',
    'spawn.mTraitsPool.every((t) => traits.includes(t))',
  ],
  ['exclusions ignored', 'return !exclude.includes(name)', 'return true'],
  ['Descent dedup applied to Mansions too', "if (context.gameType === 'D2E') {", 'if (true) {'],
  ['Descent dedup skipped', "if (context.gameType === 'D2E') {", 'if (false) {'],
  [
    'board monsters not excluded',
    'for (const name of context.onBoard) {\n      if (!exclude.includes(name)) exclude.push(name)\n    }',
    'void 0',
  ],
  [
    'custom monster never inherits base traits',
    'monster.traits.length === 0 && base !== undefined ? base.traits : monster.traits',
    'monster.traits',
  ],
  [
    'custom monster always inherits base traits',
    'monster.traits.length === 0 && base !== undefined ? base.traits : monster.traits',
    'base !== undefined ? base.traits : monster.traits',
  ],
  [
    'quest monsters left out of the trait pool',
    'for (const [name, monster] of context.questMonsters) {',
    'for (const [name, monster] of new Map()) {',
  ],
  [
    'always picks the first candidate',
    'matches[context.random(matches.length)] ?? matches[0]',
    'matches[0]',
  ],
  ['force ignored', "} else if (type.startsWith('Spawn') && !force) {", '} else if (false) {'],
]

let escaped = 0

function applyMutation(source, from, to) {
  if (source.includes(from)) return source.replace(from, to)
  const pattern = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'))
  const match = pattern.exec(source)
  if (match === null) return null
  return source.slice(0, match.index) + to + source.slice(match.index + match[0].length)
}

for (const [name, from, to] of MUTATIONS) {
  const mutated = applyMutation(original, from, to)
  if (mutated === null) {
    console.log(`  SKIP  ${name} — anchor not found`)
    escaped++
    continue
  }
  writeFileSync(SOURCE, mutated)
  let divergences
  try {
    const out = execFileSync(
      'npx',
      ['--no-install', 'tsx', 'tools/differential/spawn/compare.mjs', '1500'],
      { cwd: WEBAPP, encoding: 'utf8', maxBuffer: 1 << 28 },
    )
    divergences = Number(/spawn: \d+ cases, (\d+) real divergences/.exec(out)?.[1] ?? -1)
  } catch (error) {
    const out = String(error.stdout ?? '')
    divergences = Number(/spawn: \d+ cases, (\d+) real divergences/.exec(out)?.[1] ?? 'threw')
  }
  const caught = Number.isNaN(divergences) || divergences > 0
  if (!caught) escaped++
  console.log(`  ${caught ? 'caught' : 'ESCAPED'}  ${String(divergences).padStart(5)}  ${name}`)
}

writeFileSync(SOURCE, original)
console.log(
  escaped === 0 ? 'every mutation caught' : `${escaped} mutation(s) escaped  <-- harness gap`,
)
process.exit(escaped === 0 ? 0 : 1)
