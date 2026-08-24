import type { FrameInputIntent } from "@crit/protocol"
import { Match, Schema } from "effect"
import type { CSSProperties } from "react"

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

export const canvasCameraStyle = (camera: CanvasCamera): CSSProperties => ({
  position: "relative",
  transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
  transformOrigin: "0 0"
})

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
      tool: () => camera,
      "zoom-step": (zoomIntent) => applyZoomStep(camera, zoomIntent, origin)
    })
  )
