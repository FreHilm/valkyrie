/**
 * Tests for the board's art lookups (T-018).
 *
 * Tiles size themselves from their image and their side's pixels-per-square,
 * tokens from the rectangle they occupy in a sheet, monsters from the placement
 * that put them there. The C# does each in a different file and none of them
 * can be checked without a running game.
 */

import { describe, expect, it } from 'vitest'

import {
  headlessContext,
  loadQuestSections,
  readFromString,
  ContentData,
  ContentLoader,
} from '@valkyrie/core'
import { monsterSize, questArt } from '../src/questArt.js'

function content(ini: string, resolve: (name: string) => string | null): ContentData {
  const context = headlessContext({ resolveTextureFile: resolve, tilePixelPerSquare: 100 })
  const data = new ContentData(context)
  new ContentLoader(data, context).loadIni(readFromString(ini), '/pack', 'pack')
  return data
}

function components(ini: string) {
  return loadQuestSections(readFromString(ini), 'test.ini', { format: 18 })
}

const always = (name: string): string | null => `${name}.webp`
const size256 = () => ({ width: 256, height: 256 })

describe('monsterSize', () => {
  it('knows the game’s own vocabulary', () => {
    // TokenBoard.cs:213.
    expect(monsterSize('small', null, 100)).toEqual({ width: 1, height: 1 })
    expect(monsterSize('medium', null, 100)).toEqual({ width: 2, height: 1 })
    expect(monsterSize('huge', null, 100)).toEqual({ width: 2, height: 2 })
    expect(monsterSize('massive', null, 100)).toEqual({ width: 3, height: 2 })
  })

  it('takes a bare number as a square', () => {
    expect(monsterSize('1.5', null, 100)).toEqual({ width: 1.5, height: 1.5 })
  })

  it('measures "Original" against the decoded image', () => {
    expect(monsterSize('Original', { width: 200, height: 100 }, 100)).toEqual({
      width: 2,
      height: 1,
    })
  })

  it('falls back to one square while the image is still loading', () => {
    expect(monsterSize('Original', null, 100)).toEqual({ width: 1, height: 1 })
  })

  it('falls back rather than producing NaN for nonsense', () => {
    // A NaN size puts the monster nowhere at all.
    expect(monsterSize('enormous', null, 100)).toEqual({ width: 1, height: 1 })
    expect(monsterSize('-3', null, 100)).toEqual({ width: 1, height: 1 })
    expect(monsterSize('Original', { width: 200, height: 100 }, 0)).toEqual({
      width: 1,
      height: 1,
    })
  })
})

describe('questArt', () => {
  const CONTENT = `[TileSideFoyer]
image=img/foyer
top=10
left=20
pps=100
aspect=0

[TokenDoor]
image=img/sheet
x=64
y=0
width=128
height=128
pps=64
`

  const art = (questIni: string, sizeOf = size256) =>
    questArt({
      content: content(CONTENT, always),
      components: components(questIni),
      resolveTexture: always,
      sizeOf,
      gameType: 'MoM',
      pixelsPerSquare: 100,
    })

  describe('tiles', () => {
    it('takes its geometry from the side and its size from the image', () => {
      const sources = art('[TileFoyer]\nside=TileSideFoyer\n')

      expect(sources.tile('TileFoyer')).toEqual({
        // The loader combines the pack directory with the declared name, so a
        // pack's art resolves relative to the pack rather than the app.
        image: '/pack/img/foyer.webp',
        pixelsPerSquare: 100,
        aspect: 0,
        top: 10,
        left: 20,
        imageWidth: 256,
        imageHeight: 256,
      })
    })

    it('waits for the image rather than placing it at a guessed size', () => {
      // Placing it early would move the tile once the real size arrived.
      const sources = art('[TileFoyer]\nside=TileSideFoyer\n', () => null)

      expect(sources.tile('TileFoyer')).toBeNull()
    })

    it('is null for a side the content does not define', () => {
      const sources = art('[TileFoyer]\nside=TileSideMissing\n')

      expect(sources.tile('TileFoyer')).toBeNull()
    })

    it('lets a quest override the art without changing the geometry', () => {
      const sources = art('[TileFoyer]\nside=TileSideFoyer\ncustomImage=img/custom\n')
      const tile = sources.tile('TileFoyer')

      expect(tile?.image).toBe('img/custom.webp')
      expect(tile?.top).toBe(10)
    })
  })

  describe('tokens', () => {
    it('carries the rectangle it occupies in the sheet', () => {
      const sources = art('[TokenA]\ntype=TokenDoor\n')

      expect(sources.token('TokenA')?.crop).toEqual({ x: 64, y: 0, width: 128, height: 128 })
    })

    it('measures its board size from that rectangle', () => {
      // 128 pixels at 64 per square is two squares.
      const sources = art('[TokenA]\ntype=TokenDoor\n')

      expect(sources.token('TokenA')).toMatchObject({ width: 2, height: 2 })
    })

    it('is one square when the content gives no rectangle', () => {
      const sources = questArt({
        content: content('[TokenPlain]\nimage=img/plain\n', always),
        components: components('[TokenA]\ntype=TokenPlain\n'),
        resolveTexture: always,
        sizeOf: size256,
        gameType: 'MoM',
        pixelsPerSquare: 100,
      })

      expect(sources.token('TokenA')).toMatchObject({ width: 1, height: 1 })
    })

    it('is null when the art cannot be resolved', () => {
      const sources = questArt({
        content: content(CONTENT, () => null),
        components: components('[TokenA]\ntype=TokenDoor\n'),
        resolveTexture: () => null,
        sizeOf: size256,
        gameType: 'MoM',
        pixelsPerSquare: 100,
      })

      expect(sources.token('TokenA')).toBeNull()
    })
  })

  it('aligns Descent tiles to the grid and Mansions tiles not', () => {
    const mom = art('[TileFoyer]\nside=TileSideFoyer\n')
    const d2e = questArt({
      content: content(CONTENT, always),
      components: components('[TileFoyer]\nside=TileSideFoyer\n'),
      resolveTexture: always,
      sizeOf: size256,
      gameType: 'D2E',
      pixelsPerSquare: 105,
    })

    expect(mom.onGrid).toBe(false)
    expect(d2e.onGrid).toBe(true)
  })
})
