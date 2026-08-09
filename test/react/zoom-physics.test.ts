import { describe, expect, it } from "vitest"

import {
  DEFAULT_ZOOM_PHYSICS_SETTINGS,
  MAXIMUM_CANVAS_ZOOM,
  clampZoomVelocity,
  pinchZoomImpulse,
  resolveZoomPhysicsSettings,
  shortcutZoomImpulse,
  stepZoomPhysics,
  wheelZoomImpulse
} from "../../src/react/zoom-physics.js"

describe("zoom physics", () => {
  it("continues zooming after an impulse while velocity decays", () => {
    const camera = { x: 10, y: 20, zoom: 1 }
    const point = { x: 410, y: 320 }
    const first = stepZoomPhysics(
      camera,
      DEFAULT_ZOOM_PHYSICS_SETTINGS.shortcutImpulse,
      16,
      point,
      DEFAULT_ZOOM_PHYSICS_SETTINGS
    )
    const second = stepZoomPhysics(
      first.camera,
      first.velocity,
      16,
      point,
      DEFAULT_ZOOM_PHYSICS_SETTINGS
    )

    expect(first.camera.zoom).toBeGreaterThan(camera.zoom)
    expect(second.camera.zoom).toBeGreaterThan(first.camera.zoom)
    expect(Math.abs(second.velocity)).toBeLessThan(Math.abs(first.velocity))
    expect((point.x - second.camera.x) / second.camera.zoom).toBeCloseTo(
      (point.x - camera.x) / camera.zoom
    )
    expect((point.y - second.camera.y) / second.camera.zoom).toBeCloseTo(
      (point.y - camera.y) / camera.zoom
    )
  })

  it("integrates exponential decay consistently across refresh rates", () => {
    const camera = { x: 0, y: 0, zoom: 0.65 }
    const point = { x: 500, y: 300 }
    const oneFrame = stepZoomPhysics(
      camera,
      2,
      40,
      point,
      DEFAULT_ZOOM_PHYSICS_SETTINGS
    )
    let manyFrames = { camera, velocity: 2 }
    for (let index = 0; index < 4; index += 1) {
      manyFrames = stepZoomPhysics(
        manyFrames.camera,
        manyFrames.velocity,
        10,
        point,
        DEFAULT_ZOOM_PHYSICS_SETTINGS
      )
    }

    expect(manyFrames.camera.zoom).toBeCloseTo(oneFrame.camera.zoom, 10)
    expect(manyFrames.velocity).toBeCloseTo(oneFrame.velocity, 10)
  })

  it("maps wheel, pinch, and shortcut input to bounded log-zoom impulses", () => {
    const settings = DEFAULT_ZOOM_PHYSICS_SETTINGS

    expect(wheelZoomImpulse(-100, settings)).toBeGreaterThan(0)
    expect(wheelZoomImpulse(100, settings)).toBeLessThan(0)
    expect(pinchZoomImpulse(1.1, settings)).toBeGreaterThan(0)
    expect(pinchZoomImpulse(0.9, settings)).toBeLessThan(0)
    expect(shortcutZoomImpulse(1, settings)).toBe(settings.shortcutImpulse)
    expect(clampZoomVelocity(100, settings)).toBe(settings.maximumSpeed)
  })

  it("stops cleanly at zoom boundaries and sanitizes public settings", () => {
    const settings = resolveZoomPhysicsSettings({
      decay: Number.NaN,
      maximumSpeed: -1,
      stopSpeed: 0.02
    })
    const result = stepZoomPhysics(
      { x: 0, y: 0, zoom: MAXIMUM_CANVAS_ZOOM },
      2,
      16,
      { x: 100, y: 100 },
      settings
    )

    expect(settings.decay).toBe(DEFAULT_ZOOM_PHYSICS_SETTINGS.decay)
    expect(settings.maximumSpeed).toBe(DEFAULT_ZOOM_PHYSICS_SETTINGS.maximumSpeed)
    expect(settings.stopSpeed).toBe(0.02)
    expect(result.camera.zoom).toBe(MAXIMUM_CANVAS_ZOOM)
    expect(result.velocity).toBe(0)
  })
})
