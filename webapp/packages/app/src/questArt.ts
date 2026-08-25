/**
 * Where each thing on the board gets its picture and its size.
 *
 * Tiles size themselves from their image and their side's pixels-per-square;
 * tokens from the rectangle they occupy in a sprite sheet; monsters from the
 * placement that put them there. The C# does each of these in a different
 * file, and none of them can be checked without a running game.
 *
 * A tile's board size depends on its image's pixel size, which is only known
 * once the image is decoded — so `sizeOf` is a lookup the caller fills in as
 * textures arrive, and the scene is rebuilt when they do.
 */

import {
  CustomMonster,
  MonsterData,
  MPlace,
  Tile,
  TileSideData,
  Token,
  TokenData,
} from '@valkyrie/core'
import type { ContentData, QuestComponent } from '@valkyrie/core'
import type { SceneSources, TileArt, TokenArt } from '@valkyrie/ui'

/** Pixel dimensions of a decoded image, or null while it is still loading. */
export type SizeLookup = (path: string) => { width: number; height: number } | null

export interface ArtOptions {
  content: ContentData
  components: ReadonlyMap<string, QuestComponent>
  /** Resolves a content image name to a file that exists. */
  resolveTexture: (name: string) => string | null
  sizeOf: SizeLookup
  gameType: 'MoM' | 'D2E'
  /** Board squares per image pixel, for sizes given as "Original". */
  pixelsPerSquare: number
}

/**
 * `MPlace.tokenSize`: how many squares a placed monster covers.
 *
 * The named sizes are the game's own vocabulary (`TokenBoard.cs:213`); a bare
 * number is square; "Original" means "as big as the art is", which needs the
 * decoded pixel size and so can only be answered once it has loaded.
 */
export function monsterSize(
  tokenSize: string,
  image: { width: number; height: number } | null,
  pixelsPerSquare: number,
): { width: number; height: number } {
  switch (tokenSize) {
    case 'small':
      return { width: 1, height: 1 }
    case 'medium':
      return { width: 2, height: 1 }
    case 'huge':
      return { width: 2, height: 2 }
    case 'massive':
      return { width: 3, height: 2 }
    case 'Original': {
      if (image === null || pixelsPerSquare <= 0) return { width: 1, height: 1 }
      return { width: image.width / pixelsPerSquare, height: image.height / pixelsPerSquare }
    }
    default: {
      const size = Number.parseFloat(tokenSize)
      // An unparseable size is 1x1 rather than NaN, which would put the monster
      // nowhere at all.
      if (!Number.isFinite(size) || size <= 0) return { width: 1, height: 1 }
      return { width: size, height: size }
    }
  }
}

/** Builds the art lookups the scene builder needs. */
export function questArt(options: ArtOptions): SceneSources {
  const { components, content, resolveTexture, sizeOf } = options

  return {
    onGrid: options.gameType === 'D2E',

    tile: (name: string): TileArt | null => {
      const component = components.get(name)
      if (!(component instanceof Tile)) return null

      // `customImage` overrides the side's art without changing its geometry.
      const side = tileSide(content, component.tileSideName)
      if (side === null) return null

      const image = resolveTexture(
        component.customImage.length > 0 ? component.customImage : side.image,
      )
      if (image === null) return null

      const size = sizeOf(image)
      // Until the image is decoded there is no geometry, and placing it at a
      // guessed size would move it once the real one arrived.
      if (size === null) return null

      return {
        image,
        pixelsPerSquare: side.pxPerSquare,
        aspect: side.aspect,
        top: side.top,
        left: side.left,
        imageWidth: size.width,
        imageHeight: size.height,
      }
    },

    token: (name: string): TokenArt | null => {
      const component = components.get(name)
      if (!(component instanceof Token)) return null

      const data = tokenData(content, component.tokenName)
      const declared = component.customImage.length > 0 ? component.customImage : data?.image
      if (declared === undefined) return null
      const image = resolveTexture(declared)
      if (image === null) return null

      // A token is a rectangle within a sheet, and its board size is that
      // rectangle measured in squares.
      const crop =
        data !== null && data.width > 0 && data.height > 0
          ? { x: data.x, y: data.y, width: data.width, height: data.height }
          : undefined
      const pps = data?.pxPerSquare ?? 0
      const size =
        crop !== undefined && pps > 0
          ? { width: crop.width / pps, height: crop.height / pps }
          : { width: 1, height: 1 }

      return { image, ...(crop === undefined ? {} : { crop }), ...size }
    },

    monster: (monsterName: string): TokenArt | null => {
      const image = resolveTexture(monsterImage(content, components, monsterName) ?? '')
      if (image === null) return null
      const place = components.get(monsterName)
      const tokenSize = place instanceof MPlace ? place.tokenSize : 'small'
      return { image, ...monsterSize(tokenSize, sizeOf(image), options.pixelsPerSquare) }
    },
  }
}

function tileSide(
  content: ContentData,
  name: string,
): { image: string; pxPerSquare: number; aspect: number; top: number; left: number } | null {
  if (name.length === 0) return null
  const side = content.tryGet(TileSideData, name)
  if (side === undefined) return null
  return {
    image: side.image,
    pxPerSquare: side.pxPerSquare,
    aspect: side.aspect,
    top: side.top,
    left: side.left,
  }
}

function tokenData(
  content: ContentData,
  name: string,
): {
  image: string
  x: number
  y: number
  width: number
  height: number
  pxPerSquare: number
} | null {
  if (name.length === 0) return null
  const token = content.tryGet(TokenData, name)
  if (token === undefined) return null
  return {
    image: token.image,
    x: token.x,
    y: token.y,
    width: token.width,
    height: token.height,
    pxPerSquare: token.pxPerSquare,
  }
}

/** A monster's board art: `imagePlace` where it exists, else its portrait. */
function monsterImage(
  content: ContentData,
  components: ReadonlyMap<string, QuestComponent>,
  monsterName: string,
): string | null {
  const quest = components.get(monsterName)
  if (quest instanceof CustomMonster) {
    if (quest.imagePlace.length > 0) return quest.imagePlace
    if (quest.imagePath.length > 0) return quest.imagePath
    return monsterImage(content, components, quest.baseMonster)
  }

  const monster = content.tryGet(MonsterData, monsterName)
  if (monster === undefined) return null
  return monster.imagePlace.length > 0 ? monster.imagePlace : monster.image
}
