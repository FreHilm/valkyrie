/**
 * Turning a quest's board contents into drawable items.
 *
 * The runtime knows *what* is on the board; the content packs know what each
 * thing looks like and how big it is; `board/geometry.ts` knows where it goes.
 * This is the join, and it is deliberately one place: in the C# the same
 * calculation is spread across `TokenBoard`, `TileSideData` and half a dozen
 * `MonoBehaviour`s, and none of it can be checked without a running game.
 *
 * Art loads asynchronously, so an item is produced with `image: null` and the
 * caller redraws when the texture arrives. The board hit-tests either way, so
 * a quest is playable before its art has finished loading.
 */

import { placeTile, placeToken } from '@valkyrie/core'
import type { BoardItem as RuntimeItem, PlacedTile, Point } from '@valkyrie/core'
import { Layer } from './board.js'
import type { BoardItem } from './board.js'

/** What content knows about a tile's art. */
export interface TileArt {
  image: string
  /** Pixels per board square. */
  pixelsPerSquare: number
  aspect: number
  top: number
  left: number
  /** Pixel size of the image itself, known once it is decoded. */
  imageWidth: number
  imageHeight: number
}

/** What content knows about a token's art, including its place in a sheet. */
export interface TokenArt {
  image: string
  /** The rectangle within the sheet, absent for a whole-file image. */
  crop?: { x: number; y: number; width: number; height: number }
  /** Size in board squares. */
  width: number
  height: number
}

/** The space an event points at, and the card it hands over if it has one. */
export interface BoardHighlight {
  at: Point
  /** The resolved item whose card is drawn there, or null for a plain mark. */
  item: string | null
}

export interface SceneSources {
  /** Art for a `Tile` component's side, or null when it is unknown. */
  tile: (component: string) => TileArt | null
  /** Art for a `Token`, `Door` or `UI` component. */
  token: (component: string) => TokenArt | null
  /** Art for a monster on the board. */
  monster: (monsterName: string) => TokenArt | null
  /** Card art for an item a highlight event hands over. */
  item?: (id: string) => TokenArt | null
  /** Descent aligns tiles to square corners; Mansions does not. */
  onGrid: boolean
  /** Receives the reason an item could not be placed. */
  onWarning?: (message: string) => void
}

/** One drawable, with the art it still needs. */
export interface SceneItem extends BoardItem {
  /** The image to load, or null when the item has none. */
  source: { path: string; crop?: TokenArt['crop'] } | null
}

/**
 * Builds the scene for the current board contents.
 *
 * Order is the runtime's insertion order, which is why `QuestRuntime` keeps
 * one: tiles have to render under the tokens standing on them, and two tiles
 * that overlap resolve by the order the quest placed them.
 */
export function buildScene(
  items: readonly RuntimeItem[],
  monsters: readonly { monsterName: string; location?: Point }[],
  sources: SceneSources,
  /**
   * `TokenBoard.AddHighlight`: the space the current event points at. Not a
   * component — it belongs to the event rather than the board, and goes away
   * with it — so it is passed in rather than found among the items.
   */
  highlight?: BoardHighlight | null,
): SceneItem[] {
  const scene: SceneItem[] = []

  for (const item of items) {
    const type = item.component.type
    const location = item.component.location ?? { x: 0, y: 0 }
    const rotation = item.component.rotation ?? 0

    if (type === 'Tile') {
      const art = sources.tile(item.name)
      if (art === null) continue
      const placed = placeTile({
        imageWidth: art.imageWidth,
        imageHeight: art.imageHeight,
        side: {
          pixelsPerSquare: art.pixelsPerSquare,
          aspect: art.aspect,
          top: art.top,
          left: art.left,
        },
        location,
        rotation,
        onGrid: sources.onGrid,
      })

      // A tile's geometry divides by its pixels-per-square, so a side that
      // declares `pps=0` — or a game type with no scale configured — puts the
      // tile at NaN and it silently disappears. Saying so beats vanishing.
      if (!Number.isFinite(placed.centre.x) || !Number.isFinite(placed.centre.y)) {
        sources.onWarning?.(
          `Tile ${item.name} has no usable pixels-per-square and cannot be placed`,
        )
        continue
      }

      scene.push({
        id: item.name,
        layer: Layer.TILE,
        placed,
        image: null,
        label: item.name,
        // Floor. The C# keeps tiles on their own canvas, which takes no
        // clicks; here a click on one queued an event named after the tile and
        // logged "Missing event called" for scenery nobody meant to touch.
        interactive: false,
        source: { path: art.image },
      })
      continue
    }

    // Not 'UI': a [UI...] component is a screen-space overlay, not a board
    // piece. Placing one on the grid put a 1x1 untextured square wherever its
    // screen fraction happened to land, which is what a scenario's opening
    // journal was being drawn as.
    if (type === 'Token' || type === 'Door') {
      const art = sources.token(item.name)
      // A token with no art is still a thing the player can click, so it is
      // drawn as a plain marker rather than dropped.
      const size = art ?? { image: '', width: 1, height: 1 }
      scene.push({
        id: item.name,
        // Doors and tokens share a layer; the C# has no separate one either.
        layer: Layer.TOKEN,
        placed: placeToken({ location, width: size.width, height: size.height, rotation }),
        image: null,
        ...(art === null ? { tint: 'var(--vk-token-unknown, #6b7280)' } : {}),
        label: item.name,
        source: art === null ? null : { path: art.image, ...(art.crop ? { crop: art.crop } : {}) },
      })
      continue
    }
  }

  for (const [index, monster] of monsters.entries()) {
    const art = sources.monster(monster.monsterName)
    const location = monster.location ?? { x: 0, y: 0 }
    const size = art ?? { image: '', width: 1, height: 1 }
    scene.push({
      // A scenario can have several of one type, so the index disambiguates.
      id: `monster:${index}:${monster.monsterName}`,
      layer: Layer.MONSTER,
      placed: placeToken({ location, width: size.width, height: size.height }),
      image: null,
      ...(art === null ? { tint: 'var(--vk-monster-unknown, #b91c1c)' } : {}),
      label: monster.monsterName,
      source: art === null ? null : { path: art.image, ...(art.crop ? { crop: art.crop } : {}) },
    })
  }

  if (highlight !== undefined && highlight !== null) {
    // `AddHighlight` draws the item's own card where the event points, and
    // falls back to a marker when the event hands nothing over — or hands
    // over more than one thing, which no card could stand for.
    const art = highlight.item === null ? null : (sources.item?.(highlight.item) ?? null)
    const size = art ?? { image: '', width: 1, height: 1 }
    scene.push({
      id: 'highlight',
      layer: Layer.HIGHLIGHT,
      // A mark over a space, not a thing to press: whatever it points at is
      // already on the board underneath it.
      interactive: false,
      placed: placeToken({ location: highlight.at, width: size.width, height: size.height }),
      image: null,
      // DEVIATION: the C# marker is a pulsing `sprites/target` reticle. A
      // tinted square says the same thing without an animation loop running
      // on the canvas for one marker, or a sprite to ship for it.
      ...(art === null ? { tint: 'var(--vk-highlight, #eab30899)' } : {}),
      label: 'Highlighted space',
      source: art === null ? null : { path: art.image, ...(art.crop ? { crop: art.crop } : {}) },
    })
  }

  return scene
}

/** The bounding box of a scene, for framing the camera on a new quest. */
export function sceneBounds(scene: readonly SceneItem[]): {
  min: Point
  max: Point
} | null {
  if (scene.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const item of scene) {
    const box = boxOf(item.placed)
    minX = Math.min(minX, box.min.x)
    minY = Math.min(minY, box.min.y)
    maxX = Math.max(maxX, box.max.x)
    maxY = Math.max(maxY, box.max.y)
  }
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } }
}

/** Axis-aligned box, ignoring rotation — enough for framing. */
function boxOf(placed: PlacedTile): { min: Point; max: Point } {
  const halfWidth = placed.width / 2
  const halfHeight = placed.height / 2
  return {
    min: { x: placed.centre.x - halfWidth, y: placed.centre.y - halfHeight },
    max: { x: placed.centre.x + halfWidth, y: placed.centre.y + halfHeight },
  }
}
