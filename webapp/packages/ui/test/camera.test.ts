/**
 * Tests for the board camera's scenario-driven half.
 *
 * A quest aims the camera: `CameraController.SetCamera` centres on a point and
 * resets the zoom, and `SetCameraMin`/`SetCameraMax` bound how far the player
 * may pan from there. The reset is what a scenario relies on — it says "look
 * here" knowing what will be in shot.
 */

import { describe, expect, it } from 'vitest'

import { BoardCamera, DEFAULT_LIMITS, STANDARD_VIEW_SQUARES } from '../src/camera.js'

describe('lookAt', () => {
  // `CameraController.SetCamera` puts the camera at z = -8 and the scene's
  // camera has a 60-degree field of view, so ~9.24 squares are in shot.
  const VIEW = { width: 1000, height: 924 }

  it('centres on the point', () => {
    const camera = new BoardCamera()

    camera.lookAt({ x: 4, y: -3 }, VIEW)

    expect(camera.centre).toEqual({ x: 4, y: -3 })
  })

  it('resets the zoom, however far the player had gone', () => {
    // The reset is the point: a scenario says "look here" knowing what will be
    // in shot, so a player zoomed right out still sees what it meant them to.
    const camera = new BoardCamera()
    camera.scale = 12

    camera.lookAt({ x: 0, y: 0 }, VIEW)

    expect(camera.scale).toBeCloseTo(VIEW.height / STANDARD_VIEW_SQUARES, 4)
    expect(Math.round(STANDARD_VIEW_SQUARES)).toBe(9)
  })

  it('leaves the zoom alone when there is nothing to measure against', () => {
    const camera = new BoardCamera()

    camera.lookAt({ x: 1, y: 1 }, { width: 0, height: 0 })

    expect(camera.scale).toBe(40)
  })
})

describe('limitTo', () => {
  it('rounds the bound, as the C# rounds it', () => {
    const camera = new BoardCamera({ ...DEFAULT_LIMITS })
    camera.centre = { x: 0, y: 0 }

    camera.limitTo('min', { x: 2.4, y: 2.6 })

    // Rounded to 2 and 3, and the camera is dragged inside them.
    expect(camera.centre).toEqual({ x: 2, y: 3 })
  })

  it('does not write through to the shared defaults', () => {
    const before = DEFAULT_LIMITS.minX
    new BoardCamera().limitTo('min', { x: 99, y: 99 })

    expect(DEFAULT_LIMITS.minX).toBe(before)
  })

  it('keeps the player inside both bounds', () => {
    const camera = new BoardCamera()
    camera.limitTo('min', { x: -5, y: -5 })
    camera.limitTo('max', { x: 5, y: 5 })

    camera.centre = { x: 100, y: -100 }
    camera.limitTo('max', { x: 5, y: 5 })

    expect(camera.centre.x).toBe(5)
  })
})
