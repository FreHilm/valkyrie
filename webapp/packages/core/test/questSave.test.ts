/**
 * Saving and restoring a quest in progress (T-026).
 *
 * `Quest.ToString` and the `Quest(saveData)` constructor. Nothing in the port
 * could write a save at all before this — `save.ts` could read the C#'s format
 * and there was no serialiser on the other side, so a game in progress was
 * lost the moment the tab closed.
 *
 * What these assert is the round trip: state out, state back, same game. A
 * field that serialises but does not restore is worse than one that does
 * neither, because it looks like it worked.
 */

import { describe, expect, it } from 'vitest'

import { readFromString } from '../src/ini/IniRead.js'
import { loadQuestSections } from '../src/quest/Quest.js'
import { bundleQuest } from '../src/quest/questAdapter.js'
import { QuestSession } from '../src/quest/QuestSession.js'
import { LogEntry } from '../src/quest/QuestLog.js'
import { MoMPhase } from '../src/quest/RoundController.js'
import { PuzzleTower } from '../src/quest/puzzles.js'

const QUEST = `[EventOpening]
trigger=EventStart
buttons=1
event1=EventNext
add=TileFoyer TokenDoor
[EventNext]
buttons=1
event1=
[TileFoyer]
side=TileSideFoyer
[TokenDoor]
buttons=1
event1=
[QItemKey]
itemname=ItemUniqueBrassKey
`

function session(ini = QUEST): QuestSession {
  const components = loadQuestSections(readFromString(ini), 'test.ini', {})
  const built = new QuestSession({
    bundle: bundleQuest(components),
    components,
    random: () => 0,
  })
  built.runtime.heroes.push({ heroName: 'HeroAgathaCrane', activated: false })
  built.runtime.heroes.push({ heroName: 'HeroCarsonSinclair', activated: true })
  return built
}

const OPTIONS = {
  questPath: '/quests/probe/quest.ini',
  originalPath: '/quests/probe.valkyrie',
  questName: 'Probe',
  valkyrieVersion: '2.6.0',
  packs: ['MoMBase'],
  duration: 12,
  time: '2026-08-28 20:00:00',
}

/** Saves one session and restores it into another, as a load does. */
function roundTrip(from: QuestSession, ini = QUEST): QuestSession {
  const text = from.toSaveString(OPTIONS)
  const into = session(ini)
  into.restoreFrom(readFromString(text))
  return into
}

describe('QuestSession save round trip', () => {
  it('carries the board across, in the order it was built', () => {
    // `ordered_boardItems`, and ordered for a reason: what covers what on the
    // board is the order things were added in.
    const quest = session()
    quest.start()
    quest.press(0)

    const names = quest.runtime.boardItems().map((i) => i.name)
    expect(names.length).toBeGreaterThan(0)
    expect(roundTrip(quest).runtime.boardItems().map((i) => i.name)).toEqual(names)
  })

  it('carries the variables across', () => {
    const quest = session()
    quest.start()
    quest.runtime.vars.setValue('$clues', 3)
    quest.runtime.vars.setValue('#round', 4)

    const back = roundTrip(quest)
    expect(back.runtime.vars.getValue('$clues')).toBe(3)
    // '#' starts a comment in an ini file, so those names are written escaped.
    expect(back.runtime.vars.getValue('#round')).toBe(4)
  })

  it('carries the party across, and who has acted', () => {
    const quest = session()
    quest.start()

    const back = roundTrip(quest)
    expect(back.runtime.heroes).toEqual([
      { heroName: 'HeroAgathaCrane', activated: false },
      { heroName: 'HeroCarsonSinclair', activated: true },
    ])
  })

  it('carries the monsters across, with their wounds', () => {
    const quest = session()
    quest.start()
    quest.runtime.monsters.push({
      monsterName: 'MonsterCultist',
      spawnedBy: 'SpawnCultist',
      unique: true,
      health: 2,
      damage: 3,
      activated: true,
      minionStarted: true,
      masterStarted: false,
      currentActivation: null,
    })

    expect(roundTrip(quest).runtime.monsters).toEqual([
      {
        monsterName: 'MonsterCultist',
        spawnedBy: 'SpawnCultist',
        unique: true,
        health: 2,
        damage: 3,
        activated: true,
        minionStarted: true,
        masterStarted: false,
        currentActivation: null,
      },
    ])
  })

  it('carries the log, the items and what they lead to', () => {
    const quest = session()
    quest.start()
    quest.runtime.log.add(new LogEntry('You enter the hall.'))
    quest.runtime.itemSelect.set('QItemKey', 'ItemUniqueBrassKey')
    quest.runtime.giveItem('ItemUniqueBrassKey', 'EventInspectKey')

    const back = roundTrip(quest)
    expect(back.runtime.log.toArray().map((e) => e.entry)).toContain('You enter the hall.')
    expect(back.runtime.items()).toContain('ItemUniqueBrassKey')
    expect(back.runtime.itemSelect.get('QItemKey')).toBe('ItemUniqueBrassKey')
    expect(back.runtime.itemInspect.get('ItemUniqueBrassKey')).toBe('EventInspectKey')
  })

  it('carries the events answered and the quota accumulated', () => {
    const quest = session()
    quest.start()
    quest.press(0)
    quest.runtime.eventQuota.set('EventSearch', 2)

    const back = roundTrip(quest)
    expect(back.events.history).toEqual(quest.events.history)
    expect(back.runtime.eventQuota.get('EventSearch')).toBe(2)
  })

  it('puts the player back on the event they were looking at', () => {
    const quest = session()
    quest.start()

    expect(quest.view().kind).toBe('event')
    const back = roundTrip(quest)
    const view = back.view()
    expect(view.kind).toBe('event')
    expect(view.kind === 'event' ? view.name : null).toBe('EventOpening')
  })

  it('carries the phase across', () => {
    const quest = session()
    quest.start()
    quest.rounds.phase = MoMPhase.horror

    expect(roundTrip(quest).rounds.phase).toBe(MoMPhase.horror)
  })

  it('carries a puzzle in progress, moves and all', () => {
    const quest = session()
    quest.start()
    const tower = PuzzleTower.generate(3, (min, max) => min + ((max - min) >> 1))
    const before = JSON.stringify(tower.puzzle)
    ;(quest as never as { puzzles: Map<string, unknown> }).puzzles.set('PuzzleDoor', tower)

    const text = quest.toSaveString(OPTIONS)
    expect(text).toContain('[PuzzleTowerPuzzleDoor]')

    const back = roundTrip(quest)
    const restored = (back as never as { puzzles: Map<string, PuzzleTower> }).puzzles.get(
      'PuzzleDoor',
    )
    expect(restored).toBeDefined()
    expect(JSON.stringify(restored?.puzzle)).toBe(before)
  })

  it('leaves the log out for the undo stack', () => {
    // `ToString(false)`: an undo restores the board, not what has been read.
    const quest = session()
    quest.start()
    quest.runtime.log.add(new LogEntry('You enter the hall.'))

    expect(quest.toSaveString({ ...OPTIONS, includeLog: false })).not.toContain(
      'You enter the hall.',
    )
    expect(quest.toSaveString(OPTIONS)).toContain('You enter the hall.')
  })

  it('records what a load needs to find the quest again', () => {
    const text = session().toSaveString(OPTIONS)

    expect(text).toContain('path=/quests/probe/quest.ini')
    expect(text).toContain('originalpath=/quests/probe.valkyrie')
    expect(text).toContain('questname=Probe')
    expect(text).toContain('valkyrie=2.6.0')
    expect(text).toContain('duration=12')
    expect(text).toContain('[Packs]\nMoMBase')
  })

  it('drops a board item the scenario no longer has', () => {
    // A save outliving an edit. Resurrecting a component that is gone would
    // put an item on the board with nothing behind it.
    const quest = session()
    quest.start()
    quest.press(0)

    const back = roundTrip(quest, `[EventOpening]\ntrigger=EventStart\nbuttons=1\nevent1=\n`)
    expect(back.runtime.boardItems()).toEqual([])
  })
})
