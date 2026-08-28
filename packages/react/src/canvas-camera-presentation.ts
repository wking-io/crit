import type { CSSProperties } from "react"

import type { CanvasCamera } from "./canvas-camera.js"

export const canvasPlaneTransform = (camera: CanvasCamera): string =>
  `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`

export const canvasCameraStyle = (camera: CanvasCamera): CSSProperties => ({
  position: "relative",
  transform: canvasPlaneTransform(camera),
  transformOrigin: "0 0"
})

export const applyCanvasPlaneCamera = (
  plane: { style: { transform: string; transformOrigin: string } },
  camera: CanvasCamera
): void => {
  plane.style.transform = canvasPlaneTransform(camera)
  plane.style.transformOrigin = "0 0"
}

export const canvasCameraSnapshotKind = (
  previous: CanvasCamera,
  next: CanvasCamera
): "none" | "zoom" => previous.zoom === next.zoom ? "none" : "zoom"

export const camerasEqual = (
  left: CanvasCamera,
  right: CanvasCamera
): boolean =>
  left.x === right.x && left.y === right.y && left.zoom === right.zoom
