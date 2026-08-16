import type { CanvasGeometry } from "../core/index.js"

import type { CanvasArrangementItem } from "./canvas-arrangement.js"
import { frameContentProjection } from "./frame-card.js"

export const canvasArrangementFootprint = ({
  id,
  geometry,
  kind,
  zoom
}: {
  readonly id: string
  readonly geometry: CanvasGeometry
  readonly kind: "frame" | "note"
  readonly zoom: number
}): CanvasArrangementItem => ({
  id,
  ...geometry,
  height: kind === "frame"
    ? frameContentProjection(geometry.width, geometry.height, zoom).shellHeight
    : geometry.height
})
