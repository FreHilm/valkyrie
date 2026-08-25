/**
 * Board geometry: where tiles, tokens and monsters sit, and what a click hits.
 *
 * Extracted from the placement code spread through `Quest.cs` (the `Tile`
 * class) and `TokenBoard.cs`. The task notes ask for this separation
 * explicitly — `Quest.cs` mixes 34 `Vector2`s of board geometry into what is
 * otherwise quest state.
 *
 * Everything here is pure: no canvas, no DOM. The renderer in `@valkyrie/ui`
 * consumes it, and so does hit testing, so the two cannot disagree about where
 * something is.
 *
 * Board space is Unity's: X right, Y **up**, one unit per grid square.
 */

/** A point in board space. */
export interface Point {
  x: number
  y: number
}

/** An axis-aligned box in board space. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** What a tile's content pack says about how its image maps to squares. */
export interface TileSide {
  /** `TileSideData.pxPerSquare`: image pixels per board square. */
  pixelsPerSquare: number
  /** Pixel offset of the grid origin within the image. */
  left: number
  top: number
  /**
   * `TileSideData.aspect`. Zero means square pixels; otherwise the horizontal
   * scale is derived from it, which is how non-square tiles are described.
   */
  aspect: number
}

export interface TilePlacement {
  /** Image size in pixels. */
  imageWidth: number
  imageHeight: number
  side: TileSide
  /** Where the quest puts it, in board squares. */
  location: Point
  /** Degrees, counter-clockwise, about the board origin. */
  rotation: number
  /**
   * `GameType.TileOnGrid()`: true for Descent, false for Mansions. Descent
   * tiles align to square corners, so they shift by half a square.
   */
  onGrid: boolean
}

/** A tile placed on the board: where its centre is, how big, how rotated. */
export interface PlacedTile {
  centre: Point
  width: number
  height: number
  rotation: number
}

/**
 * Where a tile ends up.
 *
 * The C# builds this with a sequence of Unity transform calls: translate the
 * image so its grid origin lands on the board origin, shift half a square on
 * grid-aligned games, rotate about the origin, then translate to the quest's
 * location. Reproduced as arithmetic so it can be tested without Unity.
 */
export function placeTile(tile: TilePlacement): PlacedTile {
  const vertical = tile.side.pixelsPerSquare
  const horizontal =
    tile.side.aspect === 0
      ? vertical
      : (vertical * tile.imageWidth) / tile.imageHeight / tile.side.aspect

  const width = tile.imageWidth / horizontal
  const height = tile.imageHeight / vertical

  // Translate right and *down*, which is negative Y in board space.
  let x = (tile.imageWidth / 2 - tile.side.left) / horizontal
  let y = -(tile.imageHeight / 2 - tile.side.top) / vertical

  if (tile.onGrid) {
    x -= 0.5
    y += 0.5
  }

  const rotated = rotateAboutOrigin({ x, y }, tile.rotation)
  return {
    centre: { x: rotated.x + tile.location.x, y: rotated.y + tile.location.y },
    width,
    height,
    rotation: tile.rotation,
  }
}

/** Counter-clockwise rotation about the board origin, in degrees. */
export function rotateAboutOrigin(point: Point, degrees: number): Point {
  if (degrees === 0) return { x: point.x, y: point.y }

  const radians = (degrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  }
}

export interface TokenPlacement {
  location: Point
  /** Size in board squares. Most tokens are 1x1; monsters can be larger. */
  width: number
  height: number
  rotation?: number
}

/**
 * Where a token or monster marker ends up.
 *
 * `TokenBoard` offsets by half of `size - 1`, which keeps a 1x1 token centred
 * on its square and grows larger ones down and to the right from it.
 */
export function placeToken(token: TokenPlacement): PlacedTile {
  const x = token.location.x + (token.width - 1) / 2
  const y = token.location.y - (token.height - 1) / 2

  return {
    centre: { x, y },
    width: token.width,
    height: token.height,
    rotation: token.rotation ?? 0,
  }
}

/** The axis-aligned box a placed item covers, accounting for rotation. */
export function boundsOf(placed: PlacedTile): Rect {
  const half = extentOf(placed)
  return {
    x: placed.centre.x - half.x,
    y: placed.centre.y - half.y,
    width: half.x * 2,
    height: half.y * 2,
  }
}

/** Half-width and half-height of a rotated rectangle's bounding box. */
function extentOf(placed: PlacedTile): Point {
  const radians = (placed.rotation * Math.PI) / 180
  const cos = Math.abs(Math.cos(radians))
  const sin = Math.abs(Math.sin(radians))
  return {
    x: (placed.width * cos + placed.height * sin) / 2,
    y: (placed.width * sin + placed.height * cos) / 2,
  }
}

/**
 * Whether a board-space point falls inside a placed item.
 *
 * The point is rotated back into the item's own frame rather than the item
 * being rotated forward, which keeps the test exact for rotated tiles instead
 * of using their bounding box.
 */
export function hitTest(placed: PlacedTile, point: Point): boolean {
  const relative = {
    x: point.x - placed.centre.x,
    y: point.y - placed.centre.y,
  }
  const local = rotateAboutOrigin(relative, -placed.rotation)
  return Math.abs(local.x) <= placed.width / 2 && Math.abs(local.y) <= placed.height / 2
}

/** The smallest box containing everything, or null when there is nothing. */
export function boardBounds(placed: readonly PlacedTile[]): Rect | null {
  if (placed.length === 0) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const item of placed) {
    const box = boundsOf(item)
    minX = Math.min(minX, box.x)
    minY = Math.min(minY, box.y)
    maxX = Math.max(maxX, box.x + box.width)
    maxY = Math.max(maxY, box.y + box.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}
