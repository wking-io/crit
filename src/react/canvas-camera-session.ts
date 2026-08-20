import type { CanvasCamera } from "./canvas-camera.js"

export const canvasPlaneTransform = (camera: CanvasCamera) =>
  `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`

export const applyCanvasPlaneCamera = (
  plane: { style: { transform: string } },
  camera: CanvasCamera
) => {
  plane.style.transform = canvasPlaneTransform(camera)
}

export const canvasCameraSnapshotKind = (
  previous: CanvasCamera,
  next: CanvasCamera
) => previous.zoom === next.zoom ? "none" : "zoom"
