/**
 * Tests for the event engine (T-018).
 *
 * `EventManager.cs` has no tests — it reaches for `Game.Get()` on nearly every
 * line, so it cannot run outside a live application. The port injects its
 * dependencies instead, which is what makes these possible at all.
 *
 * The semantics asserted here are read from the C# and are the ones most
 * easily got wrong: what gets queued, in what order, and when the quest ends.
 */

import { describe, expect, it, vi } from 'vitest'

import { EventManager } from '../src/quest/EventManager.js'
import type { EventContext, EventDefinition } from '../src/quest/EventManager.js'
import { QuestLog } from '../src/quest/QuestLog.js'
import { VarManager } from '../src/quest/VarManager.js'
import { VarTests } from '../src/quest/VarTests.js'

/** Builds a var test the way a quest ini carries one. */
function parseTests(expression: string): VarTests {
  const [name, operator, value] = expression.split(/\s+/)
  const tests = new VarTests()
  tests.addFromString(`VarOperation:${name},${operator},${value}`)
  return tests
}

const event = (overrides: Partial<EventDefinition> & { sectionName: string }): EventDefinition => ({
  trigger: '',
  tests: null,
  buttons: [],
  randomEvents: false,
  ...overrides,
})

function make(
  events: EventDefinition[],
  extra: Partial<EventContext> = {},
): { manager: EventManager; presented: string[]; context: EventContext } {
  const presented: string[] = []
  const context: EventContext = {
    vars: new VarManager(),
    log: new QuestLog(),
    events: new Map(events.map((e) => [e.sectionName, e])),
    present: (e) => presented.push(e.sectionName),
    ...extra,
  }
  return { manager: new EventManager(context), presented, context }
}

describe('queue', () => {
  it('runs an event immediately when nothing else is running', () => {
    const { manager, presented } = make([event({ sectionName: 'Start' })])

    expect(manager.queue('Start')).toBe(true)
    expect(presented).toEqual(['Start'])
    expect(manager.current?.sectionName).toBe('Start')
  })

  it('only stacks the event when told not to trigger', () => {
    const { manager, presented } = make([event({ sectionName: 'Later' })])
    manager.queue('Later', false)

    expect(presented).toEqual([])
    expect(manager.queued).toEqual(['Later'])
  })

  // Scenarios do ship with dangling references; the C# logs and carries on.
  it('logs a missing event rather than throwing', () => {
    const { manager, context } = make([])

    expect(manager.queue('Nope')).toBe(false)
    expect(context.log.toArray()[0]?.entry).toContain('Missing event called: Nope')
  })

  it('records that warning as an editor entry, not player-facing text', () => {
    const { manager, context } = make([])
    manager.queue('Nope')

    expect(context.log.toArray()[0]?.kind).toBe('editor')
  })

  // A name that is not an event may be another quest file.
  it('accepts a quest transition in place of an event', () => {
    const { manager } = make([], { isQuestTransition: (name) => name === 'chapter2.ini' })

    expect(manager.queue('chapter2.ini')).toBe(true)
  })

  it('refuses an event whose tests fail', () => {
    const vars = new VarManager()
    vars.setValue('locked', 1)
    const { manager, presented } = make(
      [event({ sectionName: 'Gated', tests: parseTests('locked == 0') })],
      { vars },
    )

    expect(manager.queue('Gated')).toBe(false)
    expect(presented).toEqual([])
  })

  it('is a stack, so the last queued runs first', () => {
    const { manager, presented } = make([event({ sectionName: 'A' }), event({ sectionName: 'B' })])
    manager.queue('A', false)
    manager.queue('B', false)
    manager.triggerEvent()

    expect(presented).toEqual(['B'])
  })
})

describe('triggerType', () => {
  it('queues every event with a matching trigger, not just the first', () => {
    const { manager } = make([
      event({ sectionName: 'A', trigger: 'EventStart' }),
      event({ sectionName: 'B', trigger: 'EventStart' }),
      event({ sectionName: 'C', trigger: 'Other' }),
    ])

    expect(manager.triggerType('EventStart', false)).toBe(true)
    expect([...manager.queued].sort()).toEqual(['A', 'B'])
  })

  it('reports false when nothing matches', () => {
    const { manager } = make([event({ sectionName: 'A', trigger: 'X' })])

    expect(manager.triggerType('Nothing', false)).toBe(false)
  })
})

describe('endEvent', () => {
  it('chains to the first event of the pressed button', () => {
    const { manager, presented } = make([
      event({ sectionName: 'Start', buttons: [{ eventNames: ['Next'] }] }),
      event({ sectionName: 'Next' }),
    ])
    manager.queue('Start')
    manager.endEvent(0)

    expect(presented).toEqual(['Start', 'Next'])
  })

  /**
   * Only *one* chained event is queued — the first enabled one. The rest of
   * the button's list is discarded, which reads like a bug and is not: the
   * list exists so a scenario can offer alternatives gated by var tests.
   */
  it('queues only the first enabled event, discarding the rest', () => {
    const { manager, presented } = make([
      event({ sectionName: 'Start', buttons: [{ eventNames: ['A', 'B', 'C'] }] }),
      event({ sectionName: 'A' }),
      event({ sectionName: 'B' }),
      event({ sectionName: 'C' }),
    ])
    manager.queue('Start')
    manager.endEvent(0)

    expect(presented).toEqual(['Start', 'A'])
    expect(manager.queued).toEqual([])
  })

  it('skips a disabled alternative and takes the next', () => {
    const vars = new VarManager()
    vars.setValue('haveKey', 0)
    const { manager, presented } = make(
      [
        event({ sectionName: 'Start', buttons: [{ eventNames: ['Locked', 'Open'] }] }),
        event({ sectionName: 'Locked', tests: parseTests('haveKey == 1') }),
        event({ sectionName: 'Open' }),
      ],
      { vars },
    )
    manager.queue('Start')
    manager.endEvent(0)

    expect(presented).toEqual(['Start', 'Open'])
  })

  it('picks at random when the event says to', () => {
    const random = vi.fn(() => 2)
    const { manager, presented } = make(
      [
        event({
          sectionName: 'Start',
          randomEvents: true,
          buttons: [{ eventNames: ['A', 'B', 'C'] }],
        }),
        event({ sectionName: 'A' }),
        event({ sectionName: 'B' }),
        event({ sectionName: 'C' }),
      ],
      { random },
    )
    manager.queue('Start')
    manager.endEvent(0)

    expect(random).toHaveBeenCalledWith(3)
    expect(presented).toEqual(['Start', 'C'])
  })

  it('follows the button that was actually pressed', () => {
    const { manager, presented } = make([
      event({
        sectionName: 'Start',
        buttons: [{ eventNames: ['Yes'] }, { eventNames: ['No'] }],
      }),
      event({ sectionName: 'Yes' }),
      event({ sectionName: 'No' }),
    ])
    manager.queue('Start')
    manager.endEvent(1)

    expect(presented).toEqual(['Start', 'No'])
  })

  it('ends quietly when the button chains nowhere', () => {
    const { manager } = make([event({ sectionName: 'Start', buttons: [{ eventNames: [] }] })])
    manager.queue('Start')
    manager.endEvent(0)

    expect(manager.current).toBeNull()
  })

  /**
   * `$end` is checked *before* anything is queued, so an event that sets it
   * ends the quest even when its button also chains onward.
   */
  it('ends the quest when $end is set, ignoring the chain', () => {
    const vars = new VarManager()
    const { manager, presented } = make(
      [
        event({ sectionName: 'Final', buttons: [{ eventNames: ['Next'] }] }),
        event({ sectionName: 'Next' }),
      ],
      { vars },
    )
    manager.queue('Final')
    vars.setValue('$end', 1)
    manager.endEvent(0)

    expect(manager.questHasEnded).toBe(true)
    expect(presented).toEqual(['Final'])
  })

  it('continues with what is already stacked once an event finishes', () => {
    const { manager, presented } = make([event({ sectionName: 'A' }), event({ sectionName: 'B' })])
    manager.queue('B', false)
    manager.queue('A')
    manager.endEvent(0)

    expect(presented).toEqual(['A', 'B'])
  })

  it('does nothing when no event is running', () => {
    const { manager } = make([])

    expect(() => manager.endEvent(0)).not.toThrow()
  })
})

describe('triggerEvent', () => {
  // A var can change between queueing and running, so the check happens twice.
  it('skips an event that became disabled while queued', () => {
    const vars = new VarManager()
    const { manager, presented } = make(
      [
        event({ sectionName: 'Gated', tests: parseTests('open == 1') }),
        event({ sectionName: 'Other' }),
      ],
      { vars },
    )
    vars.setValue('open', 1)
    manager.queue('Gated', false)
    manager.queue('Other', false)
    vars.setValue('open', 0)

    manager.triggerEvent()
    manager.current = null
    manager.triggerEvent()

    expect(presented).toEqual(['Other'])
  })

  it('does nothing while an event is already running', () => {
    const { manager, presented } = make([event({ sectionName: 'A' }), event({ sectionName: 'B' })])
    manager.queue('A')
    manager.queue('B', false)
    manager.triggerEvent()

    expect(presented).toEqual(['A'])
  })
})

/**
 * `AddCustomTriggers` — the hook a scenario uses to fire an event from a var
 * rather than from a button. It runs at the end of every `EndEvent`, and was
 * missing from the port entirely until the rounds differential went looking
 * for it.
 */
describe('custom var triggers', () => {
  it('fires Var<name> when a quest var is raised, and clears the flag', () => {
    const vars = new VarManager()
    vars.setValue('@alarm', 1)
    const { manager, presented } = make(
      [event({ sectionName: 'Opening' }), event({ sectionName: 'Alarm', trigger: 'Varalarm' })],
      { vars },
    )

    manager.queue('Opening')
    manager.endEvent()

    expect(presented).toEqual(['Opening', 'Alarm'])
    // Cleared, so the next event does not fire it again.
    expect(vars.getValue('@alarm')).toBe(0)
  })

  it('collapses the campaign-scoped prefix onto the same trigger name', () => {
    const vars = new VarManager()
    vars.setValue('$@ritual', 1)
    const { manager, presented } = make(
      [event({ sectionName: 'Opening' }), event({ sectionName: 'Ritual', trigger: 'Var$ritual' })],
      { vars },
    )

    manager.queue('Opening')
    manager.endEvent()

    expect(presented).toEqual(['Opening', 'Ritual'])
    expect(vars.getValue('$@ritual')).toBe(0)
  })

  it('ignores a flag that is not positive', () => {
    const vars = new VarManager()
    vars.setValue('@alarm', 0)
    const { manager, presented } = make(
      [event({ sectionName: 'Opening' }), event({ sectionName: 'Alarm', trigger: 'Varalarm' })],
      { vars },
    )

    manager.queue('Opening')
    manager.endEvent()

    expect(presented).toEqual(['Opening'])
  })
})

describe('monster image and the round hook', () => {
  it('clears the monster portrait once the stack drains', () => {
    const { manager } = make([event({ sectionName: 'Attack' })])
    manager.queue('Attack')
    manager.monsterImage = { monsterName: 'MonsterGoblin' } as never

    manager.endEvent()

    expect(manager.monsterImage).toBeNull()
  })

  it('hands control back to the round controller during the monster phase', () => {
    const activated: number[] = []
    const { manager, presented } = make([event({ sectionName: 'Attack' })], {
      rounds: {
        inMonsterPhase: () => true,
        monsterActivated: () => activated.push(1),
      },
    })
    manager.queue('Attack')
    manager.endEvent()

    expect(activated).toEqual([1])
    expect(presented).toEqual(['Attack'])
  })

  it('does not hand back while events remain queued', () => {
    const activated: number[] = []
    const { manager } = make(
      [
        event({ sectionName: 'Attack', buttons: [{ eventNames: ['Next'] }] }),
        event({ sectionName: 'Next' }),
      ],
      {
        rounds: {
          inMonsterPhase: () => true,
          monsterActivated: () => activated.push(1),
        },
      },
    )
    manager.queue('Attack')
    manager.endEvent()

    expect(activated).toEqual([])
  })
})
