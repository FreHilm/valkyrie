/**
 * Mutation testing for the rounds harness.
 *
 * A differential that reports zero divergences is only evidence if it would
 * report some when the port is wrong. Each mutation below is a plausible
 * porting mistake; every one of them must be caught.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const SRC = new URL('../../../packages/core/src/quest/', import.meta.url)
const WEBAPP = new URL('../../../', import.meta.url).pathname
const FILES = {
  rounds: new URL('RoundController.ts', SRC),
  runtime: new URL('QuestRuntime.ts', SRC),
}
const originals = Object.fromEntries(
  Object.entries(FILES).map(([key, url]) => [key, readFileSync(url, 'utf8')]),
)
const restore = () => {
  for (const [key, url] of Object.entries(FILES)) writeFileSync(url, originals[key])
}

// [file, description, from, to]
const MUTATIONS = [
  [
    'rounds',
    'minion/master draw inverted',
    'this.context.random(2) === 0',
    'this.context.random(2) === 1',
  ],
  [
    'rounds',
    'masterFirst ignored',
    'if (activation.ad.masterFirst) monster.minionStarted = false',
    'if (false) monster.minionStarted = false',
  ],
  [
    'rounds',
    'minionFirst ignored',
    'if (activation.ad.minionFirst) monster.minionStarted = true',
    'if (false) monster.minionStarted = true',
  ],
  [
    'rounds',
    'single-half test uses AND',
    'if (!hasMinion || !hasMaster) {',
    'if (!hasMinion && !hasMaster) {',
  ],
  [
    'rounds',
    'single-half dialog shows the wrong half',
    'master: !hasMinion, both: true',
    'master: hasMinion, both: true',
  ],
  [
    'rounds',
    'empty hero seats block the round',
    'hero.activated || hero.heroName === null',
    'hero.activated',
  ],
  [
    'rounds',
    'partial activation flips the half',
    'master: monster.minionStarted,',
    'master: !monster.minionStarted,',
  ],
  [
    'rounds',
    'round counter uses half-up rounding',
    "roundToInt(runtime.vars.getValue('#round')) + 1",
    "Math.round(runtime.vars.getValue('#round')) + 1",
  ],
  [
    'rounds',
    'eliminatedprev set before the check',
    "if (runtime.vars.getValue('#eliminated') > 0) {",
    "if (runtime.vars.getValue('#eliminatedprev') > 0) {",
  ],
  [
    'rounds',
    'MoM mythos falls through to monsters',
    'this.phase = MoMPhase.horror\n          return false',
    'this.phase = MoMPhase.monsters\n          return false',
  ],
  [
    'rounds',
    'MoM horror does not wait for the player',
    '!this.endRoundRequested &&\n      this.phase === MoMPhase.horror',
    'false &&\n      this.phase === MoMPhase.horror',
  ],
  [
    'rounds',
    'MoM event activation matched anywhere in the name',
    "!only.startsWith('Event')",
    "!only.includes('Event')",
  ],
  [
    'rounds',
    'MoM event activation does not mark the monster done',
    'chosen.activated = true\n      this.context.events.monsterImage',
    'this.context.events.monsterImage',
  ],
  [
    'runtime',
    'activation not cleared between rounds',
    '      monster.currentActivation = null\n',
    '',
  ],
  [
    'runtime',
    'hero activation not cleared between rounds',
    'for (const hero of this.heroes) hero.activated = false',
    '',
  ],
  [
    'runtime',
    'minionStarted not cleared between rounds',
    '      monster.minionStarted = false\n',
    '',
  ],
  [
    'rounds',
    'activationsFinished never reset',
    'this.activationsFinished = false\n\n    this.context.runtime.resetActivations()',
    'this.context.runtime.resetActivations()',
  ],
  [
    'rounds',
    'defeat does not clear the open event',
    'events.current = null\n    events.triggerType(`Defeated${monster.monsterName}`)',
    'events.triggerType(`Defeated${monster.monsterName}`)',
  ],
  [
    'rounds',
    'defeat fires only the type trigger',
    'events.triggerType(`Defeated${monster.spawnedBy}`)',
    'void 0',
  ],
  [
    'rounds',
    'defeat does not drive the monster phase onward',
    'if (this.phase === MoMPhase.monsters && events.current === null) {\n      this.monsterActivated()\n    }',
    'void 0',
  ],
  [
    'runtime',
    'health ignores the scenario modifier',
    'roundToInt(type.healthBase + this.heroCount() * type.healthPerHero) + monster.health',
    'roundToInt(type.healthBase + this.heroCount() * type.healthPerHero)',
  ],
  [
    'runtime',
    'health counts empty party seats',
    'this.heroes.filter((hero) => hero.heroName !== null).length',
    'this.heroes.length',
  ],
  [
    'runtime',
    'health uses half-up rounding',
    'roundToInt(type.healthBase + this.heroCount() * type.healthPerHero)',
    'Math.round(type.healthBase + this.heroCount() * type.healthPerHero)',
  ],
  [
    'rounds',
    'StartRound fires without triggering',
    "this.context.events.triggerType('StartRound')",
    "this.context.events.triggerType('StartRound', false)",
  ],
]

/**
 * Applies one mutation, tolerating a reflowed anchor.
 *
 * Prettier rewraps these lines whenever they grow, which silently turned
 * mutations into SKIPs three times before this fallback existed.
 */
function applyMutation(source, from, to) {
  if (source.includes(from)) return source.replace(from, to)
  const pattern = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'))
  const match = pattern.exec(source)
  if (match === null) return null
  return source.slice(0, match.index) + to + source.slice(match.index + match[0].length)
}

// Curated cases *and* fuzz: several mutations were caught only by a handful of
// random scenarios, so a reseeded fuzzer silently turned them into escapes.
const corpus = process.argv[2] ?? '.work/combined.json'
const csJson = process.argv[3] ?? '.work/cs-combined.json'
let escaped = 0

for (const [file, name, from, to] of MUTATIONS) {
  const source = originals[file]
  const mutated = applyMutation(source, from, to)
  if (mutated === null) {
    console.log(`  SKIP  ${name} — anchor not found`)
    escaped++
    continue
  }
  restore()
  writeFileSync(FILES[file], mutated)
  let divergences = '?'
  try {
    const ts = execFileSync(
      'npx',
      [
        '--no-install',
        'tsx',
        'tools/differential/rounds/run-ts.mjs',
        `tools/differential/rounds/${corpus}`,
      ],
      { cwd: WEBAPP, encoding: 'utf8', maxBuffer: 1 << 28 },
    )
    writeFileSync('.work/ts-mutant.json', ts)
    const out = execFileSync('node', ['compare.mjs', csJson, '.work/ts-mutant.json'], {
      encoding: 'utf8',
      maxBuffer: 1 << 28,
    })
    divergences = Number(/real divergences: (\d+)/.exec(out)?.[1] ?? -1)
  } catch {
    divergences = 'threw'
  }
  const caught = divergences === 'threw' || divergences > 0
  if (!caught) escaped++
  console.log(`  ${caught ? 'caught' : 'ESCAPED'}  ${String(divergences).padStart(5)}  ${name}`)
}

restore()
console.log(
  escaped === 0 ? 'every mutation caught' : `${escaped} mutation(s) escaped  <-- harness gap`,
)
process.exit(escaped === 0 ? 0 : 1)
