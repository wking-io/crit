import { describe, expect, it } from "vitest"

import { CanvasCamera } from "../src/canvas-camera.js"
import {
  applyCanvasPlaneCamera,
  canvasCameraSnapshotKind,
  canvasPlaneTransform
} from "../src/canvas-camera-presentation.js"
import {
  frameIframeOccupancy,
  frameIntersectsViewport
} from "../src/canvas-frame-occupancy.js"

const viewport = { width: 1200, height: 800 }
const onscreenFrame = { x: 0, y: 0, width: 1200, height: 800 }
const farFrame = { x: 12_000, y: 0, width: 1200, height: 800 }

const unmountOccupancy = (
  intersecting: boolean,
  _previouslyMounted: boolean
) => ({
  mounted: intersecting,
  painted: intersecting
})

const occupancyRemounts = (
  sequence: ReadonlyArray<boolean>,
  occupancy: (
    intersecting: boolean,
    previouslyMounted: boolean
  ) => { readonly mounted: boolean; readonly painted: boolean }
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

describe("Frame iframe occupancy", () => {
  it("keeps an unseen Frame unmounted until it enters the viewport", () => {
    const camera = CanvasCamera.make({ x: 0, y: 0, zoom: 1 })
    expect(frameIntersectsViewport(onscreenFrame, camera, 0, 0)).toBe(true)
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
  })
})

describe("Canvas camera presentation", () => {
  it("writes pan to the plane transform without a React snapshot", () => {
    const plane = { style: { transform: "", transformOrigin: "" } }
    const start = CanvasCamera.make({ x: 40, y: 40, zoom: 0.65 })
    const panned = CanvasCamera.make({ x: 160, y: 10, zoom: 0.65 })

    applyCanvasPlaneCamera(plane, panned)

    expect(canvasCameraSnapshotKind(start, panned)).toBe("none")
    expect(plane.style.transform).toBe(canvasPlaneTransform(panned))
    expect(plane.style.transform).toBe("translate(160px, 10px) scale(0.65)")
  })

  it("publishes a snapshot only when zoom changes chrome layout", () => {
    const start = CanvasCamera.make({ x: 40, y: 40, zoom: 0.65 })
    const zoomed = CanvasCamera.make({ x: 40, y: 40, zoom: 1 })
    expect(canvasCameraSnapshotKind(start, zoomed)).toBe("zoom")
  })
})
