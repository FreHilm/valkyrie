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

import { DictionaryI18n } from '../src/i18n/DictionaryI18n.js'
import { Localization } from '../src/i18n/Localization.js'
import { readFromString } from '../src/ini/IniRead.js'
import { loadQuestSections } from '../src/quest/Quest.js'
import { bundleQuest } from '../src/quest/questAdapter.js'
import { QuestSession } from '../src/quest/QuestSession.js'
import { MoMPhase } from '../src/quest/RoundController.js'

function session(
  ini: string,
  random: (n: number) => number = () => 0,
  isQuestTransition?: (name: string) => boolean,
): QuestSession {
  const components = loadQuestSections(readFromString(ini), 'test.ini', {})
  const built = new QuestSession({
    bundle: bundleQuest(components),
    components,
    random,
    ...(isQuestTransition === undefined ? {} : { isQuestTransition }),
  })
  built.runtime.heroes.push({ heroName: 'HeroAshcanPete', activated: false })
  return built
}

/**
 * A session whose scenario text actually resolves.
 *
 * The bare harness registers no dictionary, so every `{qst:...}` lookup comes
 * back as its own key — fine for the routing tests, useless for anything that
 * asserts on prose.
 */
function localizedSession(ini: string, text: readonly string[]): QuestSession {
  const components = loadQuestSections(readFromString(ini), 'test.ini', {})
  const localization = new Localization()
  localization.addDictionary('qst', new DictionaryI18n(['.,English', ...text]))
  const built = new QuestSession({
    bundle: bundleQuest(components),
    components,
    random: () => 0,
    localization,
  })
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

  it('runs an activated component that does not display without showing it', () => {
    // A scenario's own UI is built from these: the button that turns a
    // cutscene page adds the next page, removes itself and shows nothing.
    const quest = session(`[EventOpening]
trigger=EventStart
display=false
buttons=0
add=UIContinue1
[UIContinue1]
display=false
buttons=0
add=UIContinue2
remove=UIContinue1
[UIContinue2]
display=false
buttons=0
`)
    quest.start()

    quest.activate('UIContinue1')

    expect(quest.view().kind).toBe('board')
    expect(quest.runtime.has('UIContinue2')).toBe(true)
    expect(quest.runtime.has('UIContinue1')).toBe(false)
  })

  it('runs an invisible Defeated event without showing it', () => {
    const quest = session(`[EventIdle]
[EventLoot]
trigger=DefeatedMonsterZombie
display=false
buttons=0
add=TokenLoot
[TokenLoot]
buttons=1
event1=
`)
    quest.runtime.monsters.push({
      monsterName: 'MonsterZombie',
      spawnedBy: 'SpawnA',
      unique: false,
      health: 0,
      damage: 0,
      activated: false,
      minionStarted: false,
      masterStarted: false,
      currentActivation: null,
    })

    quest.defeat(quest.runtime.monsters[0]!)

    expect(quest.view().kind).toBe('board')
    expect(quest.runtime.has('TokenLoot')).toBe(true)
  })

  it('hands over when an event names another scenario instead of its own', () => {
    // `EventManager.cs:129`: a name that is not an event but *is* a file is a
    // scenario to change to. The demo quest's every branch is one of these,
    // and without it the button does nothing at all.
    const quest = session(
      `[EventOpening]
trigger=EventStart
buttons=1
event1=examples/tokenvar/quest.ini
`,
      () => 0,
      (name) => name === 'examples/tokenvar/quest.ini',
    )
    quest.start()
    quest.press(0)

    const view = quest.view()
    expect(view.kind).toBe('changeQuest')
    expect(view.kind === 'changeQuest' && view.path).toBe('examples/tokenvar/quest.ini')
  })

  it('still warns about a name that is neither an event nor a scenario', () => {
    const quest = session(`[EventOpening]
trigger=EventStart
buttons=1
event1=EventNowhere
`)
    quest.start()
    quest.press(0)

    expect(quest.view().kind).toBe('board')
    expect(quest.runtime.log.toArray().some((e) => e.entry.includes('Missing event'))).toBe(true)
  })

  it('keeps the heroes and the campaign vars across a handover', () => {
    // `TrimQuest` keeps `%` and `$%`; the board and the monsters do not come.
    const quest = session('[EventIdle]\n')
    quest.runtime.vars.setValue('%campaign', 3)
    quest.runtime.vars.setValue('local', 7)
    quest.runtime.spawnMonster('MonsterZombie', 'SpawnA')

    quest.changeQuest()

    expect(quest.runtime.heroes).toHaveLength(1)
    expect(quest.runtime.vars.getValue('%campaign')).toBe(3)
    expect(quest.runtime.vars.getValue('local')).toBe(0)
    expect(quest.runtime.monsters).toEqual([])
    expect(quest.view().kind).toBe('board')
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

describe('spawning monsters', () => {
  const withContent = (ini: string, contentMonsters: Map<string, unknown>) => {
    const components = loadQuestSections(readFromString(ini), 'test.ini', {})
    const built = new QuestSession({
      bundle: bundleQuest(components),
      components,
      contentMonsters: contentMonsters as never,
      random: () => 0,
    })
    built.runtime.heroes.push({ heroName: 'HeroAshcanPete', activated: false })
    return built
  }

  const ZOMBIE = new Map([['MonsterZombie', { traits: ['undead'], activations: [] }]])

  it('places a monster when a spawn event runs', () => {
    const quest = withContent(
      `[SpawnA]
trigger=EventStart
monster=MonsterZombie
buttons=1
event1=
`,
      ZOMBIE,
    )
    quest.start()

    expect(quest.runtime.monsters.map((m) => m.monsterName)).toEqual(['MonsterZombie'])
    expect(quest.runtime.vars.getValue('#monsters')).toBe(1)
  })

  it('records the spawn section a monster came from', () => {
    const quest = withContent(
      '[SpawnA]\ntrigger=EventStart\nmonster=MonsterZombie\nbuttons=1\nevent1=\n',
      ZOMBIE,
    )
    quest.start()

    expect(quest.runtime.monsters[0]?.spawnedBy).toBe('SpawnA')
  })

  it('resolves a spawn described by traits', () => {
    const quest = withContent(
      '[SpawnA]\ntrigger=EventStart\ntraits=undead\nbuttons=1\nevent1=\n',
      ZOMBIE,
    )
    quest.start()

    expect(quest.runtime.monsters.map((m) => m.monsterName)).toEqual(['MonsterZombie'])
  })

  it('warns rather than silently placing nothing when the type is unknown', () => {
    const quest = withContent(
      '[SpawnA]\ntrigger=EventStart\nmonster=MonsterNope\nbuttons=1\nevent1=\n',
      ZOMBIE,
    )
    quest.start()

    expect(quest.runtime.monsters).toHaveLength(0)
    expect(quest.runtime.log.toArray().some((e) => e.entry.includes('Monster type unknown'))).toBe(
      true,
    )
  })

  it('gives a content monster its activations, so its turn is not skipped', () => {
    // A type absent from the merged monsterTypes map draws no activations at
    // all, which reads as "no activation data" and skips the monster's turn.
    const quest = withContent(
      '[SpawnA]\ntrigger=EventStart\nmonster=MonsterZombie\nbuttons=1\nevent1=\n',
      new Map([['MonsterZombie', { traits: ['undead'], activations: ['Common'] }]]),
    )
    quest.start()
    quest.investigatorsDone()

    // No error about missing activation data.
    expect(
      quest.runtime.log.toArray().some((e) => e.entry.includes('Unable to find any activation')),
    ).toBe(false)
  })

  it('lets a quest monster override a content monster of the same name', () => {
    const quest = withContent(
      `[SpawnA]
trigger=EventStart
monster=MonsterZombie
buttons=1
event1=
[MonsterZombie]
base=MonsterOther
activation=Custom
`,
      ZOMBIE,
    )
    quest.start()

    expect(quest.runtime.monsters.map((m) => m.monsterName)).toEqual(['MonsterZombie'])
  })
})

describe('puzzles', () => {
  const puzzleQuest = (kind: string, extra = '') => `[EventOpen]
trigger=EventStart
display=false
buttons=1
event1=PuzzleThing
[PuzzleThing]
class=${kind}
level=3
altlevel=3
buttons=1
event1=EventAfter
${extra}
[EventAfter]
buttons=1
event1=
`

  it('opens a puzzle instead of a dialog', () => {
    // EventManager.cs:309 opens the window and returns; the event's buttons do
    // not appear until it is solved.
    const quest = session(puzzleQuest('tower'))
    quest.start()
    const view = quest.view()

    expect(view.kind).toBe('puzzle')
    expect(view.kind === 'puzzle' && view.puzzle.kind).toBe('tower')
    expect(view.kind === 'puzzle' && view.puzzle.solved).toBe(false)
  })

  it('builds each kind the quest can ask for', () => {
    for (const kind of ['tower', 'code', 'image']) {
      const quest = session(puzzleQuest(kind))
      quest.start()

      expect(quest.view().kind).toBe('puzzle')
    }
  })

  it('keeps the same board when the player steps away and returns', () => {
    // Quest.puzzle holds them so a player comes back to their progress rather
    // than a fresh puzzle.
    const quest = session(puzzleQuest('tower'))
    quest.start()
    const first = quest.view()
    const state = first.kind === 'puzzle' ? first.puzzle.state : null

    quest.closePuzzle()
    quest.activate('PuzzleThing')
    const second = quest.view()

    expect(second.kind === 'puzzle' && second.puzzle.state).toBe(state)
  })

  it('takes the event’s button once it is solved', () => {
    const quest = session(puzzleQuest('tower'))
    quest.start()
    quest.finishPuzzle('PuzzleThing')

    expect(quest.view().kind === 'event' && quest.view().name).toBe('EventAfter')
  })

  it('discards a solved puzzle, so opening it again is a fresh one', () => {
    const quest = session(puzzleQuest('tower'))
    quest.start()
    const first = quest.view()
    const state = first.kind === 'puzzle' ? first.puzzle.state : null

    quest.finishPuzzle('PuzzleThing')
    quest.activate('PuzzleThing')
    const second = quest.view()

    expect(second.kind === 'puzzle' && second.puzzle.state).not.toBe(state)
  })

  it('says so rather than opening an empty slide puzzle with no layouts', () => {
    // Slide layouts are shipped data, not generated. The C# calls
    // Application.Quit() when it cannot find one.
    const quest = session(puzzleQuest('slide'))
    quest.start()
    // The puzzle is built when the screen asks what to show, not when the
    // event fires — so the failure surfaces there.
    const view = quest.view()

    expect(view.kind).toBe('event')
    expect(quest.runtime.log.toArray().some((e) => e.entry.includes('Unable to build'))).toBe(true)
  })

  it('builds a slide puzzle from the layouts it is given', () => {
    const components = loadQuestSections(readFromString(puzzleQuest('slide')), 'test.ini', {})
    const layouts = new Map([
      [
        'PuzzleSlide1',
        new Map([
          ['moves', '3'],
          ['block0', 'False,2,1,0,2,True'],
        ]),
      ],
    ])
    const quest = new QuestSession({
      bundle: bundleQuest(components),
      components,
      slideLayouts: layouts,
      random: () => 0,
    })
    quest.runtime.heroes.push({ heroName: 'HeroAshcanPete', activated: false })
    quest.start()

    expect(quest.view().kind).toBe('puzzle')
  })
})

/**
 * The quest log, which `DialogWindow.onButton` fills as the player answers.
 *
 * Nothing else writes the prose a player read; the round controller adds only
 * "Round N" and the phase names. Without this the Log button opens on an empty
 * list however far into a scenario it is pressed.
 */
/**
 * The quest log, which `DialogWindow.onButton` fills as the player answers.
 *
 * Nothing else writes the prose a player read; the round controller adds only
 * "Round N" and the phase names. Without this the Log button opens on an empty
 * list however far into a scenario it is pressed.
 */
describe('QuestSession log', () => {
  it('writes what the player read when they answer an event', () => {
    const quest = localizedSession(
      `[EventOpening]
trigger=EventStart
buttons=1
event1=
`,
      ['EventOpening.text,The office is thick with cigarette smoke.'],
    )
    quest.start()
    quest.press(0)

    expect(quest.runtime.log.toArray().map((e) => e.entry)).toEqual([
      'The office is thick with cigarette smoke.',
    ])
  })

  it('escapes newlines the way a save file carries them', () => {
    // `text.Replace("\n", "\\n")`, which the log screen turns back.
    const quest = localizedSession(
      `[EventOpening]
trigger=EventStart
buttons=1
event1=
`,
      ['EventOpening.text,First line.\\nSecond line.'],
    )
    quest.start()
    quest.press(0)

    expect(quest.runtime.log.toArray()[0]?.entry).toBe('First line.\\nSecond line.')
  })

  it('keeps the glue between pages out of the log', () => {
    // A scenario chains `display=false` events by the dozen. The C# never
    // builds a dialog for one, so `onButton` never runs and none of them are
    // logged — only the pages a player actually answered.
    const quest = localizedSession(
      `[EventOpening]
trigger=EventStart
buttons=1
event1=EventGlue
[EventGlue]
display=false
buttons=1
event1=EventNext
[EventNext]
buttons=1
event1=
`,
      [
        'EventOpening.text,You arrive.',
        'EventGlue.text,bookkeeping',
        'EventNext.text,The door is open.',
      ],
    )
    quest.start()
    quest.press(0)

    expect(quest.runtime.log.toArray().map((e) => e.entry)).toEqual(['You arrive.'])
  })
})
