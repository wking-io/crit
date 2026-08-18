import { describe, expect, it } from "vitest"

import {
  initialCanvasCameraState,
  updateCanvasCamera
} from "../../src/react/canvas-camera.js"

const wheel = {
  type: "wheel" as const,
  clientX: 110,
  clientY: 220,
  ctrlKey: false,
  metaKey: false,
  deltaX: 12,
  deltaY: -8,
  origin: { left: 10, top: 20 }
}

describe("canvas camera", () => {
  it("applies pan and normalized wheel zoom immediately", () => {
    const initial = initialCanvasCameraState({ x: 10, y: 20, zoom: 1 })
    const panned = updateCanvasCamera(initial, wheel)
    const zoomed = updateCanvasCamera(initial, {
      ...wheel,
      ctrlKey: true,
      deltaX: 0,
      deltaY: -100
    })

    expect(panned.camera).toEqual({ x: -2, y: 28, zoom: 1 })
    expect(zoomed.camera.zoom).toBeCloseTo(1.1)
    expect((100 - zoomed.camera.x) / zoomed.camera.zoom).toBeCloseTo(90)
    expect((200 - zoomed.camera.y) / zoomed.camera.zoom).toBeCloseTo(180)
  })

  it("supports configurable wheel behavior and input speeds", () => {
    const initial = initialCanvasCameraState({ x: 0, y: 0, zoom: 1 })
    const zoomed = updateCanvasCamera(initial, wheel, {
      wheelBehavior: "zoom",
      zoomSpeed: 2
    })
    const modifierPan = updateCanvasCamera(initial, {
      ...wheel,
      ctrlKey: true
    }, {
      wheelBehavior: "zoom",
      panSpeed: 0.5
    })
    const ignored = updateCanvasCamera(initial, wheel, {
      wheelBehavior: "none"
    })

    expect(zoomed.camera.zoom).toBeCloseTo(1.16)
    expect(modifierPan.camera).toEqual({ x: -6, y: 4, zoom: 1 })
    expect(ignored).toBe(initial)
  })

  it("pinches directly while keeping the moving centroid anchored", () => {
    const initial = initialCanvasCameraState({ x: 0, y: 0, zoom: 1 })
    const pinched = updateCanvasCamera(initial, {
      type: "pinch",
      scaleFactor: 2,
      point: { x: 110, y: 100 },
      deltaX: 10,
      deltaY: 0
    })

    expect(pinched.camera).toEqual({ x: -90, y: -100, zoom: 2 })
    expect(100 * pinched.camera.zoom + pinched.camera.x).toBe(110)
  })

  it("uses discrete shortcut steps and their endpoints as zoom bounds", () => {
    const initial = initialCanvasCameraState({ x: 40, y: 50, zoom: 0.65 })
    const viewport = { width: 1200, height: 800 }
    const zoomedIn = updateCanvasCamera(initial, {
      type: "zoom-step",
      direction: 1,
      viewport
    })
    const zoomedOut = updateCanvasCamera(initial, {
      type: "zoom-step",
      direction: -1,
      viewport
    })
    const bounded = updateCanvasCamera(
      initialCanvasCameraState({ x: 0, y: 0, zoom: 2 }),
      {
        type: "pinch",
        scaleFactor: 10,
        point: { x: 100, y: 100 },
        deltaX: 0,
        deltaY: 0
      },
      { zoomSteps: [0.5, 1, 2] }
    )

    expect(zoomedIn.camera.zoom).toBe(1)
    expect(zoomedOut.camera.zoom).toBe(0.25)
    expect(bounded.camera.zoom).toBe(2)
  })

  it("sets an exact debug zoom while keeping the viewport center anchored", () => {
    const initial = initialCanvasCameraState({ x: 40, y: 50, zoom: .65 })
    const viewport = { width: 1200, height: 800 }
    const zoomed = updateCanvasCamera(initial, {
      type: "zoom-to",
      zoom: .4,
      viewport
    })

    expect(zoomed.camera.zoom).toBe(.4)
    expect((600 - zoomed.camera.x) / zoomed.camera.zoom).toBeCloseTo(
      (600 - initial.camera.x) / initial.camera.zoom
    )
    expect((400 - zoomed.camera.y) / zoomed.camera.zoom).toBeCloseTo(
      (400 - initial.camera.y) / initial.camera.zoom
    )
  })

  it("fits geometry and sanitizes invalid camera options", () => {
    const fitted = updateCanvasCamera(initialCanvasCameraState(), {
      type: "fit",
      geometries: [
        { x: 100, y: 200, width: 400, height: 300 },
        { x: 700, y: 100, width: 200, height: 500 }
      ],
      viewport: { width: 1200, height: 800 }
    })
    const sanitized = updateCanvasCamera(
      initialCanvasCameraState({ x: 0, y: 0, zoom: 1 }),
      { ...wheel, ctrlKey: true },
      { zoomSpeed: Number.NaN, zoomSteps: [1, Number.NaN] }
    )

    expect(fitted.camera.zoom).toBeLessThanOrEqual(1)
    expect(fitted.camera.x).toBeGreaterThanOrEqual(-100)
    expect(sanitized.camera.zoom).toBeGreaterThan(1)
  })

  it("centers a geometry in the viewport at the current zoom", () => {
    const centered = updateCanvasCamera(
      initialCanvasCameraState({ x: 40, y: 40, zoom: 0.65 }),
      {
        type: "center",
        geometry: { x: 0, y: 0, width: 880, height: 560 },
        viewport: { width: 1280, height: 800 }
      }
    )

    expect(centered.camera).toEqual({
      zoom: 0.65,
      x: 640 - 440 * 0.65,
      y: 400 - 280 * 0.65
    })
  })
})
