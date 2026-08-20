import { describe, expect, it } from "vitest"

import {
  initialCanvasCameraState,
  updateCanvasCamera,
  type CanvasCamera
} from "../../src/react/canvas-camera.js"
import {
  applyCanvasPlaneCamera,
  canvasCameraSnapshotKind,
  canvasPlaneTransform
} from "../../src/react/canvas-camera-session.js"
import {
  frameIframeOccupancy,
  frameIntersectsViewport,
  readPauseOffscreenFrames,
  writePauseOffscreenFrames,
  type FrameIframeOccupancy
} from "../../src/react/canvas-frame-occupancy.js"
import type { CanvasGeometry } from "../../src/core/index.js"

const viewport = { width: 1200, height: 800 }
const onscreenFrame: CanvasGeometry = {
  x: 0,
  y: 0,
  width: 1200,
  height: 800
}
const farFrame: CanvasGeometry = {
  x: 12_000,
  y: 0,
  width: 1200,
  height: 800
}

const unmountOccupancy = (
  intersecting: boolean,
  _previouslyMounted: boolean
): FrameIframeOccupancy => ({
  mounted: intersecting,
  painted: intersecting
})

const occupancyRemounts = (
  sequence: ReadonlyArray<boolean>,
  occupancy: (
    intersecting: boolean,
    previouslyMounted: boolean
  ) => FrameIframeOccupancy
) => {
  let mounted = false
  let remounts = 0
  for (const intersecting of sequence) {
    const next = occupancy(intersecting, mounted)
    if (next.mounted && !mounted) remounts += 1
    mounted = next.mounted
  }
  return remounts
}

const panGesture = (options: {
  readonly occupancy: (
    intersecting: boolean,
    previouslyMounted: boolean
  ) => FrameIframeOccupancy
  readonly snapshot: (previous: CanvasCamera, next: CanvasCamera) => "none" | "zoom"
  readonly ticks?: number
}) => {
  const frames = [
    onscreenFrame,
    { ...onscreenFrame, x: 1240 },
    { ...onscreenFrame, x: 2480 },
    farFrame
  ]
  const plane = { style: { transform: "" } }
  let state = initialCanvasCameraState({ x: 40, y: 40, zoom: 0.65 })
  const mounted = frames.map(() => false)
  let snapshots = 0
  let remounts = 0
  let paintedTicks = 0
  const ticks = options.ticks ?? 240
  for (let tick = 0; tick < ticks; tick += 1) {
    const previous = state.camera
    state = updateCanvasCamera(state, {
      type: "pan",
      deltaX: tick < ticks / 2 ? -32 : 32,
      deltaY: tick < ticks / 2 ? 8 : -8
    })
    applyCanvasPlaneCamera(plane, state.camera)
    if (options.snapshot(previous, state.camera) !== "none") snapshots += 1
    for (let index = 0; index < frames.length; index += 1) {
      const intersecting = frameIntersectsViewport(
        frames[index]!,
        state.camera,
        viewport.width,
        viewport.height
      )
      const next = options.occupancy(intersecting, mounted[index]!)
      if (next.mounted && !mounted[index]) remounts += 1
      if (next.painted) paintedTicks += 1
      mounted[index] = next.mounted
    }
  }
  return {
    mounted: mounted.filter(Boolean).length,
    paintedTicks,
    remounts,
    snapshots,
    transform: plane.style.transform
  }
}

describe("Frame iframe occupancy", () => {
  it("keeps an unseen Frame unmounted until it enters the viewport", () => {
    const camera = initialCanvasCameraState().camera
    expect(frameIntersectsViewport(
      onscreenFrame,
      camera,
      0,
      0
    )).toBe(true)
    expect(frameIntersectsViewport(
      farFrame,
      camera,
      viewport.width,
      viewport.height
    )).toBe(false)
    expect(frameIframeOccupancy(false, false)).toEqual({
      mounted: false,
      painted: false
    })
  })

  it("does not remount a Frame that leaves and re-enters the viewport", () => {
    const reentries = [true, false, true, false, true]
    expect(occupancyRemounts(reentries, unmountOccupancy)).toBe(3)
    expect(occupancyRemounts(reentries, frameIframeOccupancy)).toBe(1)
    expect(frameIframeOccupancy(false, true)).toEqual({
      mounted: true,
      painted: false
    })
    expect(frameIframeOccupancy(false, true, false)).toEqual({
      mounted: true,
      painted: true
    })
    expect(frameIframeOccupancy(false, false, false)).toEqual({
      mounted: false,
      painted: false
    })
  })

  it("persists the offscreen pause preference", () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) }
    }

    expect(readPauseOffscreenFrames(null)).toBe(true)
    expect(readPauseOffscreenFrames(storage)).toBe(true)
    expect(writePauseOffscreenFrames(storage, false)).toBe(true)
    expect(readPauseOffscreenFrames(storage)).toBe(false)
    expect(writePauseOffscreenFrames(storage, true)).toBe(true)
    expect(readPauseOffscreenFrames(storage)).toBe(true)
  })
})

describe("Canvas camera presentation", () => {
  it("writes pan to the plane transform without a React snapshot", () => {
    const plane = { style: { transform: "" } }
    const start = initialCanvasCameraState({ x: 40, y: 40, zoom: 0.65 }).camera
    const panned = updateCanvasCamera(
      { camera: start },
      { type: "pan", deltaX: 120, deltaY: -30 }
    ).camera

    applyCanvasPlaneCamera(plane, panned)

    expect(canvasCameraSnapshotKind(start, panned)).toBe("none")
    expect(plane.style.transform).toBe(canvasPlaneTransform(panned))
    expect(plane.style.transform).toBe("translate(160px, 10px) scale(0.65)")
  })

  it("publishes a snapshot only when zoom changes chrome layout", () => {
    const start = initialCanvasCameraState({ x: 40, y: 40, zoom: 0.65 }).camera
    const zoomed = updateCanvasCamera({ camera: start }, {
      type: "zoom-to",
      zoom: 1,
      viewport
    }).camera

    expect(canvasCameraSnapshotKind(start, zoomed)).toBe("zoom")
  })
})

describe("Canvas pan and occupancy benchmarks", () => {
  it("eliminates remount flicker and per-tick snapshots on a 240-event pan", () => {
    const baseline = panGesture({
      occupancy: unmountOccupancy,
      snapshot: () => "zoom"
    })
    const improved = panGesture({
      occupancy: frameIframeOccupancy,
      snapshot: canvasCameraSnapshotKind
    })

    expect(baseline).toMatchObject({
      mounted: 3,
      paintedTicks: 399,
      remounts: 6,
      snapshots: 240
    })
    expect(improved).toMatchObject({
      mounted: 3,
      paintedTicks: 399,
      remounts: 3,
      snapshots: 0
    })
    expect(improved.transform).toBe(baseline.transform)
  })
})
