/**
 * Tests for scenario UI placement (Quest.cs:2086-2140).
 *
 * The numbers here are what the C# arithmetic produces for the same inputs;
 * they are the contract, because scenarios are authored against it.
 */

import { describe, expect, it } from 'vitest'

import { colourFromName, isColourValid, layoutQuestUi } from '../src/quest/questUi.js'

const SCREEN = { width: 1000, height: 800 }
const base = {
  x: 0,
  y: 0,
  size: 1,
  hAlign: 0,
  vAlign: 0,
  verticalUnits: false,
}

describe('layoutQuestUi', () => {
  it('scales against the screen width by default', () => {
    expect(layoutQuestUi({ ...base, size: 0.5 }, SCREEN, 2)).toEqual({
      left: 250,
      top: 275,
      width: 500,
      height: 250,
    })
  })

  it('scales against the screen height under vunits', () => {
    expect(layoutQuestUi({ ...base, size: 0.5, verticalUnits: true }, SCREEN, 2)).toEqual({
      left: 100,
      top: 200,
      width: 800,
      height: 400,
    })
  })

  it('anchors to the left edge when hAlign is negative', () => {
    const rect = layoutQuestUi({ ...base, size: 0.25, hAlign: -1, x: 0.1 }, SCREEN, 1)
    expect(rect.left).toBe(100)
    expect(rect.width).toBe(250)
  })

  it('anchors to the right edge when hAlign is positive', () => {
    // SetInsetAndSizeFromParentEdge(Right, inset, size): the inset is measured
    // from the right, so the left edge is what is left over.
    const rect = layoutQuestUi({ ...base, size: 0.25, hAlign: 1, x: 0.1 }, SCREEN, 1)
    expect(rect.left).toBe(1000 - 100 - 250)
  })

  it('anchors to the bottom edge when vAlign is positive', () => {
    const rect = layoutQuestUi({ ...base, size: 0.25, vAlign: 1, y: 0.1 }, SCREEN, 1)
    expect(rect.top).toBe(800 - 100 - 250)
  })

  it('offsets a centred element from the centre', () => {
    const rect = layoutQuestUi({ ...base, size: 0.5, x: 0.1, y: -0.1 }, SCREEN, 1)
    expect(rect.left).toBe(100 + (1000 - 500) / 2)
    expect(rect.top).toBe(-100 + (800 - 500) / 2)
  })

  it('scales the horizontal offset by the height under vunits', () => {
    // Quest.cs overwrites unitScale before computing either offset, so the
    // horizontal one is scaled by the screen height. Scenarios rely on it.
    const rect = layoutQuestUi(
      { ...base, size: 0.5, hAlign: -1, x: 0.5, verticalUnits: true },
      SCREEN,
      1,
    )
    expect(rect.left).toBe(400)
  })
})

describe('colourFromName', () => {
  it('maps the names the C# knows', () => {
    expect(colourFromName('Navy')).toBe('#000080')
    expect(colourFromName('transparent')).toBe('#00000000')
  })

  it('returns anything else unchanged', () => {
    expect(colourFromName('#123456')).toBe('#123456')
    expect(colourFromName('chartreuse')).toBe('chartreuse')
  })

  it('reports whether the C# would have warned', () => {
    expect(isColourValid('white')).toBe(true)
    expect(isColourValid('#12345678')).toBe(true)
    expect(isColourValid('chartreuse')).toBe(false)
  })
})
