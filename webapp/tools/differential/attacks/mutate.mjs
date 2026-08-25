/**
 * Mutation testing for the attacks harness.
 *
 * The selection has two halves that are easy to conflate — which types the
 * dialog offers, and which text pressing one produces — and a quest override
 * that shadows content entirely. These mutations target all three.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const SOURCE = new URL('../../../packages/core/src/quest/monsterAttacks.ts', import.meta.url)
const WEBAPP = new URL('../../../', import.meta.url).pathname
const original = readFileSync(SOURCE, 'utf8')

const MUTATIONS = [
  [
    'types matched on attackType rather than target',
    'monster.traits.includes(attack.target)) types.add(attack.attackType)',
    'monster.traits.includes(attack.attackType)) types.add(attack.attackType)',
  ],
  [
    'types collect the target rather than the type',
    'types.add(attack.attackType)',
    'types.add(attack.target)',
  ],
  ['types no longer deduplicate', 'const types = new Set<string>()', 'const types: string[] = []'],
  [
    'every attack type offered',
    'if (monster.traits.includes(attack.target)) types.add(attack.attackType)',
    'types.add(attack.attackType)',
  ],
  [
    'quest override ignored',
    'const own = monster.investigatorAttacks?.get(type)',
    'const own = undefined',
  ],
  // An empty override must stop the search, not fall through to content: the
  // scenario said "this type has no text", and content text would be wrong.
  [
    'empty quest override falls through to content',
    'if (own !== undefined) {\n    if (own.length === 0) return null',
    'if (own !== undefined && own.length > 0) {\n    if (false) return null',
  ],
  [
    'draw ignores the type filter',
    'if (attack.attackType !== type) continue',
    'if (false) continue',
  ],
  [
    'draw ignores the trait filter',
    '} else if (monster.traits.includes(attack.target)) {',
    '} else if (true) {',
  ],
  ['always draws the first attack', 'valid[random(valid.length)]?.text', 'valid[0]?.text'],
  [
    'quest override always draws the first',
    'own[random(own.length)] ?? own[0] ?? null',
    'own[0] ?? null',
  ],
  ['no-traits fallback dropped', 'if (monster.traits.length === 0) {', 'if (false) {'],
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
      ['--no-install', 'tsx', 'tools/differential/attacks/compare.mjs', '1500'],
      { cwd: WEBAPP, encoding: 'utf8', maxBuffer: 1 << 28 },
    )
    divergences = Number(/attacks: \d+ cases, (\d+) real divergences/.exec(out)?.[1] ?? -1)
  } catch (error) {
    const out = String(error.stdout ?? '')
    divergences = Number(/attacks: \d+ cases, (\d+) real divergences/.exec(out)?.[1] ?? 'threw')
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
