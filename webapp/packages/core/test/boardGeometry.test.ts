/**
 * Tests for board geometry (T-017).
 *
 * The placement maths comes from the `Tile` class in `Quest.cs` and from
 * `TokenBoard.cs`, which build positions through a sequence of Unity transform
 * calls. Reproduced as arithmetic, so the numbers here are the assertions.
 */

import { describe, expect, it } from 'vitest'

import {
  boardBounds,
  boundsOf,
  hitTest,
  placeTile,
  placeToken,
  rotateAboutOrigin,
} from '../src/board/geometry.js'
import type { TilePlacement } from '../src/board/geometry.js'

/** A tile whose grid origin is its centre, so placement is easy to reason about. */
const centredTile = (overrides: Partial<TilePlacement> = {}): TilePlacement => ({
  imageWidth: 200,
  imageHeight: 100,
  side: { pixelsPerSquare: 100, left: 100, top: 50, aspect: 0 },
  location: { x: 0, y: 0 },
  rotation: 0,
  onGrid: false,
  ...overrides,
})

describe('rotateAboutOrigin', () => {
  it('leaves a point alone at zero degrees', () => {
    expect(rotateAboutOrigin({ x: 3, y: 4 }, 0)).toEqual({ x: 3, y: 4 })
  })

  it('rotates counter-clockwise, as Unity does about the forward axis', () => {
    const rotated = rotateAboutOrigin({ x: 1, y: 0 }, 90)

    expect(rotated.x).toBeCloseTo(0, 10)
    expect(rotated.y).toBeCloseTo(1, 10)
  })

  it('turns a point through half a circle', () => {
    const rotated = rotateAboutOrigin({ x: 2, y: 3 }, 180)

    expect(rotated.x).toBeCloseTo(-2, 10)
    expect(rotated.y).toBeCloseTo(-3, 10)
  })
})

describe('placeTile', () => {
  it('sizes a tile in board squares from its pixels-per-square', () => {
    const placed = placeTile(centredTile())

    expect(placed.width).toBe(2)
    expect(placed.height).toBe(1)
  })

  it('centres a tile whose grid origin is its middle', () => {
    const placed = placeTile(centredTile())

    expect(placed.centre).toEqual({ x: 0, y: 0 })
  })

  // The C# translates right by (width/2 - left) and *down* by (height/2 - top).
  it('offsets a tile whose grid origin is its top-left corner', () => {
    const placed = placeTile(
      centredTile({ side: { pixelsPerSquare: 100, left: 0, top: 0, aspect: 0 } }),
    )

    expect(placed.centre).toEqual({ x: 1, y: -0.5 })
  })

  it('moves the tile to the quest location', () => {
    const placed = placeTile(centredTile({ location: { x: 5, y: -3 } }))

    expect(placed.centre).toEqual({ x: 5, y: -3 })
  })

  // Descent aligns tiles to square corners; Mansions does not.
  it('shifts by half a square on a grid-aligned game', () => {
    const placed = placeTile(centredTile({ onGrid: true }))

    expect(placed.centre).toEqual({ x: -0.5, y: 0.5 })
  })

  it('rotates about the board origin, then translates', () => {
    const placed = placeTile(
      centredTile({
        side: { pixelsPerSquare: 100, left: 0, top: 0, aspect: 0 },
        rotation: 90,
        location: { x: 10, y: 0 },
      }),
    )

    // The (1, -0.5) offset turns into (0.5, 1) before the location is added.
    expect(placed.centre.x).toBeCloseTo(10.5, 10)
    expect(placed.centre.y).toBeCloseTo(1, 10)
    expect(placed.rotation).toBe(90)
  })

  it('derives the horizontal scale from a non-zero aspect', () => {
    const placed = placeTile(
      centredTile({ side: { pixelsPerSquare: 100, left: 100, top: 50, aspect: 2 } }),
    )

    // hPPS = 100 * 200 / 100 / 2 = 100, so width stays 2 squares.
    expect(placed.width).toBe(2)
    expect(placed.height).toBe(1)
  })
})

describe('placeToken', () => {
  it('centres a single-square token on its square', () => {
    const placed = placeToken({ location: { x: 4, y: 7 }, width: 1, height: 1 })

    expect(placed.centre).toEqual({ x: 4, y: 7 })
  })

  // TokenBoard offsets by (size - 1) / 2, growing down and to the right.
  it('grows a larger token from its square', () => {
    const placed = placeToken({ location: { x: 0, y: 0 }, width: 3, height: 2 })

    expect(placed.centre).toEqual({ x: 1, y: -0.5 })
  })

  it('carries a rotation through', () => {
    expect(
      placeToken({ location: { x: 0, y: 0 }, width: 1, height: 1, rotation: -90 }),
    ).toMatchObject({
      rotation: -90,
    })
  })
})

describe('boundsOf', () => {
  it('boxes an unrotated tile exactly', () => {
    const box = boundsOf({ centre: { x: 0, y: 0 }, width: 4, height: 2, rotation: 0 })

    expect(box).toEqual({ x: -2, y: -1, width: 4, height: 2 })
  })

  it('grows the box for a rotated tile', () => {
    const box = boundsOf({ centre: { x: 0, y: 0 }, width: 4, height: 2, rotation: 90 })

    expect(box.width).toBeCloseTo(2, 10)
    expect(box.height).toBeCloseTo(4, 10)
  })
})

describe('hitTest', () => {
  const tile = { centre: { x: 0, y: 0 }, width: 4, height: 2, rotation: 0 }

  it('accepts a point inside', () => {
    expect(hitTest(tile, { x: 1.5, y: 0.5 })).toBe(true)
  })

  it('accepts a point exactly on the edge', () => {
    expect(hitTest(tile, { x: 2, y: 1 })).toBe(true)
  })

  it('rejects a point outside', () => {
    expect(hitTest(tile, { x: 2.5, y: 0 })).toBe(false)
  })

  /**
   * The point is rotated into the tile's own frame rather than the tile's
   * bounding box being used, so a corner of the box that the tile does not
   * actually cover is correctly a miss.
   */
  it('respects rotation rather than testing the bounding box', () => {
    const rotated = { ...tile, rotation: 90 }

    expect(hitTest(rotated, { x: 0.5, y: 1.5 })).toBe(true)
    expect(hitTest(rotated, { x: 1.5, y: 0.5 })).toBe(false)
  })
})

describe('boardBounds', () => {
  it('is null for an empty board', () => {
    expect(boardBounds([])).toBeNull()
  })

  it('spans everything on the board', () => {
    const box = boardBounds([
      { centre: { x: 0, y: 0 }, width: 2, height: 2, rotation: 0 },
      { centre: { x: 10, y: -4 }, width: 2, height: 2, rotation: 0 },
    ])

    expect(box).toEqual({ x: -1, y: -5, width: 12, height: 6 })
  })
})
