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
  contentMonster,
  CustomMonster,
  ImageData,
  MonsterData,
  MPlace,
  QuestUI,
  resolveQuestMonster,
  TextAlignment,
  Tile,
  TileSideData,
  Token,
  TokenData,
} from '@valkyrie/core'
import type {
  BaseMonsterView,
  ContentData,
  QuestComponent,
  ResolvedMonster,
  StringKey,
} from '@valkyrie/core'
import type { Crop } from '@valkyrie/platform'
import type { QuestUiElement, SceneSources, TileArt, TokenArt } from '@valkyrie/ui'

/** Pixel dimensions of a decoded image, or null while it is still loading. */
export type SizeLookup = (path: string) => { width: number; height: number } | null

export interface ArtOptions {
  content: ContentData
  components: ReadonlyMap<string, QuestComponent>
  /** Resolves a content image name to a file that exists. */
  resolveTexture: (name: string) => string | null
  sizeOf: SizeLookup
  /** The scenario's directory, which its own art is named relative to. */
  questPath?: string
  gameType: 'MoM' | 'D2E'
  /** Board squares per image pixel, for sizes given as "Original". */
  pixelsPerSquare: number
  /** Reports content a scenario needs and the player has not got. */
  onWarning?: (message: string) => void
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
    ...(options.onWarning === undefined ? {} : { onWarning: options.onWarning }),
    onGrid: options.gameType === 'D2E',

    tile: (name: string): TileArt | null => {
      const component = components.get(name)
      if (!(component instanceof Tile)) return null

      // `customImage` overrides the side's art without changing its geometry.
      const side = tileSide(content, component.tileSideName)
      if (side === null) {
        // `Quest.Tile` calls `Application.Quit()` here — the tile is part of
        // an expansion that is not loaded, and without it there is no board.
        // Drawing nothing and saying nothing is the one outcome that leaves a
        // player with no idea what happened.
        options.onWarning?.(
          `Tile ${name} needs ${component.tileSideName}, which is not in the ` +
            `content you have selected. If you own the expansion it comes ` +
            `from, turn it on in Content.`,
        )
        return null
      }

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
      const profile = monsterProfile(content, components, monsterName, options.questPath ?? '')
      const image = resolveTexture(profile?.resolved.imagePlace ?? '')
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

/**
 * Every tile image a quest might place, so their sizes can be learned up front.
 *
 * A tile's board size comes from its image's pixel size, and `questArt.tile`
 * returns nothing until that is known — but the image is only fetched for
 * items already in the scene. Left alone the two wait for each other and no
 * tile is ever drawn. Fetching them ahead breaks the circle.
 */
export function tileImages(options: {
  content: ContentData
  components: ReadonlyMap<string, QuestComponent>
  resolveTexture: (name: string) => string | null
}): string[] {
  const paths = new Set<string>()
  for (const [, component] of options.components) {
    if (!(component instanceof Tile)) continue
    const side = options.content.tryGet(TileSideData, component.tileSideName)
    const declared = component.customImage.length > 0 ? component.customImage : side?.image
    if (declared === undefined) continue
    const file = options.resolveTexture(declared)
    if (file !== null) paths.add(file)
  }
  return [...paths]
}

/** What a scenario's screen-space elements need, beyond their own component. */
export interface QuestUiOptions {
  content: ContentData
  components: ReadonlyMap<string, QuestComponent>
  /** The names currently on the board, in the order they were added. */
  onBoard: readonly string[]
  resolveTexture: (name: string) => string | null
  /** Turns a resolved file into something an `<img>` can show. */
  imageUrl: (path: string, crop?: Crop) => string | null
  /** Pixel size of a decoded image, for the aspect an image element takes. */
  sizeOf: SizeLookup
  /**
   * Resolves a file named beside the scenario, localised variants included.
   * `Quest.cs:2026` reaches for this, not for content, when an image name is
   * not one the game already ships.
   */
  resolveQuestFile: (name: string) => string | null
  /** Resolves the element's `uitext` key. */
  text: (key: StringKey) => string
}

/**
 * Builds the scenario's screen-space elements from what is on the board.
 *
 * `Quest.UI` looks the image up as content `ImageData` first — which is how a
 * scenario reuses a sheet the game already ships — and only then as a file
 * beside the quest. Both paths end at the same `<img>`.
 */
export function questUiElements(options: QuestUiOptions): QuestUiElement[] {
  const { content, components, resolveTexture, imageUrl, sizeOf, text } = options
  const { resolveQuestFile } = options
  const built: QuestUiElement[] = []

  for (const name of options.onBoard) {
    const component = components.get(name)
    if (!(component instanceof QuestUI)) continue

    let image: string | null = null
    let aspect = component.aspect

    if (component.imageName.length > 0) {
      const data = content.tryGet(ImageData, component.imageName)
      const known = data !== null && data !== undefined
      // `Quest.cs:2021`. A name the content knows is a sheet the game ships,
      // addressed by the absolute path its pack recorded. Anything else is a
      // file the author put beside the scenario — `meteorite.jpg` — which no
      // content lookup can find, because it is named relative to the quest.
      const file = known ? resolveTexture(data.image) : resolveQuestFile(component.imageName)
      if (file !== null) {
        const crop =
          known && data.width > 0 && data.height > 0
            ? { x: data.x, y: data.y, width: data.width, height: data.height }
            : undefined
        image = imageUrl(file, crop)
        // The aspect of an image element is the art's, not the declared one.
        const size = crop ?? sizeOf(file)
        if (size !== null && size.height > 0) aspect = size.width / size.height
      }
    }

    built.push({
      name,
      image,
      aspect,
      text: text(component.uiText),
      placement: {
        x: component.location?.x ?? 0,
        y: component.location?.y ?? 0,
        size: component.size,
        hAlign: component.hAlign,
        vAlign: component.vAlign,
        verticalUnits: component.verticalUnits,
      },
      textSize: component.textSize,
      textColour: component.textColor,
      backgroundColour: component.textBackgroundColor,
      textAlignment:
        component.textAlignment === TextAlignment.TOP
          ? 'top'
          : component.textAlignment === TextAlignment.BOTTOM
            ? 'bottom'
            : 'centre',
      border: component.border,
      clickable: component.enableClick,
    })
  }

  return built
}

/** Everything the monster dialog needs about one monster in play. */
export interface MonsterProfile {
  resolved: ResolvedMonster
  /** The `CustomMonster` behind it, when a scenario defined this monster. */
  custom: CustomMonster | null
}

/**
 * Resolves a monster instance to its type, quest overrides included.
 *
 * `Quest.Monster` holds a `MonsterData` that is either a content section or a
 * `QuestMonster` standing in for one, and every dialog reads it without caring
 * which. This is that same join.
 */
export function monsterProfile(
  content: ContentData,
  components: ReadonlyMap<string, QuestComponent>,
  monsterName: string,
  questPath: string,
): MonsterProfile | null {
  const base = (name: string): BaseMonsterView | undefined => {
    const data = content.tryGet(MonsterData, name)
    if (data === undefined) return undefined
    return {
      name: data.name,
      info: data.info,
      traits: data.traits,
      image: data.image,
      activations: data.activations,
      healthBase: data.healthBase,
      healthPerHero: data.healthPerHero,
      horror: data.horror,
      awareness: data.awareness,
    }
  }

  const custom = components.get(monsterName)
  if (custom instanceof CustomMonster) {
    return {
      custom,
      resolved: resolveQuestMonster(
        {
          sectionName: monsterName,
          baseMonster: custom.baseMonster,
          monsterName: custom.monsterName,
          info: custom.info,
          traits: custom.traits,
          imagePath: custom.imagePath,
          imagePlace: custom.imagePlace,
          activations: custom.activations,
          healthBase: custom.healthBase,
          healthPerHero: custom.healthPerHero,
          healthDefined: custom.healthDefined,
          horror: custom.horror,
          horrorDefined: custom.horrorDefined,
          awareness: custom.awareness,
          awarenessDefined: custom.awarenessDefined,
        },
        base(custom.baseMonster),
        questPath,
        (key) => key.keyExists(),
      ),
    }
  }

  const data = content.tryGet(MonsterData, monsterName)
  if (data === undefined) return null
  return {
    custom: null,
    resolved: contentMonster(monsterName, {
      name: data.name,
      info: data.info,
      traits: data.traits,
      image: data.image,
      imagePlace: data.imagePlace,
      activations: data.activations,
      healthBase: data.healthBase,
      healthPerHero: data.healthPerHero,
      horror: data.horror,
      awareness: data.awareness,
    }),
  }
}
