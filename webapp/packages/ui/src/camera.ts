/**
 * Board camera: pan and zoom, replacing `CameraController.cs`.
 *
 * The C# moves a Unity camera in three dimensions — x and y to pan, z to zoom
 * — and clamps each. Here it is a 2D transform from board space to screen
 * space, which is the same thing with the perspective removed.
 *
 * Worth stating, because the ADR assumed otherwise: `Game.unity` sets the
 * camera to perspective, but its rotation is identity and `CameraController`
 * has no rotation code, so it looks straight down at a flat plane. That is
 * visually identical to an orthographic view, which is why this is a 2D
 * transform and not a 3D one.
 */

export interface CameraLimits {
  /** `CameraController.minPanX` and friends, in board squares. */
  minX: number
  maxX: number
  minY: number
  maxY: number
  /** Board squares per screen pixel, at the extremes. */
  minScale: number
  maxScale: number
}

/**
 * How much board a scenario expects to be looking at, in squares.
 *
 * `CameraController.SetCamera` puts the camera at `z = -8` and the scene's
 * camera is a 60-degree perspective one (`Game.unity:521`), so the plane at
 * `z = 0` shows `2 * 8 * tan(30°)` squares from top to bottom. Every event
 * that moves the camera resets to exactly this, which is why a scenario can
 * rely on what will be in shot.
 */
export const STANDARD_VIEW_SQUARES = 16 * Math.tan(Math.PI / 6)

export const DEFAULT_LIMITS: CameraLimits = {
  minX: -50,
  maxX: 50,
  minY: -50,
  maxY: 50,
  minScale: 8,
  maxScale: 160,
}

/** Canvas size in device pixels. Distinct from the unit system's viewport,
 * which is measured in CSS pixels for layout. */
export interface Viewport {
  width: number
  height: number
}

/**
 * Maps board space to screen space.
 *
 * Board space has Y up, screen space has Y down, so the transform flips it —
 * the one place that inversion lives.
 */
export class BoardCamera {
  /** Board-space point at the centre of the view. */
  centre = { x: 0, y: 0 }
  /** Screen pixels per board square. */
  scale = 40

  private readonly limits: CameraLimits

  // Copied, because `limitTo` writes to it and the default is shared.
  constructor(limits: CameraLimits = DEFAULT_LIMITS) {
    this.limits = { ...limits }
  }

  toScreen(point: { x: number; y: number }, viewport: Viewport): { x: number; y: number } {
    return {
      x: (point.x - this.centre.x) * this.scale + viewport.width / 2,
      y: -(point.y - this.centre.y) * this.scale + viewport.height / 2,
    }
  }

  toBoard(point: { x: number; y: number }, viewport: Viewport): { x: number; y: number } {
    return {
      x: (point.x - viewport.width / 2) / this.scale + this.centre.x,
      y: -(point.y - viewport.height / 2) / this.scale + this.centre.y,
    }
  }

  /** Pans by a screen-pixel delta, as a drag does. */
  panByPixels(dx: number, dy: number): void {
    this.centre.x -= dx / this.scale
    this.centre.y += dy / this.scale
    this.clamp()
  }

  /**
   * Zooms about a screen point, so the board stays put under the pointer.
   *
   * `CameraController` zooms about the screen centre, which makes pinching
   * toward a corner feel like the board slides away. Anchoring to the pointer
   * is the behaviour every map interface has.
   */
  zoomAt(factor: number, screenPoint: { x: number; y: number }, viewport: Viewport): void {
    const before = this.toBoard(screenPoint, viewport)
    this.scale = clamp(this.scale * factor, this.limits.minScale, this.limits.maxScale)
    const after = this.toBoard(screenPoint, viewport)

    this.centre.x += before.x - after.x
    this.centre.y += before.y - after.y
    this.clamp()
  }

  /** Frames a board-space box, as opening a quest does. */
  frame(box: { x: number; y: number; width: number; height: number }, viewport: Viewport): void {
    this.centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    if (box.width > 0 && box.height > 0) {
      const fit = Math.min(viewport.width / box.width, viewport.height / box.height)
      // A margin, so the outermost tiles are not flush with the edge.
      this.scale = clamp(fit * 0.9, this.limits.minScale, this.limits.maxScale)
    }
    this.clamp()
  }

  /**
   * `CameraController.SetCamera`: centre on a point and reset the zoom.
   *
   * The reset is the part that matters. A scenario says "look here" and knows
   * what will be in shot, however far the player had zoomed out — so this is
   * not a pan, and a caller wanting one should set `centre` directly.
   */
  lookAt(point: { x: number; y: number }, viewport: Viewport): void {
    this.centre = { x: point.x, y: point.y }
    if (viewport.height > 0) {
      this.scale = clamp(
        viewport.height / STANDARD_VIEW_SQUARES,
        this.limits.minScale,
        this.limits.maxScale,
      )
    }
    this.clamp()
  }

  /**
   * `SetCameraMin` / `SetCameraMax`: how far the player may pan.
   *
   * Rounded, as the C# rounds them, and applied to where the camera already
   * is — a limit that excludes the current position moves it.
   */
  limitTo(edge: 'min' | 'max', point: { x: number; y: number }): void {
    if (edge === 'min') {
      this.limits.minX = Math.round(point.x)
      this.limits.minY = Math.round(point.y)
    } else {
      this.limits.maxX = Math.round(point.x)
      this.limits.maxY = Math.round(point.y)
    }
    this.clamp()
  }

  private clamp(): void {
    this.centre.x = clamp(this.centre.x, this.limits.minX, this.limits.maxX)
    this.centre.y = clamp(this.centre.y, this.limits.minY, this.limits.maxY)
  }
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high)
}
