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
import { LAYER_ORDER, Layer, board, resolveColour } from '../src/board.js'
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

describe('resolveColour', () => {
  // A canvas `fillStyle` is not a stylesheet. Handed `var(--x, #fff)` it keeps
  // what it had — opaque black — and does not throw, so a tint written that
  // way drew a black square and read as nothing having been drawn at all.
  const canvas = () => document.createElement('canvas')

  it('leaves a plain colour alone', () => {
    expect(resolveColour(canvas(), '#b91c1c')).toBe('#b91c1c')
    expect(resolveColour(canvas(), 'red')).toBe('red')
  })

  it('falls back to the literal when the property is not set', () => {
    expect(resolveColour(canvas(), 'var(--not-defined-anywhere, #eab308)')).toBe('#eab308')
  })

  it('prefers the property when the page defines one', () => {
    const node = canvas()
    node.style.setProperty('--vk-highlight', '#123456')
    document.body.append(node)

    expect(resolveColour(node, 'var(--vk-highlight, #eab308)')).toBe('#123456')
    node.remove()
  })

  it('gives back nothing for a var with no fallback and no value', () => {
    // Which the canvas then ignores, leaving what it had — the same as before,
    // but now visibly a missing definition rather than a silent black square.
    expect(resolveColour(canvas(), 'var(--nothing-here)')).toBe('')
  })
})

describe('LAYER_ORDER', () => {
  it('covers every layer there is', () => {
    // The draw loop used to list its layers by hand, so `HIGHLIGHT` was added
    // to `Layer`, put in the scene, and silently never painted — the board
    // simply skipped it. Deriving the order is what stops that recurring.
    expect([...LAYER_ORDER].sort((a, b) => a - b)).toEqual(
      Object.values(Layer).sort((a, b) => a - b),
    )
  })

  it('paints back to front', () => {
    expect(LAYER_ORDER).toEqual([...LAYER_ORDER].sort((a, b) => a - b))
    expect(LAYER_ORDER[0]).toBe(Layer.TILE)
    expect(LAYER_ORDER[LAYER_ORDER.length - 1]).toBe(Layer.HIGHLIGHT)
  })
})

describe('board pieces', () => {
  // A canvas is a single focus stop with nothing inside it, so every door,
  // token and monster was unreachable without a pointer and silent to a
  // screen reader.
  const item = (id: string, over: Partial<BoardItem> = {}): BoardItem => ({
    id,
    layer: Layer.TOKEN,
    placed: { centre: { x: 0, y: 0 }, width: 1, height: 1, rotation: 0 },
    image: null,
    label: id,
    ...over,
  })

  const names = (view: { pieces: HTMLElement }) =>
    [...view.pieces.querySelectorAll('button')].map((b) => b.textContent)

  it('mirrors what is on the board into real buttons', () => {
    const view = board({ label: 'Board' })
    view.setItems([item('TokenDoor'), item('Cultist', { layer: Layer.MONSTER })])

    expect(names(view)).toEqual(['TokenDoor', 'Cultist'])
  })

  it('leaves the scenery out', () => {
    // Tabbing through twenty floor tiles to reach the door serves nobody.
    const view = board({ label: 'Board' })
    view.setItems([
      item('TileFoyer', { layer: Layer.TILE, interactive: false }),
      item('TokenDoor'),
    ])

    expect(names(view)).toEqual(['TokenDoor'])
  })

  it('selects the same item a click would', () => {
    const chosen: string[] = []
    const view = board({ label: 'Board', onSelect: (i) => chosen.push(i.id) })
    view.setItems([item('TokenDoor')])

    view.pieces.querySelector('button')?.click()
    expect(chosen).toEqual(['TokenDoor'])
  })

  it('keeps up with the board', () => {
    const view = board({ label: 'Board' })
    view.setItems([item('TokenDoor')])
    view.setItems([item('TokenDoor'), item('TokenChest')])

    expect(names(view)).toEqual(['TokenDoor', 'TokenChest'])
  })

  it('leaves out what cannot be pressed', () => {
    const view = board({ label: 'Board' })
    view.setItems([item('TokenDoor', { disabled: true }), item('TokenChest')])

    expect(names(view)).toEqual(['TokenChest'])
  })

  it('is announced as belonging to the board', () => {
    const view = board({ label: 'Quest board' })

    expect(view.pieces.getAttribute('aria-label')).toBe('Quest board: pieces')
    // Off screen, not hidden: `display: none` would take it out of the focus
    // order, which is the whole point of it.
    expect(view.pieces.classList.contains('vk-visually-hidden')).toBe(true)
  })
})

describe('board hit testing', () => {
  it('ignores scenery, as the C# does by putting tiles on their own canvas', () => {
    // A click on bare floor used to queue an event named after the tile and
    // log "Missing event called" for something nobody meant to touch.
    const view = board({ label: 'Board' })
    view.setItems([
      {
        id: 'TileFoyer',
        layer: Layer.TILE,
        placed: { centre: { x: 0, y: 0 }, width: 10, height: 10, rotation: 0 },
        image: null,
        label: 'TileFoyer',
        interactive: false,
      },
    ])

    expect(view.itemAt({ x: 0, y: 0 })).toBeNull()
  })
})
