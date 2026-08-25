/**
 * Tests for the unit system (T-016), the replacement for `UIScaler.cs`.
 *
 * The C# comment states the expected numbers outright — "The screen is always
 * 30 'units' high. At 4:3 it is 40 across, at 16:9 it is 53.33" — so those are
 * asserted directly.
 */

import { describe, expect, it } from 'vitest'

import {
  MIN_UNIT_PX,
  ROWS_OF_UNITS,
  TEXT_UNITS,
  heightUnits,
  location,
  pixelsPerUnit,
  units,
  widthUnits,
} from '../src/units.js'

describe('UIScaler.cs comment', () => {
  it('makes the screen 30 units high', () => {
    expect(ROWS_OF_UNITS).toBe(30)
    expect(heightUnits({ widthPx: 1600, heightPx: 900 })).toBe(30)
  })

  it('is 40 units across at 4:3', () => {
    expect(widthUnits({ widthPx: 1024, heightPx: 768 })).toBeCloseTo(40, 6)
  })

  it('is 53.33 units across at 16:9', () => {
    expect(widthUnits({ widthPx: 1920, heightPx: 1080 })).toBeCloseTo(53.333, 3)
  })

  it('names small, medium and large as 1, 1.5 and 3 units', () => {
    expect(TEXT_UNITS).toEqual({ small: 1, medium: 1.5, large: 3 })
  })
})

describe('pixelsPerUnit', () => {
  it('divides height by the row count', () => {
    expect(pixelsPerUnit({ widthPx: 1920, heightPx: 1080 })).toBe(36)
  })

  // DEVIATION: the C# has no floor, so 1/30th of a phone's height would put
  // small text at around 5px.
  it('floors the unit so text stays readable on a phone', () => {
    const phone = { widthPx: 390, heightPx: 300 }

    expect(300 / ROWS_OF_UNITS).toBeLessThan(MIN_UNIT_PX)
    expect(pixelsPerUnit(phone)).toBe(MIN_UNIT_PX)
    expect(heightUnits(phone)).toBeLessThan(ROWS_OF_UNITS)
  })

  it('leaves a desktop viewport untouched by the floor', () => {
    expect(heightUnits({ widthPx: 1920, heightPx: 1080 })).toBe(30)
  })
})

describe('location', () => {
  it('scales unit coordinates to pixels, as UIScaler.Location does', () => {
    expect(location({ widthPx: 1920, heightPx: 1080 }, 2, 3)).toEqual({ x: 72, y: 108 })
  })
})

describe('units()', () => {
  it('produces a CSS length against the installed unit', () => {
    expect(units(1.5)).toBe('calc(var(--u) * 1.5)')
  })
})
