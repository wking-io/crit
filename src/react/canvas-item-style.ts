import type { CSSProperties } from "react"

import type { CanvasGeometry } from "../core/index.js"

export const canvasItemStyle = (
  geometry: CanvasGeometry,
  zIndex: number
): CSSProperties => ({
  height: geometry.height,
  left: geometry.x,
  position: "absolute",
  top: geometry.y,
  width: geometry.width,
  zIndex
})
