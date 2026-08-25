/**
 * Tests for the board scene builder (T-018).
 *
 * The runtime knows what is on the board, content knows what it looks like,
 * and geometry knows where it goes. This is the join, and what is asserted is
 * the part that would otherwise fail silently: an item with no art still being
 * placed and clickable, and the ordering that decides what covers what.
 */

import { describe, expect, it } from 'vitest'

import { Layer } from '../src/board.js'
import { buildScene, sceneBounds } from '../src/boardScene.js'
import type { SceneSources } from '../src/boardScene.js'

const TILE = {
  image: 'img/foyer',
  pixelsPerSquare: 100,
  aspect: 0,
  top: 0,
  left: 0,
  imageWidth: 300,
  imageHeight: 200,
}

const TOKEN = {
  image: 'img/sheet',
  crop: { x: 0, y: 0, width: 64, height: 64 },
  width: 1,
  height: 1,
}

function sources(over: Partial<SceneSources> = {}): SceneSources {
  return {
    tile: () => TILE,
    token: () => TOKEN,
    monster: () => TOKEN,
    onGrid: false,
    ...over,
  }
}

const item = (name: string, type: string, location = { x: 0, y: 0 }, rotation?: number) => ({
  name,
  component: { sectionName: name, type, location, ...(rotation === undefined ? {} : { rotation }) },
})

describe('buildScene', () => {
  it('places a tile on the tile layer with its art to load', () => {
    const scene = buildScene([item('TileFoyer', 'Tile')], [], sources())

    expect(scene).toHaveLength(1)
    expect(scene[0]?.layer).toBe(Layer.TILE)
    expect(scene[0]?.source).toEqual({ path: 'img/foyer' })
    // Art arrives later; the item exists and hit-tests before then.
    expect(scene[0]?.image).toBeNull()
  })

  it('carries a token’s crop, so sheet-shared art is not all the same picture', () => {
    const scene = buildScene([item('TokenDoor', 'Token')], [], sources())

    expect(scene[0]?.source).toEqual({
      path: 'img/sheet',
      crop: { x: 0, y: 0, width: 64, height: 64 },
    })
  })

  it('keeps the runtime’s order, which decides what covers what', () => {
    const scene = buildScene(
      [item('TileA', 'Tile'), item('TokenB', 'Token'), item('TileC', 'Tile')],
      [],
      sources(),
    )

    expect(scene.map((s) => s.id)).toEqual(['TileA', 'TokenB', 'TileC'])
  })

  it('draws a token with no art as a marker rather than dropping it', () => {
    // It is still a thing the player can click; dropping it would make the
    // quest unplayable when one piece of art is missing.
    const scene = buildScene([item('TokenDoor', 'Token')], [], sources({ token: () => null }))

    expect(scene).toHaveLength(1)
    expect(scene[0]?.source).toBeNull()
    expect(scene[0]?.tint).toBeDefined()
  })

  it('skips a tile with no art, because there is nothing to place it by', () => {
    // A tile's geometry comes from its image size and its side's offsets, so
    // without art there is no position to give it.
    const scene = buildScene([item('TileFoyer', 'Tile')], [], sources({ tile: () => null }))

    expect(scene).toHaveLength(0)
  })

  it('reports a tile it cannot place rather than putting it at NaN', () => {
    // Geometry divides by pixels-per-square, so a side declaring `pps=0` — or
    // a game type with no scale configured — sends the tile to NaN, where it
    // silently disappears from the board.
    const warnings: string[] = []
    const scene = buildScene(
      [item('TileFoyer', 'Tile')],
      [],
      sources({
        tile: () => ({ ...TILE, pixelsPerSquare: 0 }),
        onWarning: (message) => warnings.push(message),
      }),
    )

    expect(scene).toHaveLength(0)
    expect(warnings[0]).toContain('TileFoyer')
  })

  it('puts doors and tokens on the same layer, as the C# does', () => {
    const scene = buildScene([item('TokenA', 'Token'), item('DoorB', 'Door')], [], sources())

    expect(scene.map((s) => s.layer)).toEqual([Layer.TOKEN, Layer.TOKEN])
  })

  it('leaves UI elements off the board, because they are screen-space', () => {
    // Quest.cs:2000 parents them to a canvas sized to the screen, not to the
    // board. On the grid they became 1x1 squares at whatever pixel their
    // screen fraction resolved to.
    const scene = buildScene([item('UIContinue', 'UI')], [], sources())

    expect(scene).toHaveLength(0)
  })

  it('ignores components that are not on the board', () => {
    const scene = buildScene([item('EventIntro', 'Event')], [], sources())

    expect(scene).toHaveLength(0)
  })

  describe('monsters', () => {
    it('places them above the tokens', () => {
      const scene = buildScene([], [{ monsterName: 'MonsterZombie' }], sources())

      expect(scene[0]?.layer).toBe(Layer.MONSTER)
    })

    it('gives several of one type distinct ids', () => {
      const scene = buildScene(
        [],
        [{ monsterName: 'MonsterZombie' }, { monsterName: 'MonsterZombie' }],
        sources(),
      )

      expect(new Set(scene.map((s) => s.id)).size).toBe(2)
    })

    it('draws one with no art as a marker', () => {
      const scene = buildScene([], [{ monsterName: 'MonsterX' }], sources({ monster: () => null }))

      expect(scene[0]?.tint).toBeDefined()
      expect(scene[0]?.label).toBe('MonsterX')
    })
  })
})

describe('sceneBounds', () => {
  it('is null for an empty board', () => {
    expect(sceneBounds([])).toBeNull()
  })

  it('covers every item, for framing the camera on a new quest', () => {
    const scene = buildScene(
      [item('TokenA', 'Token', { x: 0, y: 0 }), item('TokenB', 'Token', { x: 10, y: -4 })],
      [],
      sources(),
    )
    const bounds = sceneBounds(scene)

    expect(bounds?.min.x).toBeLessThanOrEqual(0)
    expect(bounds?.max.x).toBeGreaterThanOrEqual(10)
    expect(bounds?.min.y).toBeLessThanOrEqual(-4)
  })
})
