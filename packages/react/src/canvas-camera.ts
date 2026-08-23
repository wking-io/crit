import { Schema } from "effect"
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
