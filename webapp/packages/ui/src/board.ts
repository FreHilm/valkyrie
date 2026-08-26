/**
 * The board renderer, replacing `TokenBoard.cs`, `MonsterCanvas.cs` and the
 * tile drawing spread through `Quest.cs`.
 *
 * Canvas2D, on the measurement in the ADR: the Unity camera looks straight
 * down at a flat plane with no rotation, so the board is a pan-and-zoom 2D
 * scene of a few hundred sprites. Neither WebGL nor a CSS 3D transform earns
 * its complexity at that size.
 *
 * The three Unity canvases — board, token, UI — become draw layers here, which
 * keeps the z-order they encoded without three separate elements.
 */

import { boundsOf, hitTest, placeTile, placeToken } from '@valkyrie/core'
import type { PlacedTile, Point, Rect } from '@valkyrie/core'

import { BoardCamera } from './camera.js'
import type { Viewport } from './camera.js'
import { el } from './dom.js'

/** Draw order. Mirrors the Unity canvas stack. */
export const Layer = {
  TILE: 0,
  TOKEN: 1,
  MONSTER: 2,
} as const

export type Layer = (typeof Layer)[keyof typeof Layer]

export interface BoardItem {
  id: string
  layer: Layer
  placed: PlacedTile
  /** Drawn when loaded; the item still hit-tests before then. */
  image: CanvasImageSource | null
  /** Drawn instead of an image, or under a transparent one. */
  tint?: string
  /** Announced for this item; the board is otherwise invisible to a reader. */
  label?: string
  /** Dimmed and not hit-tested. */
  disabled?: boolean
}

export interface BoardOptions {
  onSelect?: (item: BoardItem) => void
  /** Announced as the board's name. */
  label: string
  limits?: ConstructorParameters<typeof BoardCamera>[0]
}

export interface Board {
  element: HTMLElement
  camera: BoardCamera
  setItems: (items: readonly BoardItem[]) => void
  /** Redraws on the next frame. Safe to call repeatedly. */
  invalidate: () => void
  /** Points the camera at everything currently on the board. */
  frameAll: () => void
  /** `CameraController.SetCamera`: centre here and reset to the standard zoom. */
  lookAt: (point: Point) => void
  /** `SetCameraMin` / `SetCameraMax`: how far the player may pan. */
  limitTo: (edge: 'min' | 'max', point: Point) => void
  itemAt: (screen: Point) => BoardItem | null
  destroy: () => void
}

/**
 * Creates a board.
 *
 * Rendering is scheduled on an animation frame rather than done inline, so a
 * drag that fires a hundred pointer events still draws once per frame.
 */
export function board(options: BoardOptions): Board {
  const canvas = el('canvas', {
    class: 'vk-board',
    attrs: {
      role: 'application',
      'aria-label': options.label,
      tabindex: 0,
    },
  })
  const camera = new BoardCamera(options.limits)
  /** An aim taken before the canvas had a size; applied on the first resize. */
  let deferredLook: Point | null = null
  let items: readonly BoardItem[] = []
  let frame = 0

  const context = canvas.getContext('2d')

  const viewport = (): Viewport => ({ width: canvas.width, height: canvas.height })

  const draw = (): void => {
    frame = 0
    if (context === null) return

    const view = viewport()
    context.clearRect(0, 0, view.width, view.height)

    // Layers are drawn in order so tokens land above tiles and monsters above
    // both, which is what the three Unity canvases encoded.
    for (const layer of [Layer.TILE, Layer.TOKEN, Layer.MONSTER]) {
      for (const item of items) {
        if (item.layer !== layer) continue
        drawItem(context, item, camera, view)
      }
    }
  }

  const invalidate = (): void => {
    if (frame !== 0) return
    frame = requestAnimationFrame(draw)
  }

  const setItems = (next: readonly BoardItem[]): void => {
    items = next
    invalidate()
  }

  const itemAt = (screen: Point): BoardItem | null => {
    const point = camera.toBoard(screen, viewport())
    // Topmost first, so a monster wins over the tile beneath it.
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]
      if (item === undefined || item.disabled === true) continue
      if (hitTest(item.placed, point)) return item
    }
    return null
  }

  const detach = attachInput(canvas, camera, viewport, invalidate, (screen) => {
    const item = itemAt(screen)
    if (item !== null) options.onSelect?.(item)
  })

  const resize = new ResizeObserver(() => {
    const rect = canvas.getBoundingClientRect()
    const dpr = globalThis.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.round(rect.width * dpr))
    canvas.height = Math.max(1, Math.round(rect.height * dpr))
    // A quest aims the camera while it is starting, before the canvas has been
    // laid out and while its size is still zero — so the aim is held and taken
    // the moment there is a viewport to take it against.
    if (deferredLook !== null && canvas.width > 1 && canvas.height > 1) {
      const at = deferredLook
      deferredLook = null
      camera.lookAt(at, viewport())
    }
    invalidate()
  })
  resize.observe(canvas)

  return {
    element: canvas,
    camera,
    setItems,
    invalidate,
    lookAt: (point) => {
      if (canvas.width <= 1 || canvas.height <= 1) deferredLook = point
      else camera.lookAt(point, viewport())
      invalidate()
    },

    limitTo: (edge, point) => {
      camera.limitTo(edge, point)
      invalidate()
    },

    frameAll: () => {
      const box = itemsBounds(items)
      if (box !== null) camera.frame(box, viewport())
      invalidate()
    },
    itemAt,
    destroy: () => {
      resize.disconnect()
      detach()
      if (frame !== 0) cancelAnimationFrame(frame)
    },
  }
}

function itemsBounds(items: readonly BoardItem[]): Rect | null {
  if (items.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const item of items) {
    const box = boundsOf(item.placed)
    minX = Math.min(minX, box.x)
    minY = Math.min(minY, box.y)
    maxX = Math.max(maxX, box.x + box.width)
    maxY = Math.max(maxY, box.y + box.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function drawItem(
  context: CanvasRenderingContext2D,
  item: BoardItem,
  camera: BoardCamera,
  view: Viewport,
): void {
  const centre = camera.toScreen(item.placed.centre, view)
  const width = item.placed.width * camera.scale
  const height = item.placed.height * camera.scale

  // Anything entirely off screen costs nothing but the check.
  const reach = Math.max(width, height)
  if (
    centre.x + reach < 0 ||
    centre.y + reach < 0 ||
    centre.x - reach > view.width ||
    centre.y - reach > view.height
  ) {
    return
  }

  context.save()
  context.translate(centre.x, centre.y)
  // Board rotation is counter-clockwise with Y up; the canvas has Y down, so
  // the sign flips here rather than in the geometry.
  if (item.placed.rotation !== 0) {
    context.rotate((-item.placed.rotation * Math.PI) / 180)
  }
  if (item.disabled === true) context.globalAlpha = 0.4

  if (item.tint !== undefined) {
    context.fillStyle = item.tint
    context.fillRect(-width / 2, -height / 2, width, height)
  }
  if (item.image !== null) {
    context.drawImage(item.image, -width / 2, -height / 2, width, height)
  }
  context.restore()
}

/**
 * Pointer and wheel input.
 *
 * Pointer events cover mouse, pen and touch with one path, and two active
 * pointers become a pinch — which is what `CameraController` uses its own
 * touch handling for.
 */
function attachInput(
  canvas: HTMLCanvasElement,
  camera: BoardCamera,
  viewport: () => Viewport,
  invalidate: () => void,
  onTap: (screen: Point) => void,
): () => void {
  const active = new Map<number, Point>()
  let dragged = 0
  let pinchDistance = 0

  const local = (event: PointerEvent | WheelEvent): Point => {
    const rect = canvas.getBoundingClientRect()
    const dpr = globalThis.devicePixelRatio || 1
    return {
      x: (event.clientX - rect.left) * dpr,
      y: (event.clientY - rect.top) * dpr,
    }
  }

  const onPointerDown = (event: PointerEvent): void => {
    canvas.setPointerCapture(event.pointerId)
    active.set(event.pointerId, local(event))
    dragged = 0
    pinchDistance = 0
  }

  const onPointerMove = (event: PointerEvent): void => {
    const previous = active.get(event.pointerId)
    if (previous === undefined) return
    const point = local(event)
    active.set(event.pointerId, point)

    if (active.size === 1) {
      const dx = point.x - previous.x
      const dy = point.y - previous.y
      dragged += Math.abs(dx) + Math.abs(dy)
      camera.panByPixels(dx, dy)
      invalidate()
      return
    }

    if (active.size === 2) {
      const [a, b] = [...active.values()]
      if (a === undefined || b === undefined) return
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }

      if (pinchDistance > 0 && distance > 0) {
        camera.zoomAt(distance / pinchDistance, midpoint, viewport())
        invalidate()
      }
      pinchDistance = distance
      dragged += 100
    }
  }

  const onPointerUp = (event: PointerEvent): void => {
    const point = active.get(event.pointerId)
    active.delete(event.pointerId)
    if (active.size < 2) pinchDistance = 0

    // A drag is not a tap. The threshold is in device pixels and deliberately
    // generous, because a finger never holds perfectly still.
    if (point !== undefined && dragged < 10) onTap(point)
  }

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault()
    const factor = Math.pow(0.999, event.deltaY)
    camera.zoomAt(factor, local(event), viewport())
    invalidate()
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    const step = event.shiftKey ? 200 : 60
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    }
    const move = moves[event.key]
    if (move !== undefined) {
      event.preventDefault()
      camera.panByPixels(move[0], move[1])
      invalidate()
      return
    }
    // The board is otherwise unreachable without a pointer.
    if (event.key === '+' || event.key === '=' || event.key === '-') {
      event.preventDefault()
      const view = viewport()
      camera.zoomAt(
        event.key === '-' ? 1 / 1.2 : 1.2,
        { x: view.width / 2, y: view.height / 2 },
        view,
      )
      invalidate()
    }
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerUp)
  canvas.addEventListener('wheel', onWheel, { passive: false })
  canvas.addEventListener('keydown', onKeyDown)

  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerup', onPointerUp)
    canvas.removeEventListener('pointercancel', onPointerUp)
    canvas.removeEventListener('wheel', onWheel)
    canvas.removeEventListener('keydown', onKeyDown)
  }
}

export { placeTile, placeToken }
