import type { FrameInputIntent } from "@crit/protocol"
import { Match, Schema } from "effect"

export { canvasCameraStyle } from "./canvas-camera-presentation.js"

const CanvasCameraCoordinate = Schema.Number.check(Schema.isFinite()).pipe(
  Schema.brand("CanvasCameraCoordinate")
)

const CanvasCameraZoom = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThan(0)
).pipe(Schema.brand("CanvasCameraZoom"))

const CanvasCameraValue = Schema.Struct({
  x: CanvasCameraCoordinate,
  y: CanvasCameraCoordinate,
  zoom: CanvasCameraZoom
})

export type CanvasCamera = typeof CanvasCameraValue.Type

export const CanvasCamera = {
  make: Schema.decodeUnknownSync(CanvasCameraValue),
  schema: CanvasCameraValue
}

const MIN_ZOOM = 0.05
const MAX_ZOOM = 8
const PAN_SPEED = 1
const ZOOM_SPEED = 1
const ZOOM_STEPS = [0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8]

type CanvasCameraBox = {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

const clampInclusive = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

const clampZoom = (zoom: number): number =>
  clampInclusive(zoom, MIN_ZOOM, MAX_ZOOM)

const cameraAtPoint = (
  camera: CanvasCamera,
  nextZoom: number,
  point: { readonly x: number; readonly y: number }
): CanvasCamera => {
  const worldX = (point.x - camera.x) / camera.zoom
  const worldY = (point.y - camera.y) / camera.zoom
  return CanvasCamera.make({
    zoom: nextZoom,
    x: point.x - worldX * nextZoom,
    y: point.y - worldY * nextZoom
  })
}

const zoomStep = (
  zoom: number,
  direction: -1 | 1,
  steps: ReadonlyArray<number>
): number => {
  if (direction === 1) {
    for (let index = 1; index < steps.length; index += 1) {
      const previous = steps[index - 1]!
      const next = steps[index]!
      if (next - zoom <= (next - previous) / 2) continue
      return next
    }
    return steps[steps.length - 1]!
  }
  for (let index = steps.length - 1; index > 0; index -= 1) {
    const previous = steps[index - 1]!
    const next = steps[index]!
    if (next - zoom >= (next - previous) / 2) continue
    return previous
  }
  return steps[0]!
}

const applyWheel = (
  camera: CanvasCamera,
  intent: Extract<FrameInputIntent, { readonly type: "wheel" }>,
  origin: CanvasCameraBox
): CanvasCamera => {
  const deltaX = Number.isFinite(intent.deltaX) ? intent.deltaX : 0
  const deltaY = Number.isFinite(intent.deltaY) ? intent.deltaY : 0
  if (intent.ctrlKey || intent.metaKey) {
    const normalizedDelta = -clampInclusive(deltaY, -10, 10) / 100
    const nextZoom = clampZoom(
      camera.zoom + normalizedDelta * camera.zoom * ZOOM_SPEED
    )
    return cameraAtPoint(camera, nextZoom, {
      x: intent.clientX - origin.left,
      y: intent.clientY - origin.top
    })
  }
  return CanvasCamera.make({
    x: camera.x - deltaX * PAN_SPEED,
    y: camera.y - deltaY * PAN_SPEED,
    zoom: camera.zoom
  })
}

const applyPinch = (
  camera: CanvasCamera,
  intent: Extract<FrameInputIntent, { readonly type: "pinch" }>,
  origin: CanvasCameraBox
): CanvasCamera => {
  if (!Number.isFinite(intent.scaleFactor) || intent.scaleFactor <= 0) {
    return camera
  }
  const nextZoom = clampZoom(camera.zoom * intent.scaleFactor ** ZOOM_SPEED)
  const anchored = cameraAtPoint(camera, nextZoom, {
    x: intent.clientX - origin.left,
    y: intent.clientY - origin.top
  })
  const zoomRatio = nextZoom / camera.zoom
  return CanvasCamera.make({
    x: anchored.x + intent.deltaX * zoomRatio,
    y: anchored.y + intent.deltaY * zoomRatio,
    zoom: nextZoom
  })
}

const applyZoomStep = (
  camera: CanvasCamera,
  intent: Extract<FrameInputIntent, { readonly type: "zoom-step" }>,
  origin: CanvasCameraBox
): CanvasCamera => {
  if (origin.width <= 0 || origin.height <= 0) return camera
  return cameraAtPoint(
    camera,
    zoomStep(camera.zoom, intent.direction, ZOOM_STEPS),
    { x: origin.width / 2, y: origin.height / 2 }
  )
}

type CameraFitBox = {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export const fitCameraToBox = (
  box: CameraFitBox,
  viewport: { readonly width: number; readonly height: number }
): CanvasCamera => {
  if (viewport.width <= 0 || viewport.height <= 0) {
    return CanvasCamera.make({ x: 0, y: 0, zoom: 1 })
  }
  const widthZoom = box.width <= 0 ? MAX_ZOOM : viewport.width / box.width
  const heightZoom = box.height <= 0 ? MAX_ZOOM : viewport.height / box.height
  const zoom = clampZoom(Math.min(widthZoom, heightZoom))
  return CanvasCamera.make({
    zoom,
    x: (viewport.width - box.width * zoom) / 2 - box.x * zoom,
    y: (viewport.height - box.height * zoom) / 2 - box.y * zoom
  })
}

export const fitCameraToFrames = (
  geometries: ReadonlyArray<CameraFitBox>,
  viewport: { readonly width: number; readonly height: number }
): CanvasCamera => {
  if (geometries.length === 0 || viewport.width <= 0 || viewport.height <= 0) {
    return CanvasCamera.make({ x: 0, y: 0, zoom: 1 })
  }
  const left = Math.min(...geometries.map((geometry) => geometry.x))
  const top = Math.min(...geometries.map((geometry) => geometry.y))
  const right = Math.max(
    ...geometries.map((geometry) => geometry.x + geometry.width)
  )
  const bottom = Math.max(
    ...geometries.map((geometry) => geometry.y + geometry.height)
  )
  const nextZoom = clampZoom(
    Math.min(
      1,
      (viewport.width - 80) / Math.max(1, right - left),
      (viewport.height - 80) / Math.max(1, bottom - top)
    )
  )
  return CanvasCamera.make({
    zoom: nextZoom,
    x: (viewport.width - (right - left) * nextZoom) / 2 - left * nextZoom,
    y: (viewport.height - (bottom - top) * nextZoom) / 2 - top * nextZoom
  })
}

export const applyCanvasCameraIntent = (
  camera: CanvasCamera,
  intent: FrameInputIntent,
  origin: CanvasCameraBox
): CanvasCamera =>
  Match.value(intent).pipe(
    Match.discriminatorsExhaustive("type")({
      wheel: (wheelIntent) => applyWheel(camera, wheelIntent, origin),
      pinch: (pinchIntent) => applyPinch(camera, pinchIntent, origin),
      select: () => camera,
      delete: () => camera,
      "clear-selection": () => camera,
      tool: () => camera,
      "zoom-step": (zoomIntent) => applyZoomStep(camera, zoomIntent, origin)
    })
  )
