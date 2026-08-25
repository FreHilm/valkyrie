/**
 * Runs the ported round controller over the same corpus as the C# harness and
 * emits the same trace and end state, so the two can be diffed record by
 * record.
 *
 * The event engine is a scripted stub on both sides. What is under test is
 * what the controller *decides* — which monster acts, which triggers fire,
 * when the round turns over — with the engine's answers held identical, so a
 * divergence can only come from the controller.
 */
import { readFileSync } from 'node:fs'
import { setLogSink } from '../../../packages/core/src/ini/logger.ts'
import { QuestRuntime } from '../../../packages/core/src/quest/QuestRuntime.ts'
import { VarTests } from '../../../packages/core/src/quest/VarTests.ts'
import { StringKey } from '../../../packages/core/src/i18n/StringKey.ts'
import {
  MoMPhase,
  RoundController,
  RoundControllerMoM,
} from '../../../packages/core/src/quest/RoundController.ts'

const corpus = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const results = []

for (const c of corpus) {
  const trace = []
  const result = { name: c.name }
  try {
    result.state = run(c, trace)
    result.ok = true
  } catch (error) {
    result.ok = false
    result.error = error?.constructor?.name ?? 'Error'
  }
  result.trace = trace
  results.push(result)
}

console.log(JSON.stringify(results))

function run(c, trace) {
  setLogSink((message) => trace.push(`debug:${message}`))
  const mom = c.kind === 'mom'
  const runtime = new QuestRuntime({ components: new Map() })

  for (const [name, value] of Object.entries(c.vars ?? {})) runtime.vars.vars.set(name, value)

  const liveTriggers = new Set(c.liveTriggers ?? [])
  const blockingTriggers = new Set(c.blockingTriggers ?? [])
  const disabled = new Set(
    Object.entries(c.events ?? {})
      .filter(([, event]) => event.disabled)
      .map(([name]) => name),
  )

  const stack = []
  const events = {
    current: null,
    monsterImage: null,
    get queued() {
      return stack
    },
    triggerType(type, trigger = true) {
      const any = liveTriggers.has(type)
      trace.push(`trigger:${type}:${trigger ? '1' : '0'}=${any ? '1' : '0'}`)
      if (any) {
        stack.push(type)
        if (trigger) events.triggerEvent()
      }
      return any
    },
    queue(name, trigger = true) {
      trace.push(`queue:${name}`)
      stack.push(name)
      if (trigger) events.triggerEvent()
      return true
    },
    triggerEvent() {
      trace.push('triggerEvent')
      if (events.current !== null) return
      while (stack.length > 0) {
        const name = stack.pop()
        if (blockingTriggers.has(name)) {
          events.current = name
          trace.push(`open:${name}`)
          return
        }
        trace.push(`ran:${name}`)
      }
    },
    isDisabled(name) {
      return disabled.has(name)
    },
  }

  // Literal StringKeys, as a quest ini's inline activation text produces.
  const literal = (text) => new StringKey(null, text ?? '', false)
  const view = (name, spec) => ({
    sectionName: name,
    ability: literal(spec.ability),
    minionActions: literal(spec.minion),
    masterActions: literal(spec.master),
    moveButton: literal(spec.moveButton),
    move: literal(spec.move),
    minionFirst: spec.minionFirst === true,
    masterFirst: spec.masterFirst === true,
  })

  const contentActivations = new Map(
    Object.entries(c.contentActivations ?? {}).map(([name, spec]) => [name, view(name, spec)]),
  )

  const questActivations = new Map(
    Object.entries(c.questActivations ?? {}).map(([section, spec]) => {
      const tests = new VarTests()
      for (const part of spec.tests ?? []) tests.addFromString(part)
      // The C# keys these as "Activation" + name; the port stores the bare name.
      const name = section.startsWith('Activation') ? section.slice('Activation'.length) : section
      return [name, { ...view(section, spec), tests: spec.tests ? tests : null }]
    }),
  )

  const monsterTypes = new Map(
    Object.entries(c.monsterTypes ?? {}).map(([name, spec]) => [
      name,
      {
        sectionName: name,
        activations: spec.activations ?? [],
        healthBase: spec.healthBase ?? 0,
        healthPerHero: spec.healthPerHero ?? 0,
        ...(spec.quest === true
          ? {
              derivedType: spec.derivedType ?? '',
              useMonsterTypeActivations: spec.useMonsterTypeActivations !== false,
            }
          : {}),
      },
    ]),
  )

  const ids = new Map()
  for (const hero of c.heroes ?? []) {
    const instance = {
      heroName: hero.present === false ? null : hero.id,
      activated: hero.activated === true,
    }
    ids.set(instance, hero.id)
    runtime.heroes.push(instance)
  }

  for (const monster of c.monsters ?? []) {
    const instance = {
      monsterName: monster.type,
      unique: false,
      spawnedBy: monster.spawnedBy ?? '',
      health: monster.healthMod ?? 0,
      damage: 0,
      activated: monster.activated === true,
      minionStarted: monster.minionStarted === true,
      masterStarted: monster.masterStarted === true,
      currentActivation: null,
    }
    ids.set(instance, monster.id)
    runtime.monsters.push(instance)
  }

  const script = c.random ?? []
  let cursor = 0
  const random = (count) => {
    const value = cursor < script.length ? script[cursor] : 0
    cursor++
    if (count <= 0) return 0
    const picked = value % count
    trace.push(`random(${count})=${picked}`)
    return picked
  }

  const context = {
    runtime,
    events,
    monsterTypes,
    contentActivations,
    questActivations,
    random,
    present: (request) => {
      if (request.kind === 'activation') {
        const master = request.master ? '1' : '0'
        trace.push(
          `dialog:${ids.get(request.monster)}:master=${master}:single=${request.both ? '1' : '0'}`,
        )
      } else if (request.kind === 'activationMoM') {
        trace.push(`dialogMoM:${ids.get(request.monster)}`)
      } else {
        trace.push(`phaseWindow:${request.phase}`)
      }
    },
    playAudio: (trait) => trace.push(`audio:${trait}`),
    save: () => trace.push('save:0'),
    translate: (key, ...parameters) =>
      parameters.length === 0 ? key : `${key} ${parameters.join(' ')}`,
  }

  const controller = mom ? new RoundControllerMoM(context) : new RoundController(context)
  if (mom && c.phase !== undefined) controller.phase = MoMPhase[c.phase]

  for (const command of c.commands ?? []) {
    trace.push(`> ${command}`)
    switch (command) {
      case 'heroActivated':
        controller.heroActivated()
        break
      case 'monsterActivated':
        controller.monsterActivated()
        break
      case 'checkNewRound':
        trace.push(`= ${controller.checkNewRound()}`)
        break
      case 'endRound':
        controller.endRound()
        break
      case 'activateMonster':
        trace.push(`= ${controller.activateMonster()}`)
        break
      case 'reset':
        controller.reset()
        break
      case 'closeEvent':
        events.current = null
        break
      case 'defeatFirst':
        if (runtime.monsters.length > 0) controller.defeated(runtime.monsters[0])
        break
      case 'health':
        for (const monster of runtime.monsters) {
          const type = monsterTypes.get(monster.monsterName)
          trace.push(
            `health:${ids.get(monster)}=${runtime.monsterHealth(monster, {
              healthBase: type?.healthBase ?? 0,
              healthPerHero: type?.healthPerHero ?? 0,
            })}`,
          )
        }
        break
      default:
        throw new Error('unknown command')
    }
  }

  return {
    phase: mom ? controller.phase : 'investigator',
    monsters: runtime.monsters.map((monster) => ({
      id: ids.get(monster),
      activated: monster.activated,
      minionStarted: monster.minionStarted,
      masterStarted: monster.masterStarted,
      activation:
        monster.currentActivation === null ? null : monster.currentActivation.ad.sectionName,
    })),
    heroes: runtime.heroes.map((hero) => ({ id: ids.get(hero), activated: hero.activated })),
    vars: Object.fromEntries(
      [...runtime.vars.vars.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ),
    log: runtime.log.toArray().map((entry) => `${entry.editor ? 'E:' : ''}${entry.entry}`),
    currentEvent: events.current,
    stack: [...stack].reverse(),
    monsterImage: events.monsterImage === null ? null : ids.get(events.monsterImage),
  }
}
