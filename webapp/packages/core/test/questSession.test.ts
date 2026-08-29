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
function localizedSession(
  ini: string,
  text: readonly string[],
  contentName?: (kind: 'tileSide' | 'monster' | 'item', name: string) => string | null,
): QuestSession {
  const components = loadQuestSections(readFromString(ini), 'test.ini', {})
  const localization = new Localization()
  localization.addDictionary('qst', new DictionaryI18n(['.,English', ...text]))
  const built = new QuestSession({
    bundle: bundleQuest(components),
    components,
    random: () => 0,
    localization,
    ...(contentName === undefined ? {} : { contentName }),
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

  it('moves into the mythos phase when it has something to say', () => {
    const quest = session(`[EventIdle]
[EventOmen]
trigger=Mythos
buttons=1
event1=
`)
    quest.investigatorsDone()

    expect(quest.rounds.phase).toBe(MoMPhase.mythos)
  })

  it('turns the round over when the mythos has nothing to add', () => {
    // `HeroActivated` ends by calling `TriggerEvent`, whose first act is
    // `CheckNewRound` — "this will cause the next phase if nothing was added",
    // as the C# puts it. A phase with no events of its own does not sit there
    // waiting to be dismissed.
    const quest = session('[EventIdle]\n')
    const before = quest.runtime.vars.getValue('#round')
    quest.investigatorsDone()

    expect(quest.runtime.vars.getValue('#round')).toBe(before + 1)
    expect(quest.rounds.phase).toBe(MoMPhase.investigator)
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

/**
 * Event quota, `DialogWindow.CreateQuotaWindow` and `onQuota`.
 *
 * Not "press it N times": the dialog is a spinner from 0 to 10 that the player
 * dials, and what they dial is either written into a variable or added to a
 * running total the event keeps. Six of the seven Mansions scenarios in the
 * library use it, and without it those events completed on the first press.
 */
describe('QuestSession quota', () => {
  const SEARCH = `[EventSearch]
trigger=EventStart
quota=3
buttons=2
event1=EventFound
event2=
[EventFound]
buttons=1
event1=
`

  it('offers a spinner instead of a choice', () => {
    const quest = session(SEARCH)
    quest.start()

    const view = quest.view()
    expect(view.kind).toBe('event')
    expect(view.kind === 'event' ? view.quota : null).toEqual({ value: 0, max: 10 })
  })

  it('draws only the first button, whatever the event declares', () => {
    // `CreateQuotaWindow` uses `GetButtons()[0]` and nothing else — the second
    // is the outcome for a total that has not got there, not a thing to press.
    const quest = session(SEARCH)
    quest.start()

    const view = quest.view()
    expect(view.kind === 'event' ? view.buttons.length : null).toBe(1)
  })

  it('takes the second button until the total reaches the quota', () => {
    const quest = session(SEARCH)
    quest.start()

    quest.pressQuota(1)
    expect(quest.runtime.eventQuota.get('EventSearch')).toBe(1)
    // Not there yet, so the event took its second button and ended.
    expect(quest.view().kind).toBe('board')
  })

  it('takes the first button once the total gets there, and forgets the tally', () => {
    const quest = session(SEARCH)
    quest.start()

    quest.pressQuota(2)
    expect(quest.runtime.eventQuota.get('EventSearch')).toBe(2)

    // The event runs again; two more takes it past three.
    quest.activate('EventSearch')
    quest.pressQuota(2)

    // Dropped rather than left at the total, so running it again starts over.
    expect(quest.runtime.eventQuota.has('EventSearch')).toBe(false)
    expect(quest.events.history).toContain('EventSearch')
  })

  it('writes what was dialled into the variable a quotaVar names', () => {
    const quest = session(`[EventClues]
trigger=EventStart
quota=$clues
buttons=1
event1=
`)
    quest.start()
    quest.pressQuota(4)

    expect(quest.runtime.vars.getValue('$clues')).toBe(4)
  })

  it('opens a quotaVar spinner on the value the variable already holds', () => {
    const quest = session(`[EventClues]
trigger=EventStart
quota=$clues
buttons=1
event1=
`)
    quest.runtime.vars.setValue('$clues', 3)
    quest.start()

    expect(quest.view().kind === 'event' ? quest.view().quota : null).toEqual({
      value: 3,
      max: 10,
    })
  })

  it('leaves an ordinary event alone', () => {
    const quest = session(`[EventPlain]
trigger=EventStart
buttons=2
event1=
event2=
`)
    quest.start()

    const view = quest.view()
    expect(view.kind === 'event' ? view.quota : 'absent').toBeUndefined()
    expect(view.kind === 'event' ? view.buttons.length : null).toBe(2)
  })
})

/**
 * `highlight`, and the single item an event hands over.
 *
 * `TokenBoard.AddHighlight` and `DialogWindow.DrawItem` ask the same question
 * of an event — exactly one resolved `QItem` among what it adds — and answer
 * it in different places: on the board when the event is a highlight, beside
 * the dialog when it is not. Both were parsed and neither was applied, so five
 * scenarios never showed the player where to look.
 */
describe('QuestSession highlight', () => {
  it('reports the space a highlight event points at', () => {
    const quest = session(`[EventLook]
trigger=EventStart
highlight=true
xposition=4
yposition=-2
buttons=1
event1=
`)
    quest.start()

    const view = quest.view()
    expect(view.kind === 'event' ? view.highlight : null).toEqual({ x: 4, y: -2 })
  })

  it('says nothing about a space for an ordinary event', () => {
    const quest = session(`[EventPlain]
trigger=EventStart
xposition=4
yposition=-2
buttons=1
event1=
`)
    quest.start()

    const view = quest.view()
    expect(view.kind === 'event' ? view.highlight : 'absent').toBeUndefined()
  })

  it('resolves the one item an event hands over', () => {
    // `itemSelect` is filled by setup, which resolves every `QItem` the quest
    // declares — not just the ones the party starts with.
    const quest = session(`[EventGive]
trigger=EventStart
add=QItemKey
buttons=1
event1=
[QItemKey]
itemname=ItemUniqueBrassKey
`)
    quest.runtime.itemSelect.set('QItemKey', 'ItemUniqueBrassKey')
    quest.start()

    const view = quest.view()
    expect(view.kind === 'event' ? view.grantedItem : null).toBe('ItemUniqueBrassKey')
  })

  it('names no card when the event hands over more than one thing', () => {
    // `AddHighlight` and `DrawItem` both bail at `items != 1`: no single card
    // could stand for two.
    const quest = session(`[EventGive]
trigger=EventStart
add=QItemKey QItemDiary
buttons=1
event1=
[QItemKey]
itemname=ItemUniqueBrassKey
[QItemDiary]
itemname=ItemUniqueCultistsJournal
`)
    quest.runtime.itemSelect.set('QItemKey', 'ItemUniqueBrassKey')
    quest.runtime.itemSelect.set('QItemDiary', 'ItemUniqueCultistsJournal')
    quest.start()

    const view = quest.view()
    expect(view.kind === 'event' ? view.grantedItem : 'absent').toBeUndefined()
  })

  it('names no card for an item the quest has not resolved', () => {
    const quest = session(`[EventGive]
trigger=EventStart
add=QItemMystery
buttons=1
event1=
`)
    quest.start()

    const view = quest.view()
    expect(view.kind === 'event' ? view.grantedItem : 'absent').toBeUndefined()
  })
})

/**
 * The combat log, which four dialogs write as they show their text.
 *
 * `ActivateDialogMoM.cs:35`, `InvestigatorAttack.cs:69`,
 * `InvestigatorEvade.cs:49` and `HorrorCheck.cs:65` each log what the player
 * just read. The port's dialogs already handed the text over; nothing was
 * listening, so the log held only event prose.
 */
describe('QuestSession logEntry', () => {
  const quest = () =>
    session(`[EventOpening]
trigger=EventStart
buttons=1
event1=
`)

  it('records what a dialog showed, where the player can read it back', () => {
    const q = quest()
    q.logEntry('The Cultist lunges. Roll {will}.')

    expect(q.runtime.log.toArray().map((e) => e.entry)).toEqual([
      'The Cultist lunges. Roll {will}.',
    ])
  })

  it('records it for the player, not for a scenario author', () => {
    // A warning is an editor entry and stays hidden; this is prose the player
    // read and must be able to read again.
    const q = quest()
    q.logEntry('The Cultist lunges.')
    q.logWarning('Warning: something is off')

    const entries = q.runtime.log.toArray()
    expect(entries[0]?.editor).toBe(false)
    expect(entries[1]?.editor).toBe(true)
  })

  it('keeps the escaping the dialogs applied, so a save round-trips it', () => {
    const q = quest()
    q.logEntry('First line.\\nSecond line.')

    expect(q.runtime.log.toArray()[0]?.entry).toBe('First line.\\nSecond line.')
  })

  it('writes nothing for a dialog that showed nothing', () => {
    const q = quest()
    q.logEntry('')

    expect(q.runtime.log.length).toBe(0)
  })
})

/**
 * The one arrow, `NextStageButton.Next`.
 *
 * A Mansions game has a single button in the corner, not one per phase. What
 * it does depends on where the round has got to, which is exactly the thing a
 * player should not have to work out.
 */
describe('QuestSession nextPhase', () => {
  it('declines while a dialog is up', () => {
    // `if (FindGameObjectWithTag(Game.DIALOG) != null) return`. The round is
    // not the player's to turn over until they have answered.
    const quest = session(`[EventOpening]
trigger=EventStart
buttons=1
event1=
`)
    quest.start()

    expect(quest.view().kind).toBe('event')
    expect(quest.nextPhase()).toBe(false)
    expect(quest.canUndo).toBe(false)
  })

  it('declines while a scenario’s own screen is on the board', () => {
    // `UIItemsPresent`: a cutscene page is a board component, and the round
    // cannot turn over underneath one.
    const quest = session(`[EventOpening]
trigger=EventStart
buttons=1
event1=
add=UIPage
[UIPage]
xposition=0
yposition=0
`)
    quest.start()
    quest.press(0)

    expect(quest.view().kind).toBe('board')
    expect(quest.nextPhase()).toBe(false)
  })

  it('hands the monster step over to horror rather than ending the round', () => {
    const quest = session('[EventIdle]\n')
    quest.rounds.phase = MoMPhase.monsters
    const round = quest.runtime.vars.getValue('#round')

    expect(quest.nextPhase()).toBe(true)
    expect(quest.rounds.phase).toBe(MoMPhase.horror)
    // The round is not over yet: the horror checks come first.
    expect(quest.runtime.vars.getValue('#round')).toBe(round)
  })

  it('ends the round from the horror step', () => {
    const quest = session('[EventIdle]\n')
    quest.rounds.phase = MoMPhase.horror
    const round = quest.runtime.vars.getValue('#round')

    expect(quest.nextPhase()).toBe(true)
    expect(quest.runtime.vars.getValue('#round')).toBe(round + 1)
  })

  it('names each phase from the val dictionary', () => {
    const quest = session('[EventIdle]\n')

    // Untranslated here, which is what a lookup with no dictionary gives; the
    // point is that each phase asks for its own key rather than sharing one.
    const names = [MoMPhase.investigator, MoMPhase.mythos, MoMPhase.monsters, MoMPhase.horror].map(
      (phase) => quest.phaseName(phase),
    )

    expect(new Set(names).size).toBe(4)
  })
})

/**
 * Phase announcements, `ChangePhaseWindow.DisplayTransitionWindow`.
 *
 * A round can turn over inside the very call that announced the mythos — an
 * empty mythos does exactly that — so two announcements are raised in one go.
 * The C# does not notice because its windows stack and expire together; this
 * port shows them one at a time, so both have to survive and in the order the
 * player lived them.
 */
describe('QuestSession phase announcements', () => {
  const idle = () => {
    const quest = session(`[EventOpening]
trigger=EventStart
buttons=1
event1=
add=TileFoyer
[TileFoyer]
side=TileSideFoyer
`)
    quest.start()
    quest.press(0)
    return quest
  }

  const owed = (quest: QuestSession): string[] => {
    const seen: string[] = []
    for (;;) {
      const next = quest.takeAnnouncement()
      if (next === null) return seen
      seen.push(next)
    }
  }

  it('announces the mythos, then the investigators it hands back to', () => {
    const quest = idle()
    expect(quest.nextPhase()).toBe(true)

    expect(owed(quest)).toEqual([MoMPhase.mythos, MoMPhase.investigator])
  })

  it('owes them once', () => {
    // Drained, not read: an announcement is shown and gone.
    const quest = idle()
    quest.nextPhase()
    owed(quest)

    expect(owed(quest)).toEqual([])
  })

  it('still owes the announcement when the mythos raises an event', () => {
    // The event and the announcement are not alternatives — the C# puts the
    // window over the dialog rather than instead of it. Kept apart from
    // `view()` for exactly this: a mythos with something to say used to
    // swallow its own announcement.
    const quest = session(`[EventOpening]
trigger=EventStart
buttons=1
event1=
add=TileFoyer
[TileFoyer]
side=TileSideFoyer
[EventOmen]
trigger=Mythos
buttons=1
event1=
`)
    quest.start()
    quest.press(0)
    quest.nextPhase()

    const view = quest.view()
    expect(view.kind).toBe('event')
    expect(view.kind === 'event' ? view.name : null).toBe('EventOmen')
    expect(owed(quest)).toContain(MoMPhase.mythos)
  })
})

/**
 * Cancelling: `DialogWindow.onCancel` and `Event.ButtonsPresent`.
 *
 * The C# marks doors, tokens and UI elements cancelable "because you can
 * select then cancel" — clicking a thing on the board is not a commitment. An
 * event the quest raised itself has to be answered, and offers no way out.
 */
describe('cancelling an event', () => {
  const TOKEN_QUEST = `[EventStart]
trigger=EventStart
buttons=1
event1=
text=The hall waits.
add=TokenDesk

[TokenDesk]
buttons=1
event1=EventSearched
text=A desk, its drawers shut.

[EventSearched]
buttons=1
event1=
text=You find a key.
operations=$found,=,1
`

  /** Opens the token's dialog, as clicking it on the board does. */
  function atToken(ini = TOKEN_QUEST): QuestSession {
    const built = session(ini)
    built.start()
    built.press(0)
    built.activate('TokenDesk')
    return built
  }

  it('offers a way out of a token, and not out of a plain event', () => {
    const built = session(TOKEN_QUEST)
    built.start()

    const opening = built.view()
    expect(opening.kind === 'event' && opening.cancelable).toBe(false)

    built.press(0)
    built.activate('TokenDesk')
    const token = built.view()
    expect(token.kind === 'event' && token.cancelable).toBe(true)
  })

  it('closes without running anything the event declares', () => {
    const built = atToken()

    expect(built.cancel()).toBe(true)
    expect(built.view().kind).toBe('board')
    // The chained event never ran, so nothing it sets was set.
    expect(built.runtime.vars.getValue('$found')).toBe(0)
    expect(built.events.history).not.toContain('EventSearched')
  })

  it('leaves the token on the board to be tried again', () => {
    // This is the whole point of cancelling rather than answering: the thing
    // is still there, and a player who opened it by accident has lost nothing.
    const built = atToken()
    built.cancel()

    expect(built.runtime.boardItems().some((item) => item.name === 'TokenDesk')).toBe(true)
    built.activate('TokenDesk')
    expect(built.view().kind).toBe('event')
  })

  it('refuses to cancel an event that has to be answered', () => {
    const built = session(TOKEN_QUEST)
    built.start()

    expect(built.cancel()).toBe(false)
    expect(built.view().kind).toBe('event')
  })

  it('refuses to cancel when nothing is showing', () => {
    const built = session(TOKEN_QUEST)

    expect(built.cancel()).toBe(false)
  })

  it('gives a token no Continue to press, because Cancel is the way out', () => {
    // `EventManager.Token` is built with `addsFallbackContinueButton = false`.
    // A Continue here would end the event and consume the token, which is not
    // what a player who cannot act on it means to do.
    const built = atToken(`[EventStart]
trigger=EventStart
buttons=1
event1=
add=TokenDesk

[TokenDesk]
buttons=1
event1=EventLocked
text=A desk.

[EventLocked]
vartests=VarOperation:$key,>,0
buttons=1
event1=
text=Unlocked.
`)

    const view = built.view()
    expect(view.kind === 'event' && view.buttons).toEqual([])
  })

  it('gives a token no Continue even when its one choice is greyed out', () => {
    // The case the Token rule really decides: the button leads somewhere real,
    // so `ButtonsPresent` says yes and the button is drawn — but its condition
    // fails, so nothing is pressable. A plain event would grow a Continue
    // here; a token must not, because Cancel is already the way out and a
    // Continue would end the event and consume the token instead.
    const built = atToken(`[EventStart]
trigger=EventStart
buttons=1
event1=
add=TokenDesk

[TokenDesk]
buttons=1
event1=EventOpen,$key,>,0
text=A locked desk.

[EventOpen]
buttons=1
event1=
text=It opens.
`)

    const view = built.view()
    expect(view.kind === 'event' && view.buttons.map((b) => b.disabled)).toEqual([true])
    expect(view.kind === 'event' && view.buttons.map((b) => b.label)).not.toContain('Continue')
  })

  it('still gives a plain event its Continue', () => {
    // The fallback exists so a player is never trapped; only a cancelable
    // event has another way out.
    const built = session(`[EventOnly]
trigger=EventStart
buttons=1
event1=EventDisabled
text=Nothing to do.

[EventDisabled]
vartests=VarOperation:$never,>,0
buttons=1
event1=
`)
    built.start()

    const view = built.view()
    expect(view.kind === 'event' && view.buttons.map((b) => b.label)).toHaveLength(1)
  })

  it('keeps the buttons of a token whose choice leads somewhere', () => {
    const view = atToken().view()

    expect(view.kind === 'event' && view.buttons).toHaveLength(1)
  })

  it('counts a handover to another scenario as somewhere to go', () => {
    // `ButtonsPresent` treats a name that is a quest file rather than an event
    // as valid, so a token whose only button starts the next scenario is not
    // mistaken for one that leads nowhere.
    const built = session(
      `[EventStart]
trigger=EventStart
buttons=1
event1=
add=TokenGate

[TokenGate]
buttons=1
event1=next/quest.ini
text=A gate.
`,
      () => 0,
      (name) => name === 'next/quest.ini',
    )
    built.start()
    built.press(0)
    built.activate('TokenGate')

    expect(built.view().kind === 'event' && built.view()).toMatchObject({ cancelable: true })
    const view = built.view()
    expect(view.kind === 'event' && view.buttons).toHaveLength(1)
  })

  it('says which event was missing when a token points at nothing', () => {
    const built = atToken(`[EventStart]
trigger=EventStart
buttons=1
event1=
add=TokenDesk

[TokenDesk]
buttons=1
event1=EventGone
text=A desk.
`)

    const view = built.view()
    expect(view.kind === 'event' && view.buttons).toEqual([])
    expect(built.runtime.log.toArray().map((e) => e.entry)).toContain(
      'Warning: Missing event called: EventGone',
    )
  })
})

/**
 * `{c:Name}` in a scenario's prose: `Event.ReplaceComponentText`.
 *
 * A scenario writes "Add the {c:TileTownsquare} tile" rather than naming the
 * tile outright, so the sentence survives the tile being swapped or the text
 * being translated. What a marker resolves to depends on what the component
 * is, and the C# switches on its type.
 */
describe('component names in text', () => {
  /** Stands in for `ContentData`, which this package cannot reach. */
  const content = (entries: Record<string, string>) => (_kind: string, name: string) =>
    entries[name] ?? null

  it('names the tile by its side, not by its section', () => {
    const built = localizedSession(
      `[EventStart]
trigger=EventStart
buttons=1
event1=

[TileTownsquare]
side=TileSideTownsquare
`,
      ['EventStart.text,"Add the {c:TileTownsquare} tile."'],
      content({ TileSideTownsquare: 'Town Square' }),
    )
    built.start()

    const view = built.view()
    expect(view.kind === 'event' && view.text).toBe('Add the Town Square tile.')
  })

  it('names the item a quest handed over', () => {
    const built = localizedSession(
      `[EventStart]
trigger=EventStart
buttons=1
event1=
add=QItemKey

[QItemKey]
traits=key
`,
      ['EventStart.text,"You find the {c:QItemKey}."'],
      content({ ItemSilverKey: 'Silver Key' }),
    )
    built.runtime.itemSelect.set('QItemKey', 'ItemSilverKey')
    built.start()

    const view = built.view()
    expect(view.kind === 'event' && view.text).toBe('You find the Silver Key.')
  })

  it('falls back to the section name when nothing has been chosen yet', () => {
    // `getComponentText` returns the section name for an item the quest has
    // not resolved — the marker still reads as something rather than nothing.
    const built = localizedSession(
      `[EventStart]
trigger=EventStart
buttons=1
event1=

[QItemKey]
traits=key
`,
      ['EventStart.text,"You find the {c:QItemKey}."'],
      content({}),
    )
    built.start()

    const view = built.view()
    expect(view.kind === 'event' && view.text).toBe('You find the QItemKey.')
  })

  it('leaves a marker alone when the scenario declares no such thing', () => {
    // `TryGetValue` fails and the C# moves on without replacing, so the
    // marker stays on screen. Ugly, and deliberately not improved on: a
    // scenario naming something it does not define is a fault in the
    // scenario, and hiding it would hide that.
    const built = localizedSession(
      `[EventStart]
trigger=EventStart
buttons=1
event1=
`,
      ['EventStart.text,"Add the {c:TileNowhere} tile."'],
      content({}),
    )
    built.start()

    const view = built.view()
    expect(view.kind === 'event' && view.text).toBe('Add the {c:TileNowhere} tile.')
  })

  it('replaces every marker in a line, not just the first', () => {
    const built = localizedSession(
      `[EventStart]
trigger=EventStart
buttons=1
event1=

[TileA]
side=TileSideA

[TileB]
side=TileSideB
`,
      ['EventStart.text,"Add {c:TileA} and {c:TileB}."'],
      content({ TileSideA: 'Town Square', TileSideB: 'Street' }),
    )
    built.start()

    const view = built.view()
    expect(view.kind === 'event' && view.text).toBe('Add Town Square and Street.')
  })

  it('does not let one marker swallow the next', () => {
    // The C#'s pattern is `{c:(((?!{).)*?)}` — the inner guard is what stops a
    // greedy match running from the first brace to the last.
    const built = localizedSession(
      `[EventStart]
trigger=EventStart
buttons=1
event1=

[TileA]
side=TileSideA

[TileB]
side=TileSideB
`,
      ['EventStart.text,"{c:TileA}{c:TileB}"'],
      content({ TileSideA: 'A', TileSideB: 'B' }),
    )
    built.start()

    const view = built.view()
    expect(view.kind === 'event' && view.text).toBe('AB')
  })

  it('names components on a button as well as in the prose', () => {
    // `DialogWindow.cs:394` runs the same replacement over a label.
    const built = localizedSession(
      `[EventStart]
trigger=EventStart
buttons=1
event1=

[TileA]
side=TileSideA
`,
      ['EventStart.text,"Choose."', 'EventStart.button1,"Enter the {c:TileA}"'],
      content({ TileSideA: 'Town Square' }),
    )
    built.start()

    const view = built.view()
    expect(view.kind === 'event' && view.buttons[0]?.label).toBe('Enter the Town Square')
  })

  it('leaves text with no marker in it untouched', () => {
    const built = localizedSession(
      `[EventStart]
trigger=EventStart
buttons=1
event1=
`,
      ['EventStart.text,"Nothing to replace here."'],
      content({}),
    )
    built.start()

    const view = built.view()
    expect(view.kind === 'event' && view.text).toBe('Nothing to replace here.')
  })
})
