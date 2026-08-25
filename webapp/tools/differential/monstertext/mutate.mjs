/**
 * Mutation testing for the monster-text harness.
 *
 * Only `pickMonsterText` / `customMonsterEvent` are under test here — the
 * dialog ordering is mirrored inside `compare.mjs` rather than read from the
 * port, so these mutations deliberately target the selection logic, which is
 * the part that is actually ported.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const SOURCE = new URL('../../../packages/core/src/quest/monsterText.ts', import.meta.url)
const WEBAPP = new URL('../../../', import.meta.url).pathname
const original = readFileSync(SOURCE, 'utf8')

const MUTATIONS = [
  [
    'prefix dropped from the match',
    'monster.monsterName === MONSTER_PREFIX + entry.monster',
    'monster.monsterName === entry.monster',
  ],
  [
    'match becomes a prefix test',
    'monster.monsterName === MONSTER_PREFIX + entry.monster',
    'monster.monsterName.startsWith(MONSTER_PREFIX + entry.monster)',
  ],
  [
    'derived fallback always applied',
    'if (matches.length === 0) {\n    const derived',
    'if (true) {\n    const derived',
  ],
  [
    'derived fallback never applied',
    'matches.push(...all.filter((entry) => derived === MONSTER_PREFIX + entry.monster))',
    'void 0',
  ],
  // NOT mutations, and left out deliberately: a blank derived type can never
  // equal "Monster" + anything, so `IsNullOrWhiteSpace` has no observable
  // effect; and no quest component is named "", so an empty event name takes
  // the same path either way. Both are unobservable by construction rather
  // than uncovered by the corpus.
  [
    'derived fallback ignores the prefix',
    'derived === MONSTER_PREFIX + entry.monster',
    'derived === entry.monster',
  ],
  [
    'always picks the first match',
    'matches[random(matches.length)] ?? matches[0] ?? null',
    'matches[0] ?? null',
  ],
  [
    'empty selection returns the first entry',
    'if (matches.length === 0) return null\n  return matches',
    'if (matches.length === 0) return all[0] ?? null\n  return matches',
  ],
  [
    'missing custom event still queued',
    'return questComponents.has(name) ? name : null',
    'return name',
  ],
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
      ['--no-install', 'tsx', 'tools/differential/monstertext/compare.mjs', '1500'],
      { cwd: WEBAPP, encoding: 'utf8', maxBuffer: 1 << 28 },
    )
    divergences = Number(/monstertext: \d+ cases, (\d+) real divergences/.exec(out)?.[1] ?? -1)
  } catch (error) {
    const out = String(error.stdout ?? '')
    divergences = Number(/monstertext: \d+ cases, (\d+) real divergences/.exec(out)?.[1] ?? 'threw')
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
