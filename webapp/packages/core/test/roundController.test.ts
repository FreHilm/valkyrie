/**
 * Tests for the round and activation loop (T-018).
 *
 * `RoundController.cs` and `RoundControllerMoM.cs` have no tests: both build
 * dialogs from inside the decision logic, so neither can run without a screen.
 * The port emits a request instead, which is what makes these possible.
 *
 * These are the cases the `rounds` differential harness names — kept here so a
 * regression shows up in `npm test` rather than only when dotnet is installed.
 */

import { afterEach, describe, expect, it } from 'vitest'

import { setLogSink } from '../src/ini/logger.js'
import { VarManager } from '../src/quest/VarManager.js'
import { QuestRuntime } from '../src/quest/QuestRuntime.js'
import type { MonsterInstance } from '../src/quest/QuestRuntime.js'
import { ActivationInstance } from '../src/quest/ActivationInstance.js'
import type { ActivationView } from '../src/quest/ActivationInstance.js'
import { StringKey } from '../src/i18n/StringKey.js'
import {
  MoMPhase,
  RoundController,
  RoundControllerMoM,
  roundToInt,
} from '../src/quest/RoundController.js'
import type { EventsView, RoundContext, RoundRequest } from '../src/quest/RoundController.js'
import { VarTests } from '../src/quest/VarTests.js'

const BOTH_HALVES = { minion: 'MinionText', master: 'MasterText' }

/** A literal StringKey, as a quest ini's inline text produces. */
const literal = (text: string): StringKey => new StringKey(null, text, false)

function activation(name: string, spec: Record<string, unknown> = {}): ActivationView {
  return {
    sectionName: name,
    ability: literal((spec.ability as string) ?? ''),
    minionActions: literal((spec.minion as string) ?? BOTH_HALVES.minion),
    masterActions: literal((spec.master as string) ?? BOTH_HALVES.master),
    moveButton: literal((spec.moveButton as string) ?? ''),
    move: literal((spec.move as string) ?? ''),
    minionFirst: spec.minionFirst === true,
    masterFirst: spec.masterFirst === true,
  }
}

/** The scripted event engine both sides of the differential use. */
function events(live: string[] = [], blocking: string[] = []): EventsView & { fired: string[] } {
  const stack: string[] = []
  const fired: string[] = []
  const view = {
    current: null as unknown,
    monsterImage: null as MonsterInstance | null,
    fired,
    get queued(): readonly string[] {
      return stack
    },
    triggerType(type: string, trigger = true): boolean {
      fired.push(type)
      if (!live.includes(type)) return false
      stack.push(type)
      if (trigger) view.triggerEvent()
      return true
    },
    queue(name: string, trigger = true): boolean {
      stack.push(name)
      if (trigger) view.triggerEvent()
      return true
    },
    triggerEvent(): void {
      if (view.current !== null) return
      while (stack.length > 0) {
        const name = stack.pop()
        if (name !== undefined && blocking.includes(name)) {
          view.current = name
          return
        }
      }
    },
    isDisabled: (name: string) => name.endsWith('Disabled'),
  }
  return view
}

interface Harness {
  runtime: QuestRuntime
  requests: RoundRequest[]
  audio: string[]
  saves: number
  events: EventsView & { fired: string[] }
}

function harness(
  overrides: Partial<RoundContext> & { draws?: number[] } = {},
): Harness & { context: RoundContext } {
  const runtime = new QuestRuntime({ components: new Map() })
  const requests: RoundRequest[] = []
  const audio: string[] = []
  const state: Harness = {
    runtime,
    requests,
    audio,
    saves: 0,
    events: (overrides.events as EventsView & { fired: string[] }) ?? events(),
  }

  const draws = overrides.draws ?? []
  let cursor = 0

  const context: RoundContext = {
    runtime,
    events: state.events,
    monsterTypes: new Map(),
    contentActivations: new Map(),
    questActivations: new Map(),
    present: (request) => requests.push(request),
    random: (count) => (count <= 0 ? 0 : (draws[cursor++] ?? 0) % count),
    playAudio: (trait) => audio.push(trait),
    save: () => {
      state.saves++
    },
    translate: (key, ...parameters) => [key, ...parameters].join(' '),
    ...overrides,
  }

  return {
    ...state,
    get saves() {
      return state.saves
    },
    context,
  }
}

function monster(id: string, type = 'MonsterGoblin'): MonsterInstance & { id: string } {
  return {
    id,
    monsterName: type,
    spawnedBy: '',
    unique: false,
    health: 0,
    activated: false,
    minionStarted: false,
    masterStarted: false,
    currentActivation: null,
  }
}

/** Wraps activation data the way the controller does when it draws one. */
function instance(view: ActivationView): ActivationInstance {
  return new ActivationInstance(view, {
    monsterName: 'Goblin',
    gameType: 'MoM',
    vars: new VarManager(),
  })
}

afterEach(() => setLogSink(null))

describe('roundToInt', () => {
  it('rounds halves to even, as Mathf.RoundToInt does', () => {
    expect(roundToInt(2.5)).toBe(2)
    expect(roundToInt(3.5)).toBe(4)
    expect(roundToInt(-2.5)).toBe(-2)
    expect(roundToInt(-1.5)).toBe(-2)
  })

  it('leaves everything else alone', () => {
    expect(roundToInt(2.4)).toBe(2)
    expect(roundToInt(2.6)).toBe(3)
    expect(roundToInt(7)).toBe(7)
  })
})

describe('RoundController (Descent)', () => {
  it('activates a monster when the party finishes', () => {
    const h = harness({
      monsterTypes: new Map([['MonsterGoblin', { sectionName: 'MonsterGoblin', activations: [] }]]),
      contentActivations: new Map([
        ['MonsterActivationGoblinA', activation('MonsterActivationGoblinA')],
      ]),
      draws: [0, 0, 0],
    })
    h.runtime.heroes.push({ heroName: 'h1', activated: true })
    h.runtime.monsters.push(monster('m1'))

    new RoundController(h.context).heroActivated()

    expect(h.requests).toEqual([
      { kind: 'activation', monster: h.runtime.monsters[0], master: false, both: false },
    ])
  })

  it('does not let an empty party seat hold the round open', () => {
    const h = harness()
    h.runtime.heroes.push({ heroName: 'h1', activated: true }, { heroName: null, activated: false })

    const controller = new RoundController(h.context)
    controller.heroActivated()

    // No monsters and no unfinished hero: the round ended.
    expect(h.events.fired).toContain('EndRound')
  })

  it('shows both halves at once when only one is defined', () => {
    const h = harness({
      monsterTypes: new Map([['MonsterGoblin', { sectionName: 'MonsterGoblin', activations: [] }]]),
      contentActivations: new Map([
        ['MonsterActivationGoblinA', activation('MonsterActivationGoblinA', { minion: '' })],
      ]),
    })
    h.runtime.monsters.push(monster('m1'))

    new RoundController(h.context).activateMonster()

    expect(h.requests).toEqual([
      { kind: 'activation', monster: h.runtime.monsters[0], master: true, both: true },
    ])
  })

  it('honours minionFirst over the random draw', () => {
    const h = harness({
      monsterTypes: new Map([['MonsterGoblin', { sectionName: 'MonsterGoblin', activations: [] }]]),
      contentActivations: new Map([
        ['MonsterActivationGoblinA', activation('MonsterActivationGoblinA', { minionFirst: true })],
      ]),
      draws: [0, 1],
    })
    h.runtime.monsters.push(monster('m1'))

    new RoundController(h.context).activateMonster()

    expect(h.runtime.monsters[0]?.minionStarted).toBe(true)
    expect(h.runtime.monsters[0]?.masterStarted).toBe(false)
  })

  it('completes a half-finished activation before starting another', () => {
    const h = harness({
      monsterTypes: new Map([['MonsterGoblin', { sectionName: 'MonsterGoblin', activations: [] }]]),
      contentActivations: new Map([
        ['MonsterActivationGoblinA', activation('MonsterActivationGoblinA')],
      ]),
    })
    const m = monster('m1')
    m.minionStarted = true
    h.runtime.monsters.push(m)

    new RoundController(h.context).monsterActivated()

    expect(h.requests).toEqual([{ kind: 'activation', monster: m, master: true, both: false }])
    expect(m.masterStarted).toBe(true)
  })

  it('advances the round counter and logs it', () => {
    const h = harness()
    h.runtime.vars.setValue('#round', 4)
    h.runtime.heroes.push({ heroName: 'h1', activated: true })

    const controller = new RoundController(h.context)
    controller.heroActivated()

    expect(controller.checkNewRound()).toBe(true)
    expect(h.runtime.vars.getValue('#round')).toBe(5)
    expect(h.runtime.log.toArray().map((e) => e.entry)).toContain('ROUND 5')
    expect(h.audio).toEqual(['newround'])
  })

  it('will not turn the round over while an event is open', () => {
    const h = harness({ events: events(['EndRound'], ['EndRound']) })
    h.runtime.heroes.push({ heroName: 'h1', activated: true })

    const controller = new RoundController(h.context)
    controller.heroActivated()

    expect(controller.checkNewRound()).toBe(false)
  })

  it('fires the numbered end-of-round trigger for the current round', () => {
    const h = harness()
    h.runtime.vars.setValue('#round', 3)

    new RoundController(h.context).endRound()

    expect(h.events.fired).toEqual(['EndRound', 'EndRound3'])
  })

  it('runs the eliminated chain once', () => {
    const h = harness()
    h.runtime.vars.setValue('#eliminatedprev', 1)

    new RoundController(h.context).endRound()

    expect(h.events.fired).toContain('Eliminated')
    expect(h.runtime.vars.getValue('#eliminatedcomplete')).toBe(1)
  })

  it('skips a monster with no activation data rather than closing the app', () => {
    const messages: string[] = []
    setLogSink((message) => messages.push(message))
    const h = harness({
      monsterTypes: new Map([['MonsterGoblin', { sectionName: 'MonsterGoblin', activations: [] }]]),
    })
    h.runtime.monsters.push(monster('m1'))

    expect(new RoundController(h.context).activateMonster()).toBe(true)
    expect(h.runtime.monsters[0]?.activated).toBe(true)
    expect(messages[0]).toContain('Unable to find any activation data')
  })

  it('warns when a quest activation exists but its tests fail and content has no fallback', () => {
    const h = harness({
      monsterTypes: new Map([
        [
          'MonsterGoblin',
          {
            sectionName: 'MonsterGoblin',
            activations: ['Custom'],
            useMonsterTypeActivations: false,
          },
        ],
      ]),
      questActivations: new Map([
        ['Custom', { ...activation('ActivationCustom'), tests: failingTests() }],
      ]),
    })
    h.runtime.monsters.push(monster('m1'))

    new RoundController(h.context).activateMonster()

    expect(h.runtime.log.toArray().map((e) => e.entry)).toContain(
      'Warning: Unable to find activation: Custom for monster type: MonsterGoblin',
    )
  })
})

describe('RoundControllerMoM', () => {
  it('moves the investigators into the mythos phase', () => {
    const h = harness()
    h.runtime.heroes.push({ heroName: 'h1', activated: false })

    const controller = new RoundControllerMoM(h.context)
    controller.heroActivated()

    expect(controller.phase).toBe(MoMPhase.mythos)
    expect(h.runtime.heroes[0]?.activated).toBe(true)
    expect(h.events.fired).toEqual(['BeforeMonsterActivation', 'Mythos', 'EndInvestigatorTurn'])
    expect(h.requests).toEqual([{ kind: 'phaseTransition', phase: MoMPhase.mythos }])
  })

  it('lets an elimination interrupt the phase change', () => {
    const h = harness({ events: events(['Eliminated']) })
    h.runtime.vars.setValue('#eliminatedprev', 1)
    h.runtime.heroes.push({ heroName: 'h1', activated: false })

    const controller = new RoundControllerMoM(h.context)
    controller.heroActivated()

    expect(controller.phase).toBe(MoMPhase.investigator)
    expect(h.requests).toEqual([])
  })

  it('shows one dialog per monster rather than splitting the halves', () => {
    const h = harness({
      monsterTypes: new Map([['MonsterGoblin', { sectionName: 'MonsterGoblin', activations: [] }]]),
      contentActivations: new Map([
        ['MonsterActivationGoblinA', activation('MonsterActivationGoblinA')],
      ]),
    })
    h.runtime.monsters.push(monster('m1'))

    new RoundControllerMoM(h.context).activateMonster()

    expect(h.requests).toEqual([{ kind: 'activationMoM', monster: h.runtime.monsters[0] }])
    expect(h.runtime.monsters[0]?.masterStarted).toBe(true)
  })

  it('queues an event activation and marks the monster done', () => {
    const h = harness({
      monsterTypes: new Map([
        ['MonsterGoblin', { sectionName: 'MonsterGoblin', activations: ['EventGoblinActs'] }],
      ]),
    })
    h.runtime.monsters.push(monster('m1'))

    new RoundControllerMoM(h.context).activateMonster()

    expect(h.runtime.monsters[0]?.activated).toBe(true)
    expect(h.events.monsterImage).toBe(h.runtime.monsters[0])
  })

  it('treats an activation that only contains "Event" as an ordinary one', () => {
    const h = harness({
      monsterTypes: new Map([
        ['MonsterGoblin', { sectionName: 'MonsterGoblin', activations: ['TrapEventActs'] }],
      ]),
      questActivations: new Map([['TrapEventActs', activation('ActivationTrapEventActs')]]),
    })
    h.runtime.monsters.push(monster('m1'))

    new RoundControllerMoM(h.context).activateMonster()

    // Not queued as an event: the C# tests the prefix, not containment.
    expect(h.events.monsterImage).toBeNull()
  })

  it('skips a monster whose only activation is a disabled event', () => {
    const h = harness({
      monsterTypes: new Map([
        ['MonsterGoblin', { sectionName: 'MonsterGoblin', activations: ['EventDisabled'] }],
      ]),
    })
    h.runtime.monsters.push(monster('m1'))

    expect(new RoundControllerMoM(h.context).activateMonster()).toBe(true)
    expect(h.runtime.monsters[0]?.activated).toBe(true)
  })

  it('goes straight to horror when the mythos phase has no monsters', () => {
    const h = harness()
    const controller = new RoundControllerMoM(h.context)
    controller.phase = MoMPhase.mythos

    expect(controller.checkNewRound()).toBe(false)
    expect(controller.phase).toBe(MoMPhase.horror)
  })

  it('waits for the player in the horror phase while monsters remain', () => {
    const h = harness()
    h.runtime.monsters.push(monster('m1'))
    const controller = new RoundControllerMoM(h.context)
    controller.phase = MoMPhase.horror

    expect(controller.checkNewRound()).toBe(false)
    expect(controller.phase).toBe(MoMPhase.horror)
  })

  it('turns the round over once the horror phase has been asked to end', () => {
    const h = harness()
    h.runtime.vars.setValue('#round', 2)
    h.runtime.monsters.push(monster('m1'))
    const controller = new RoundControllerMoM(h.context)
    controller.phase = MoMPhase.horror

    controller.endRound()

    expect(controller.checkNewRound()).toBe(true)
    expect(controller.phase).toBe(MoMPhase.investigator)
    expect(h.runtime.vars.getValue('#round')).toBe(3)
    expect(h.runtime.log.toArray().map((e) => e.entry)).toContain('PHASE_INVESTIGATOR')
    expect(h.requests).toEqual([{ kind: 'phaseTransition', phase: MoMPhase.investigator }])
  })

  it('fires the final-round trigger the round after an investigator is eliminated', () => {
    // A two-round handshake: `EndRound` promotes `#eliminated` into
    // `#eliminatedprev`, and only the *next* round start sees it still
    // incomplete. Setting `#eliminatedprev` directly would instead be consumed
    // by `EndRound` itself and the trigger would never fire.
    const h = harness({ events: events(['StartFinalRound', 'StartRound']) })
    h.runtime.vars.setValue('#eliminated', 1)
    const controller = new RoundControllerMoM(h.context)
    controller.phase = MoMPhase.horror
    controller.endRound()

    expect(h.runtime.vars.getValue('#eliminatedprev')).toBe(1)
    expect(h.runtime.vars.getValue('#eliminatedcomplete')).toBe(0)

    controller.checkNewRound()

    expect(h.events.fired).toContain('StartFinalRound')
  })

  it('clears every activation flag when the round turns over', () => {
    const h = harness()
    const m = monster('m1')
    m.activated = true
    m.minionStarted = true
    m.masterStarted = true
    m.currentActivation = instance(activation('MonsterActivationGoblinA'))
    h.runtime.monsters.push(m)
    h.runtime.heroes.push({ heroName: 'h1', activated: true })

    const controller = new RoundControllerMoM(h.context)
    controller.phase = MoMPhase.horror
    controller.endRound()
    controller.checkNewRound()

    expect(m).toMatchObject({
      activated: false,
      minionStarted: false,
      masterStarted: false,
      currentActivation: null,
    })
    expect(h.runtime.heroes[0]?.activated).toBe(false)
  })
})

/** A test a quest ini would carry, written so it never passes. */
function failingTests(): VarTests {
  const tests = new VarTests()
  tests.addFromString('VarOperation:#flag,>,1')
  return tests
}

describe('defeating a monster', () => {
  it('removes it, keeps #monsters in step and fires both triggers', () => {
    const h = harness({ events: events(['DefeatedMonsterGoblin', 'DefeatedSpawnA']) })
    const m = monster('m1')
    m.spawnedBy = 'SpawnA'
    h.runtime.monsters.push(m)
    h.runtime.vars.setValue('#monsters', 1)

    new RoundControllerMoM(h.context).defeated(m)

    expect(h.runtime.monsters).toEqual([])
    expect(h.runtime.vars.getValue('#monsters')).toBe(0)
    expect(h.events.fired).toEqual(['DefeatedMonsterGoblin', 'DefeatedSpawnA'])
    expect(h.audio).toEqual(['defeated'])
  })

  it('clears the open event before firing, so a Defeated event can start', () => {
    // The C# comments this as "fix #1112". Without it the Defeated event is
    // queued behind an event that will never be answered.
    const h = harness({ events: events(['DefeatedMonsterGoblin'], ['DefeatedMonsterGoblin']) })
    const m = monster('m1')
    h.runtime.monsters.push(m)
    h.events.current = 'SomethingElse'

    new RoundControllerMoM(h.context).defeated(m)

    expect(h.events.current).toBe('DefeatedMonsterGoblin')
  })

  it('drives the monster phase onward when nothing opened', () => {
    const h = harness()
    const first = monster('m1')
    const second = monster('m2')
    h.runtime.monsters.push(first, second)
    const controller = new RoundControllerMoM({
      ...h.context,
      monsterTypes: new Map([['MonsterGoblin', { sectionName: 'MonsterGoblin', activations: [] }]]),
      contentActivations: new Map([
        ['MonsterActivationGoblinA', activation('MonsterActivationGoblinA')],
      ]),
    })
    controller.phase = MoMPhase.monsters

    controller.defeated(first)

    // The surviving monster was activated rather than the phase stalling.
    expect(h.requests).toEqual([{ kind: 'activationMoM', monster: second }])
  })

  it('does not drive the phase onward while an event is open', () => {
    const h = harness({ events: events(['DefeatedMonsterGoblin'], ['DefeatedMonsterGoblin']) })
    const first = monster('m1')
    h.runtime.monsters.push(first, monster('m2'))
    const controller = new RoundControllerMoM(h.context)
    controller.phase = MoMPhase.monsters

    controller.defeated(first)

    expect(h.requests).toEqual([])
  })
})

describe('monster health', () => {
  const goblin = { healthBase: 3, healthPerHero: 0.5 }

  it('scales with the party, ignoring empty seats', () => {
    const h = harness()
    h.runtime.heroes.push(
      { heroName: 'h1', activated: false },
      { heroName: 'h2', activated: false },
      { heroName: null, activated: false },
    )
    const m = monster('m1')
    h.runtime.monsters.push(m)

    expect(h.runtime.heroCount()).toBe(2)
    expect(h.runtime.monsterHealth(m, goblin)).toBe(4)
  })

  it('adds the scenario modifier', () => {
    const h = harness()
    h.runtime.heroes.push({ heroName: 'h1', activated: false })
    const m = monster('m1')
    m.health = 2
    h.runtime.monsters.push(m)

    expect(h.runtime.monsterHealth(m, goblin)).toBe(6)
  })

  it('rounds halves to even, as Mathf.RoundToInt does', () => {
    const h = harness()
    h.runtime.heroes.push({ heroName: 'h1', activated: false })
    const m = monster('m1')
    h.runtime.monsters.push(m)

    // 3 + 1 * 0.5 = 3.5, which banker's rounding takes to 4.
    expect(h.runtime.monsterHealth(m, goblin)).toBe(4)
    // 2 + 1 * 0.5 = 2.5, which goes to 2 rather than 3.
    expect(h.runtime.monsterHealth(m, { healthBase: 2, healthPerHero: 0.5 })).toBe(2)
  })

  it('clamps damage to the monster’s range', () => {
    const h = harness()
    const m = monster('m1')

    h.runtime.setDamage(m, -3, 4)
    expect(m.damage).toBe(0)
    h.runtime.setDamage(m, 9, 4)
    expect(m.damage).toBe(4)
    h.runtime.setDamage(m, 2, 4)
    expect(m.damage).toBe(2)
  })
})
