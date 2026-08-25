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
import type { EventDefinition } from '../src/quest/EventManager.js'
import { VarOperation } from '../src/quest/VarTests.js'

const component = (
  sectionName: string,
  type: string,
  extra: Partial<QuestComponentData> = {},
): QuestComponentData => ({ sectionName, type, ...extra })

const components = (...list: QuestComponentData[]): Map<string, QuestComponentData> =>
  new Map(list.map((c) => [c.sectionName, c]))

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

  it('never groups a unique monster', () => {
    const runtime = new QuestRuntime({ components: components(), monstersGrouped: true })
    runtime.spawnMonster('Shoggoth', 'A', true)
    runtime.spawnMonster('Shoggoth', 'B', true)

    expect(runtime.monsters).toHaveLength(2)
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
    return {
      played,
      manager: new EventManager({
        vars: runtime.vars,
        log: runtime.log,
        events: new Map(events.map((e) => [e.sectionName, e])),
        runtime,
        playAudio: (name) => played.push(name),
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

  it('does nothing to the board for an event with no effects', () => {
    const runtime = new QuestRuntime({ components: components() })
    const { manager } = wire([event({ sectionName: 'Talk' })], runtime)
    manager.queue('Talk')

    expect(runtime.boardItems()).toEqual([])
  })
})
