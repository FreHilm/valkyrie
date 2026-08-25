/**
 * Mutation testing for the activation harness.
 *
 * The order of the steps is the whole point of this class — translate, then
 * `{0}`, then symbols, then newlines — so most of these mutations reorder or
 * drop one step rather than changing a value.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const SOURCE = new URL('../../../packages/core/src/quest/ActivationInstance.ts', import.meta.url)
const WEBAPP = new URL('../../../', import.meta.url).pathname
const original = readFileSync(SOURCE, 'utf8')

const MUTATIONS = [
  [
    'minion and master swapped',
    'this.minionActions = outputSymbolReplace(\n      activation.minionActions',
    'this.minionActions = outputSymbolReplace(\n      activation.masterActions',
  ],
  [
    'symbols not replaced in actions',
    "this.masterActions = outputSymbolReplace(\n      activation.masterActions.translate(options).split('{0}').join(monsterName),\n      symbols,\n    )",
    "this.masterActions = activation.masterActions.translate(options).split('{0}').join(monsterName)",
  ],
  [
    'monster name not substituted into actions',
    "activation.minionActions.translate(options).split('{0}').join(monsterName)",
    'activation.minionActions.translate(options)',
  ],
  [
    'only the first {0} replaced',
    ".split('{0}').join(monsterName),\n      symbols,\n    )\n    this.masterActions",
    ".replace('{0}', monsterName),\n      symbols,\n    )\n    this.masterActions",
  ],
  [
    'newlines left escaped in the effect',
    'this.effect = unescapeNewlines(outputSymbolReplace(effect, symbols))',
    'this.effect = outputSymbolReplace(effect, symbols)',
  ],
  [
    'newlines left escaped in move',
    'this.move = unescapeNewlines(\n        outputSymbolReplace(',
    'this.move = ((x) => x)(\n        outputSymbolReplace(',
  ],
  // NOT a mutation: replacing symbols early as well as late is idempotent
  // here, so it is invisible by construction. Dropping the late pass is the
  // observable defect, and that is what is tested.
  [
    'symbols not replaced in the effect',
    'this.effect = unescapeNewlines(outputSymbolReplace(effect, symbols))',
    'this.effect = unescapeNewlines(effect)',
  ],
  [
    'D2E substitutes {1} before {0}',
    "effect = activation.ability.translate(options).split('{0}').join(hero)\n      effect = effect.split('{1}').join(monsterName)",
    "effect = activation.ability.translate(options).split('{1}').join(monsterName)\n      effect = effect.split('{0}').join(hero)",
  ],
  [
    'D2E uses the monster where it should use a hero',
    "effect = activation.ability.translate(options).split('{0}').join(hero)",
    "effect = activation.ability.translate(options).split('{0}').join(monsterName)",
  ],
  [
    'D2E skips the {1} monster substitution',
    "effect = effect.split('{1}').join(monsterName)",
    'effect = effect',
  ],
  ['MoM uses the D2E branch', "if (context.gameType === 'MoM') {", 'if (false) {'],
  [
    'move uses the ability text',
    "activation.move.translate(options).split('{0}').join(monsterName)",
    "activation.ability.translate(options).split('{0}').join(monsterName)",
  ],
]

let escaped = 0

/** Applies one mutation, tolerating an anchor that prettier has reflowed. */
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
      ['--no-install', 'tsx', 'tools/differential/activation/compare.mjs', '1500'],
      { cwd: WEBAPP, encoding: 'utf8', maxBuffer: 1 << 28 },
    )
    divergences = Number(/activation: \d+ cases, (\d+) real divergences/.exec(out)?.[1] ?? -1)
  } catch (error) {
    const out = String(error.stdout ?? '')
    divergences = Number(/activation: \d+ cases, (\d+) real divergences/.exec(out)?.[1] ?? 'threw')
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
