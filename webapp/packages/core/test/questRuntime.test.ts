/**
 * Tests for the runtime quest state (T-018).
 *
 * The state half of `Quest.cs`. It cannot be differential-tested — the C#
 * reaches for `Game.Get()` throughout and cannot compile outside Unity — so
 * these are read from the source and assert the behaviours that scenarios
 * actually depend on.
 */

import { describe, expect, it, vi } from 'vitest'

import { QuestRuntime } from '../src/quest/QuestRuntime.js'
import type { QuestComponentData } from '../src/quest/QuestRuntime.js'
import { EventManager } from '../src/quest/EventManager.js'
import type { AudioRequest, EventDefinition } from '../src/quest/EventManager.js'
import { VarOperation } from '../src/quest/VarTests.js'

const component = (
  sectionName: string,
  type: string,
  extra: Partial<QuestComponentData> = {},
): QuestComponentData => ({ sectionName, type, ...extra })

const components = (...list: QuestComponentData[]): Map<string, QuestComponentData> =>
  new Map(list.map((c) => [c.sectionName, c]))

describe('the # names that clear a whole class at once', () => {
  const populated = (): QuestRuntime => {
    const runtime = new QuestRuntime({
      components: components(
        component('TileHall', 'Tile'),
        component('TokenDoor', 'Token'),
        component('DoorMain', 'Door'),
        component('UIJournal', 'UI'),
        component('UIContinue', 'UI'),
      ),
    })
    runtime.add(['TileHall', 'TokenDoor', 'DoorMain', 'UIJournal', 'UIContinue'])
    return runtime
  }

  it('clears the whole board for #boardcomponents', () => {
    // A scenario ends its opening cutscene with this; without it the cutscene
    // stays on screen and the quest never reaches its board.
    const runtime = populated()

    runtime.remove(['#boardcomponents'])

    expect(runtime.boardItems()).toEqual([])
  })

  it('clears only that kind for #uicomponents, #doors, #tiles and #tokens', () => {
    const cases: [string, string[]][] = [
      ['#uicomponents', ['TileHall', 'TokenDoor', 'DoorMain']],
      ['#doors', ['TileHall', 'TokenDoor', 'UIJournal', 'UIContinue']],
      ['#tiles', ['TokenDoor', 'DoorMain', 'UIJournal', 'UIContinue']],
      ['#tokens', ['TileHall', 'DoorMain', 'UIJournal', 'UIContinue']],
    ]

    for (const [name, left] of cases) {
      const runtime = populated()
      runtime.remove([name])
      expect(
        runtime.boardItems().map((i) => i.name),
        name,
      ).toEqual(left)
    }
  })

  it('clears every monster for #monsters, and says so', () => {
    const runtime = new QuestRuntime({ components: components() })
    runtime.spawnMonster('MonsterZombie', 'SpawnA')
    runtime.spawnMonster('MonsterManiac', 'SpawnB')

    runtime.remove(['#monsters'])

    expect(runtime.monsters).toEqual([])
    // Scenarios test this variable, so it has to keep step.
    expect(runtime.vars.getValue('#monsters')).toBe(0)
  })

  it('gives back every quest item for #qitems', () => {
    const runtime = new QuestRuntime({
      components: components(component('QItemAxe', 'QItem'), component('QItemKey', 'QItem')),
    })
    runtime.itemSelect.set('QItemAxe', 'Axe')
    runtime.itemSelect.set('QItemKey', 'Key')
    runtime.add(['QItemAxe', 'QItemKey'])

    runtime.remove(['#qitems'])

    expect([...runtime.heldItems]).toEqual([])
  })

  it('does not treat a # name as a component to look up', () => {
    // The C# tests each special name in turn and does nothing when none match,
    // so an unrecognised one must not fall through and remove a real component.
    const runtime = populated()

    runtime.remove(['#somethingelse'])

    expect(runtime.boardItems()).toHaveLength(5)
  })
})

describe('board contents', () => {
  it('adds tiles, tokens, doors and UI to the board', () => {
    const runtime = new QuestRuntime({
      components: components(
        component('TileHall', 'Tile'),
        component('TokenDoor', 'Token'),
        component('DoorMain', 'Door'),
        component('UIText', 'UI'),
      ),
    })
    runtime.add(['TileHall', 'TokenDoor', 'DoorMain', 'UIText'])

    expect(runtime.boardItems().map((i) => i.name)).toEqual([
      'TileHall',
      'TokenDoor',
      'DoorMain',
      'UIText',
    ])
  })

  // Tiles must render in the order they were added, which is why the C# keeps
  // a separate ordered list alongside its map.
  it('keeps insertion order', () => {
    const runtime = new QuestRuntime({
      components: components(
        component('C', 'Tile'),
        component('A', 'Tile'),
        component('B', 'Tile'),
      ),
    })
    runtime.add(['C', 'A', 'B'])

    expect(runtime.boardItems().map((i) => i.name)).toEqual(['C', 'A', 'B'])
  })

  // Events fire more than once; adding twice must not duplicate.
  it('ignores a component already on the board', () => {
    const runtime = new QuestRuntime({ components: components(component('Tile1', 'Tile')) })
    runtime.add(['Tile1'])
    runtime.add(['Tile1'])

    expect(runtime.boardItems()).toHaveLength(1)
  })

  it('removes a component, and tolerates removing an absent one', () => {
    const runtime = new QuestRuntime({ components: components(component('Tile1', 'Tile')) })
    runtime.add(['Tile1'])
    runtime.remove(['Tile1'])
    runtime.remove(['Tile1'])

    expect(runtime.boardItems()).toEqual([])
  })

  /**
   * DEVIATION: the C# calls `Application.Quit()` for a missing component — it
   * closes the app from inside the board logic. A dangling reference in a
   * community scenario should not do that.
   */
  it('warns about a missing component instead of quitting', () => {
    const onWarning = vi.fn()
    const runtime = new QuestRuntime({ components: components(), onWarning })
    runtime.add(['NoSuchThing'])

    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining('NoSuchThing'))
    expect(runtime.boardItems()).toEqual([])
  })

  it('records that warning where an author sees it, not a player', () => {
    const runtime = new QuestRuntime({ components: components() })
    runtime.add(['Missing'])

    expect(runtime.log.toArray()[0]?.kind).toBe('editor')
  })
})

describe('items', () => {
  it('gives the party an item once its slot has resolved', () => {
    const runtime = new QuestRuntime({
      components: components(component('QItemAxe', 'QItem')),
    })
    runtime.itemSelect.set('QItemAxe', 'Axe')
    runtime.add(['QItemAxe'])

    expect(runtime.items()).toEqual(['Axe'])
  })

  it('does nothing for an unresolved slot', () => {
    const runtime = new QuestRuntime({
      components: components(component('QItemAxe', 'QItem')),
    })
    runtime.add(['QItemAxe'])

    expect(runtime.items()).toEqual([])
  })

  it('records the inspect event for an item that has one', () => {
    const runtime = new QuestRuntime({
      components: components(component('QItemBox', 'QItem', { inspect: 'EventOpenBox' })),
    })
    runtime.itemSelect.set('QItemBox', 'Box')
    runtime.add(['QItemBox'])

    expect(runtime.itemInspect.get('Box')).toBe('EventOpenBox')
  })

  // A shop offers items rather than granting them.
  it('does not grant an item when adding as a shop', () => {
    const runtime = new QuestRuntime({
      components: components(component('QItemAxe', 'QItem')),
    })
    runtime.itemSelect.set('QItemAxe', 'Axe')
    runtime.add(['QItemAxe'], true)

    expect(runtime.items()).toEqual([])
  })

  it('takes the item back when the component is removed', () => {
    const runtime = new QuestRuntime({
      components: components(component('QItemAxe', 'QItem', { inspect: 'E' })),
    })
    runtime.itemSelect.set('QItemAxe', 'Axe')
    runtime.add(['QItemAxe'])
    runtime.remove(['QItemAxe'])

    expect(runtime.items()).toEqual([])
    expect(runtime.itemInspect.has('Axe')).toBe(false)
  })
})

describe('monsters', () => {
  it('spawns a monster and keeps #monsters in step', () => {
    const runtime = new QuestRuntime({ components: components() })
    runtime.spawnMonster('Zombie', 'SpawnHall')

    expect(runtime.monsters).toHaveLength(1)
    expect(runtime.vars.getValue('#monsters')).toBe(1)
  })

  // Descent groups identical monsters; Mansions keeps them separate.
  it('groups identical monsters when the game type groups them', () => {
    const runtime = new QuestRuntime({ components: components(), monstersGrouped: true })
    runtime.spawnMonster('Zombie', 'A')
    runtime.spawnMonster('Zombie', 'B')

    expect(runtime.monsters).toHaveLength(1)
  })

  it('keeps them separate when the game type does not group', () => {
    const runtime = new QuestRuntime({ components: components(), monstersGrouped: false })
    runtime.spawnMonster('Zombie', 'A')
    runtime.spawnMonster('Zombie', 'B')

    expect(runtime.monsters).toHaveLength(2)
  })

  it('promotes rather than duplicates when a unique spawn repeats a type', () => {
    // This test previously asserted two monsters, which was wrong.
    // EventManager.cs:252 adds only when `!MonstersGrouped() || oldMonster ==
    // null`; with grouping on and a match present it takes the `else if
    // (unique)` branch and upgrades the group in place. Adding a second one
    // would put twice the monsters in front of the players.
    const runtime = new QuestRuntime({ components: components(), monstersGrouped: true })
    runtime.spawnMonster('Shoggoth', 'A', true)
    runtime.spawnMonster('Shoggoth', 'B', true)

    expect(runtime.monsters).toHaveLength(1)
    expect(runtime.monsters[0]?.unique).toBe(true)
  })

  it('updates #monsters when one is removed', () => {
    const runtime = new QuestRuntime({ components: components() })
    const monster = runtime.spawnMonster('Zombie', 'A')
    runtime.removeMonster(monster!)

    expect(runtime.vars.getValue('#monsters')).toBe(0)
  })

  it('makes every monster eligible again at the start of a round', () => {
    const runtime = new QuestRuntime({ components: components() })
    const monster = runtime.spawnMonster('Zombie', 'A')
    monster!.activated = true
    runtime.resetActivations()

    expect(monster!.activated).toBe(false)
  })
})

describe('events driving the runtime', () => {
  const event = (
    overrides: Partial<EventDefinition> & { sectionName: string },
  ): EventDefinition => ({
    trigger: '',
    tests: null,
    buttons: [],
    randomEvents: false,
    ...overrides,
  })

  function wire(events: EventDefinition[], runtime: QuestRuntime) {
    const played: string[] = []
    const music: readonly string[][] = []
    const requests: AudioRequest[] = []
    return {
      played,
      music,
      requests,
      manager: new EventManager({
        vars: runtime.vars,
        log: runtime.log,
        events: new Map(events.map((e) => [e.sectionName, e])),
        runtime,
        // The request says which kind of sound it is; an event's `audio`
        // names one, rather than naming a category to pick from.
        playAudio: (request) => {
          requests.push(request)
          if (request.kind === 'effect') played.push(request.name)
        },
      }),
    }
  }

  it('puts components on the board when the event runs', () => {
    const runtime = new QuestRuntime({
      components: components(component('TileHall', 'Tile')),
    })
    const { manager } = wire(
      [event({ sectionName: 'Start', addComponents: ['TileHall'] })],
      runtime,
    )
    manager.queue('Start')

    expect(runtime.has('TileHall')).toBe(true)
  })

  it('takes them off again', () => {
    const runtime = new QuestRuntime({
      components: components(component('TileHall', 'Tile')),
    })
    runtime.add(['TileHall'])
    const { manager } = wire(
      [event({ sectionName: 'Clear', removeComponents: ['TileHall'] })],
      runtime,
    )
    manager.queue('Clear')

    expect(runtime.has('TileHall')).toBe(false)
  })

  it('applies the event operations', () => {
    const runtime = new QuestRuntime({ components: components() })
    const { manager } = wire(
      [event({ sectionName: 'Set', operations: [new VarOperation('$found,=,1')] })],
      runtime,
    )
    manager.queue('Set')

    expect(runtime.vars.getValue('$found')).toBe(1)
  })

  /**
   * The order is the C#'s and matters: an operation can gate a component the
   * same event adds, so running `add` first would place something the
   * operation was meant to prevent.
   */
  it('applies operations before adding components', () => {
    const order: string[] = []
    const runtime = new QuestRuntime({
      components: components(component('Tile1', 'Tile')),
      onWarning: () => {},
    })
    const original = runtime.add.bind(runtime)
    runtime.add = (names, shop) => {
      order.push('add')
      original(names, shop)
    }
    const vars = runtime.vars
    const originalPerform = vars.performAll.bind(vars)
    vars.performAll = (ops) => {
      order.push('operations')
      originalPerform(ops)
    }

    const { manager } = wire(
      [
        event({
          sectionName: 'Both',
          operations: [new VarOperation('$x,=,1')],
          addComponents: ['Tile1'],
        }),
      ],
      runtime,
    )
    manager.queue('Both')

    expect(order).toEqual(['operations', 'add'])
  })

  it('plays the event audio', () => {
    const runtime = new QuestRuntime({ components: components() })
    const { manager, played } = wire([event({ sectionName: 'Bang', audio: 'DoorSlam' })], runtime)
    manager.queue('Bang')

    expect(played).toEqual(['DoorSlam'])
  })

  it('sets the music an event names', () => {
    const runtime = new QuestRuntime({ components: components() })
    const { manager, requests } = wire(
      [event({ sectionName: 'Creep', music: ['AudioAtmosphere1', 'AudioAtmosphere2'] })],
      runtime,
    )
    manager.queue('Creep')

    expect(requests).toContainEqual({
      kind: 'music',
      names: ['AudioAtmosphere1', 'AudioAtmosphere2'],
    })
  })

  it('leaves the playlist alone for an event that names no music', () => {
    // `EventManager.cs:196` only touches it when the list is non-empty, which
    // is what carries a track across the events between two that set one.
    const runtime = new QuestRuntime({ components: components() })
    const { manager, requests } = wire([event({ sectionName: 'Talk', music: [] })], runtime)
    manager.queue('Talk')

    expect(requests.filter((r) => r.kind === 'music')).toEqual([])
  })

  it('does nothing to the board for an event with no effects', () => {
    const runtime = new QuestRuntime({ components: components() })
    const { manager } = wire([event({ sectionName: 'Talk' })], runtime)
    manager.queue('Talk')

    expect(runtime.boardItems()).toEqual([])
  })
})

describe('spawning into a grouped game (Descent)', () => {
  const grouped = (): QuestRuntime =>
    new QuestRuntime({ components: new Map(), monstersGrouped: true })

  it('joins an existing group rather than adding a second', () => {
    const runtime = grouped()
    runtime.spawnMonster('MonsterZombie', 'SpawnA')
    runtime.spawnMonster('MonsterZombie', 'SpawnB')

    expect(runtime.monsters).toHaveLength(1)
  })

  it('promotes the existing group when the spawn is unique', () => {
    // The C# upgrades oldMonster in place (EventManager.cs:263). Adding a
    // second group instead would put twice the monsters on the board.
    const runtime = grouped()
    runtime.spawnMonster('MonsterZombie', 'SpawnA')
    const promoted = runtime.spawnMonster('MonsterZombie', 'SpawnB', true, 3)

    expect(runtime.monsters).toHaveLength(1)
    expect(promoted?.unique).toBe(true)
    expect(promoted?.health).toBe(3)
  })

  it('carries the health modifier onto a first unique spawn', () => {
    const runtime = grouped()
    const monster = runtime.spawnMonster('MonsterZombie', 'SpawnA', true, 5)

    expect(monster?.unique).toBe(true)
    expect(monster?.health).toBe(5)
  })

  it('keeps Mansions monsters separate, unique or not', () => {
    const runtime = new QuestRuntime({ components: new Map(), monstersGrouped: false })
    runtime.spawnMonster('MonsterZombie', 'SpawnA')
    runtime.spawnMonster('MonsterZombie', 'SpawnB', true, 2)

    expect(runtime.monsters).toHaveLength(2)
  })
})
