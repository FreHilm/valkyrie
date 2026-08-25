/**
 * @vitest-environment happy-dom
 *
 * Tests for the camera and board renderer (T-017).
 *
 * `CameraController.cs` has no tests — it is a MonoBehaviour driven by
 * FixedUpdate. What is pinned here is the transform, the clamping, and the
 * input behaviour the Unity board does not have at all: keyboard panning and
 * hit testing that respects rotation.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BoardCamera, DEFAULT_LIMITS } from '../src/camera.js'
import { Layer, board } from '../src/board.js'
import type { BoardItem } from '../src/board.js'

const view = { width: 800, height: 600 }

describe('BoardCamera', () => {
  let camera: BoardCamera

  beforeEach(() => {
    camera = new BoardCamera()
    camera.scale = 40
  })

  it('puts the camera centre at the middle of the view', () => {
    expect(camera.toScreen({ x: 0, y: 0 }, view)).toEqual({ x: 400, y: 300 })
  })

  // Board space has Y up, the screen has Y down. This is the only place that
  // inversion lives.
  it('flips the vertical axis', () => {
    expect(camera.toScreen({ x: 0, y: 1 }, view)).toEqual({ x: 400, y: 260 })
  })

  it('round-trips a point through both transforms', () => {
    const point = { x: 3.25, y: -7.5 }
    const back = camera.toBoard(camera.toScreen(point, view), view)

    expect(back.x).toBeCloseTo(point.x, 10)
    expect(back.y).toBeCloseTo(point.y, 10)
  })

  it('pans opposite the drag, so the board follows the pointer', () => {
    camera.panByPixels(40, 0)

    expect(camera.centre.x).toBe(-1)
  })

  it('clamps panning to the limits CameraController uses', () => {
    camera.panByPixels(-40 * 1000, 0)

    expect(camera.centre.x).toBe(DEFAULT_LIMITS.maxX)
  })

  it('clamps zoom at both ends', () => {
    camera.zoomAt(1000, { x: 400, y: 300 }, view)
    expect(camera.scale).toBe(DEFAULT_LIMITS.maxScale)

    camera.zoomAt(0.0001, { x: 400, y: 300 }, view)
    expect(camera.scale).toBe(DEFAULT_LIMITS.minScale)
  })

  /**
   * Zooming anchors to the pointer, so the board does not slide away when
   * pinching toward a corner. `CameraController` zooms about the screen
   * centre, which is the behaviour this deliberately departs from.
   */
  it('keeps the board still under the zoom point', () => {
    const screen = { x: 700, y: 100 }
    const before = camera.toBoard(screen, view)

    camera.zoomAt(1.5, screen, view)
    const after = camera.toBoard(screen, view)

    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
  })

  it('frames a box in the middle of the view', () => {
    camera.frame({ x: -10, y: -10, width: 20, height: 20 }, view)

    expect(camera.centre).toEqual({ x: 0, y: 0 })
    expect(camera.scale).toBeLessThanOrEqual(600 / 20)
  })

  it('ignores an empty box rather than dividing by zero', () => {
    camera.frame({ x: 5, y: 5, width: 0, height: 0 }, view)

    expect(Number.isFinite(camera.scale)).toBe(true)
  })
})

describe('board', () => {
  const item = (id: string, layer: Layer, x: number, y: number): BoardItem => ({
    id,
    layer,
    placed: { centre: { x, y }, width: 2, height: 2, rotation: 0 },
    image: null,
    tint: '#fff',
  })

  beforeEach(() => {
    document.body.replaceChildren()
    // happy-dom has no rAF budget concerns; run callbacks immediately.
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
      fn(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        disconnect(): void {}
      },
    )
  })

  it('is a labelled application region, so it is not anonymous to a reader', () => {
    const b = board({ label: 'Quest board' })

    expect(b.element.getAttribute('role')).toBe('application')
    expect(b.element.getAttribute('aria-label')).toBe('Quest board')
    expect(b.element.getAttribute('tabindex')).toBe('0')
    b.destroy()
  })

  it('finds the item under a screen point', () => {
    const b = board({ label: 'Board' })
    b.element.width = 800
    b.element.height = 600
    b.camera.scale = 40
    b.setItems([item('a', Layer.TILE, 0, 0)])

    expect(b.itemAt({ x: 400, y: 300 })?.id).toBe('a')
    expect(b.itemAt({ x: 10, y: 10 })).toBeNull()
    b.destroy()
  })

  // Layers encode the z-order the three Unity canvases had, so a monster
  // standing on a tile must win the hit test.
  it('picks the topmost item when they overlap', () => {
    const b = board({ label: 'Board' })
    b.element.width = 800
    b.element.height = 600
    b.camera.scale = 40
    b.setItems([item('tile', Layer.TILE, 0, 0), item('monster', Layer.MONSTER, 0, 0)])

    expect(b.itemAt({ x: 400, y: 300 })?.id).toBe('monster')
    b.destroy()
  })

  it('does not hit-test a disabled item', () => {
    const b = board({ label: 'Board' })
    b.element.width = 800
    b.element.height = 600
    b.camera.scale = 40
    b.setItems([{ ...item('a', Layer.TILE, 0, 0), disabled: true }])

    expect(b.itemAt({ x: 400, y: 300 })).toBeNull()
    b.destroy()
  })

  it('frames everything on the board', () => {
    const b = board({ label: 'Board' })
    b.element.width = 800
    b.element.height = 600
    b.setItems([item('a', Layer.TILE, -10, 0), item('b', Layer.TILE, 10, 0)])

    b.frameAll()

    expect(b.camera.centre.x).toBeCloseTo(0, 10)
    b.destroy()
  })

  it('survives framing an empty board', () => {
    const b = board({ label: 'Board' })
    expect(() => b.frameAll()).not.toThrow()
    b.destroy()
  })

  // The Unity board cannot be operated without a pointer at all.
  it('pans with the arrow keys', () => {
    const b = board({ label: 'Board' })
    b.element.width = 800
    b.element.height = 600
    b.camera.scale = 40
    const before = b.camera.centre.x

    b.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))

    expect(b.camera.centre.x).toBeGreaterThan(before)
    b.destroy()
  })

  it('zooms with the plus and minus keys', () => {
    const b = board({ label: 'Board' })
    b.element.width = 800
    b.element.height = 600
    b.camera.scale = 40

    b.element.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }))
    expect(b.camera.scale).toBeGreaterThan(40)

    b.element.dispatchEvent(new KeyboardEvent('keydown', { key: '-', bubbles: true }))
    expect(b.camera.scale).toBeLessThan(48)
    b.destroy()
  })

  it('stops observing and listening when destroyed', () => {
    const b = board({ label: 'Board' })
    b.destroy()
    b.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))

    expect(b.camera.centre.x).toBe(0)
  })
})
