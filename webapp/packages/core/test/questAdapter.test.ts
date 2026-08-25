/**
 * Tests for the parsed-quest-to-engine adapter (T-018).
 *
 * An adapter is where a field quietly goes missing, so each conversion is
 * asserted rather than assumed — including the two that look like bugs and are
 * not: components that inherit from `Event` belong in the event map, and a
 * button's own operations do not travel, because nothing in the C# performs
 * them.
 */

import { describe, expect, it } from 'vitest'

import { readFromString } from '../src/ini/IniRead.js'
import { loadQuestSections } from '../src/quest/Quest.js'
import {
  bundleQuest,
  questActivations,
  questComponentData,
  questEvents,
  questMonsterTypes,
} from '../src/quest/questAdapter.js'

/** Parses ini text the way a quest package is loaded. */
function load(ini: string) {
  return loadQuestSections(readFromString(ini), 'test.ini', {})
}

describe('questEvents', () => {
  it('carries the trigger, buttons and board changes', () => {
    const events = questEvents(
      load(`[EventIntro]
trigger=EventStart
add=TileFoyer TokenFrontDoor
remove=TokenEntry
buttons=1
event1=EventHallway
`),
    )
    const intro = events.get('EventIntro')

    expect(intro?.trigger).toBe('EventStart')
    expect(intro?.addComponents).toEqual(['TileFoyer', 'TokenFrontDoor'])
    expect(intro?.removeComponents).toEqual(['TokenEntry'])
    expect(intro?.buttons[0]?.eventNames).toEqual(['EventHallway'])
  })

  it('includes the component types that inherit from Event', () => {
    // Token, UI, Spawn and Puzzle all extend Event in the C# (QuestData.cs:385,
    // 470, 680, 1294), and all of them can fire. A map of only [Event] sections
    // would silently drop every clickable token in a scenario.
    const events = questEvents(
      load(`[EventOne]
[TokenDoor]
[SpawnZombie]
[UIFrame]
[PuzzleBox]
[QItemAxe]
`),
    )

    expect([...events.keys()].sort()).toEqual([
      'EventOne',
      'PuzzleBox',
      'SpawnZombie',
      'TokenDoor',
      'UIFrame',
    ])
    // QItem extends QuestComponent, not Event.
    expect(events.has('QItemAxe')).toBe(false)
  })

  it('does not carry a button’s own operations', () => {
    // QuestButtonData holds them and the editor writes them, but the only
    // vars.Perform for an event is on the event itself (EventManager.cs:219).
    // Carrying them would make the port do something the game does not.
    const events = questEvents(
      load(`[EventChoice]
buttons=1
event1=EventNext
button1Operations=$flag,=,1
`),
    )

    // The event itself declared none, so it carries none.
    expect(events.get('EventChoice')?.operations ?? []).toHaveLength(0)
  })

  it('carries the event’s own operations and audio', () => {
    const events = questEvents(
      load(`[EventDoom]
audio=doom
operations=$doom,+,1
`),
    )

    expect(events.get('EventDoom')?.audio).toBe('doom')
    expect(events.get('EventDoom')?.operations).toHaveLength(1)
  })

  it('leaves audio unset rather than empty when there is none', () => {
    expect(questEvents(load('[EventQuiet]\n')).get('EventQuiet')?.audio).toBeUndefined()
  })
})

describe('questComponentData', () => {
  it('carries a location only when the component has one', () => {
    // Tiles, tokens and doors always set locationSpecified in their
    // constructors — they are placed by definition, defaulting to (0,0). An
    // event is the case that genuinely has no place on the board.
    const data = questComponentData(
      load(`[TileFoyer]
side=TileSideFoyer
xposition=3
yposition=-2
[TokenUnplaced]
[EventPlain]
`),
    )

    expect(data.get('TileFoyer')?.location).toEqual({ x: 3, y: -2 })
    expect(data.get('TokenUnplaced')?.location).toEqual({ x: 0, y: 0 })
    expect(data.get('EventPlain')?.location).toBeUndefined()
  })

  it('carries rotation for the things that have one', () => {
    const data = questComponentData(
      load(`[TileHall]
side=TileSideHall
rotation=90
[EventPlain]
`),
    )

    expect(data.get('TileHall')?.rotation).toBe(90)
    expect(data.get('EventPlain')?.rotation).toBeUndefined()
  })

  it('carries an item’s inspect event, and omits it when absent', () => {
    const data = questComponentData(
      load(`[QItemDiary]
inspect=EventReadDiary
[QItemAxe]
`),
    )

    expect(data.get('QItemDiary')?.inspect).toBe('EventReadDiary')
    expect(data.get('QItemAxe')?.inspect).toBeUndefined()
  })
})

describe('questActivations', () => {
  it('keys activations without the section prefix, as the monster names them', () => {
    // A monster's `activation=Shoggoth1` refers to `[ActivationShoggoth1]`.
    const activations = questActivations(load('[ActivationShoggoth1]\nmaster=It lashes out.\n'))

    expect([...activations.keys()]).toEqual(['Shoggoth1'])
    expect(activations.get('Shoggoth1')?.masterActions.fullKey).toContain('master')
  })

  it('carries the ordering flags and the tests', () => {
    const activations = questActivations(
      load(`[ActivationOne]
minionfirst=true
vartests=VarOperation:$flag,>,0
`),
    )

    expect(activations.get('One')?.minionFirst).toBe(true)
    expect(activations.get('One')?.tests).not.toBeNull()
  })
})

describe('questMonsterTypes', () => {
  it('uses the type’s own activations when it names any', () => {
    const types = questMonsterTypes(
      load(`[CustomMonsterShoggoth]
base=MonsterShoggoth
activation=Shoggoth1 Shoggoth2
`),
    )
    const shoggoth = types.get('CustomMonsterShoggoth')

    expect(shoggoth?.activations).toEqual(['Shoggoth1', 'Shoggoth2'])
    expect(shoggoth?.useMonsterTypeActivations).toBe(false)
    expect(shoggoth?.derivedType).toBe('MonsterShoggoth')
  })

  it('falls back to the base type when it names none', () => {
    const types = questMonsterTypes(load('[CustomMonsterEdith]\nbase=MonsterMaster\n'))

    expect(types.get('CustomMonsterEdith')?.useMonsterTypeActivations).toBe(true)
  })
})

describe('bundleQuest', () => {
  it('builds every map in one pass', () => {
    const bundle = bundleQuest(
      load(`[EventOne]
[TileFoyer]
side=TileSideFoyer
[ActivationOne]
[CustomMonsterEdith]
base=MonsterMaster
`),
    )

    expect(bundle.events.size).toBe(1)
    expect(bundle.components.size).toBe(4)
    expect(bundle.activations.size).toBe(1)
    expect(bundle.monsterTypes.size).toBe(1)
  })
})
