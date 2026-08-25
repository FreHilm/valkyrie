/**
 * Tests for the quest session (T-018).
 *
 * The C# has no equivalent to this class: its screens call into
 * `Game.Get().CurrentQuest` directly and build themselves in constructors, so
 * "what should be showing" is never a value anywhere. That is why the play loop
 * cannot be tested there, and what these tests exist to cover here.
 *
 * The rules that matter most are the ones that make a scenario move at all:
 * invisible events run themselves, and an event nobody can answer still offers
 * a way out.
 */

import { describe, expect, it } from 'vitest'

import { readFromString } from '../src/ini/IniRead.js'
import { loadQuestSections } from '../src/quest/Quest.js'
import { bundleQuest } from '../src/quest/questAdapter.js'
import { QuestSession } from '../src/quest/QuestSession.js'
import { MoMPhase } from '../src/quest/RoundController.js'

function session(ini: string, random: (n: number) => number = () => 0): QuestSession {
  const components = loadQuestSections(readFromString(ini), 'test.ini', {})
  const built = new QuestSession({ bundle: bundleQuest(components), components, random })
  built.runtime.heroes.push({ heroName: 'HeroAshcanPete', activated: false })
  return built
}

describe('QuestSession', () => {
  it('starts on the EventStart trigger', () => {
    const quest = session(`[EventOpening]
trigger=EventStart
buttons=1
event1=
`)
    quest.start()
    const view = quest.view()

    expect(view.kind).toBe('event')
    expect(view.kind === 'event' && view.name).toBe('EventOpening')
  })

  it('shows the board when no event is open', () => {
    expect(session('[EventIdle]\n').view().kind).toBe('board')
  })

  describe('invisible events', () => {
    it('runs a display=false event without showing it', () => {
      // A scenario chains dozens of these between the events a player reads.
      // Without this the quest stops at the first one.
      const quest = session(`[EventStart1]
trigger=EventStart
display=false
buttons=1
event1=EventVisible
[EventVisible]
buttons=1
event1=
`)
      quest.start()

      expect(quest.view().kind === 'event' && quest.view().name).toBe('EventVisible')
    })

    it('runs a whole chain of them', () => {
      const quest = session(`[EventA]
trigger=EventStart
display=false
buttons=1
event1=EventB
[EventB]
display=false
buttons=1
event1=EventC
[EventC]
display=false
buttons=1
event1=EventD
[EventD]
buttons=1
event1=
`)
      quest.start()

      expect(quest.view().kind === 'event' && quest.view().name).toBe('EventD')
    })

    it('takes the first enabled button, skipping gated ones', () => {
      // TakeWhile(b => !IsButtonEnabled(b)).Count() in the C#: a chain whose
      // first option is gated falls through to the next.
      const quest = session(`[EventGate]
trigger=EventStart
display=false
buttons=2
event1=EventLocked
event2=EventOpen
event1Condition=VarOperation:$never,>,0
[EventLocked]
buttons=1
event1=
[EventOpen]
buttons=1
event1=
`)
      quest.start()

      expect(quest.view().kind === 'event' && quest.view().name).toBe('EventOpen')
    })

    it('leaves the board when an invisible event chains to nothing', () => {
      const quest = session(`[EventGlue]
trigger=EventStart
display=false
buttons=0
add=UIContinue
[UIContinue]
buttons=1
event1=
`)
      quest.start()

      expect(quest.view().kind).toBe('board')
      // The UI element it placed is what the player clicks next.
      expect(quest.runtime.boardItems().map((i) => i.name)).toContain('UIContinue')
    })

    it('gives up rather than hanging on a cycle of invisible events', () => {
      const quest = session(`[EventLoopA]
trigger=EventStart
display=false
buttons=1
event1=EventLoopB
[EventLoopB]
display=false
buttons=1
event1=EventLoopA
`)
      quest.start()

      expect(quest.runtime.log.toArray().some((e) => e.entry.includes('looping'))).toBe(true)
    })
  })

  describe('buttons', () => {
    it('hides a button whose condition fails with the HIDE action', () => {
      const quest = session(`[EventChoice]
trigger=EventStart
buttons=2
event1=EventOne
event2=EventTwo
event1Condition=VarOperation:$never,>,0
event1ConditionAction=HIDE
[EventOne]
[EventTwo]
`)
      quest.start()
      const view = quest.view()

      expect(view.kind === 'event' && view.buttons.map((b) => b.index)).toEqual([1])
    })

    it('disables rather than hides by default', () => {
      const quest = session(`[EventChoice]
trigger=EventStart
buttons=2
event1=EventOne
event2=EventTwo
event1Condition=VarOperation:$never,>,0
[EventOne]
[EventTwo]
`)
      quest.start()
      const view = quest.view()

      expect(view.kind === 'event' && view.buttons[0]?.disabled).toBe(true)
      expect(view.kind === 'event' && view.buttons[1]?.disabled).toBe(false)
    })

    it('keeps the original index when a button is hidden, so the rest do not renumber', () => {
      const quest = session(`[EventChoice]
trigger=EventStart
buttons=3
event1=EventOne
event2=EventTwo
event3=EventThree
event1Condition=VarOperation:$never,>,0
event1ConditionAction=HIDE
[EventOne]
[EventTwo]
[EventThree]
`)
      quest.start()
      const view = quest.view()

      expect(view.kind === 'event' && view.buttons.map((b) => b.index)).toEqual([1, 2])
    })

    it('offers a Continue when nothing else is pressable', () => {
      // Without it the player is trapped on an event they cannot answer.
      const quest = session(`[EventDeadEnd]
trigger=EventStart
buttons=1
event1=EventNext
event1Condition=VarOperation:$never,>,0
[EventNext]
`)
      quest.start()
      const view = quest.view()

      expect(view.kind === 'event' && view.buttons.some((b) => b.label === 'Continue')).toBe(true)
      expect(view.kind === 'event' && view.buttons.some((b) => !b.disabled)).toBe(true)
    })
  })

  it('applies an event’s operations and board changes when it runs', () => {
    const quest = session(`[EventOpening]
trigger=EventStart
operations=$doom,=,3
add=TileFoyer
buttons=1
event1=
[TileFoyer]
side=TileSideFoyer
`)
    quest.start()

    expect(quest.runtime.vars.getValue('$doom')).toBe(3)
    expect(quest.runtime.boardItems().map((i) => i.name)).toEqual(['TileFoyer'])
  })

  it('reports the quest as ended once $end is set', () => {
    const quest = session(`[EventFinal]
trigger=EventStart
operations=$end,=,1
buttons=1
event1=
`)
    quest.start()
    quest.press(0)

    expect(quest.view().kind).toBe('ended')
  })

  it('fires an event when the player activates something on the board', () => {
    const quest = session(`[EventOpening]
trigger=EventStart
display=false
buttons=0
add=TokenDoor
[TokenDoor]
buttons=1
event1=
`)
    quest.start()
    expect(quest.view().kind).toBe('board')

    quest.activate('TokenDoor')

    expect(quest.view().kind === 'event' && quest.view().name).toBe('TokenDoor')
  })

  it('moves into the mythos phase when the investigators finish', () => {
    const quest = session('[EventIdle]\n')
    quest.investigatorsDone()

    expect(quest.rounds.phase).toBe(MoMPhase.mythos)
    expect(quest.view().kind).toBe('phase')
  })

  it('prefers an open event over a pending activation', () => {
    // An event raised during an activation is what the player answers first.
    const quest = session(`[EventInterrupt]
trigger=Mythos
buttons=1
event1=
`)
    quest.investigatorsDone()

    expect(quest.view().kind).toBe('event')
  })
})
