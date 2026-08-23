import type { CanvasId } from "@crit/domain"

import {
  clearSessionPreference,
  readSessionPreference,
  sessionPreferenceKey,
  writeSessionPreference,
  type BrowserSessionStorage
} from "./browser-session.js"
import { CanvasCamera } from "./canvas-camera.js"

const cameraKey = (canvasId: CanvasId) =>
  sessionPreferenceKey({ canvasId, name: "camera" })

export const readCanvasCameraSession = (args: {
  readonly storage: BrowserSessionStorage
  readonly canvasId: CanvasId
}): ReturnType<typeof CanvasCamera.make> | undefined =>
  readSessionPreference({
    key: cameraKey(args.canvasId),
    schema: CanvasCamera.schema,
    storage: args.storage
  })

export const writeCanvasCameraSession = (args: {
  readonly storage: BrowserSessionStorage
  readonly canvasId: CanvasId
  readonly camera: CanvasCamera
}): boolean =>
  writeSessionPreference({
    key: cameraKey(args.canvasId),
    schema: CanvasCamera.schema,
    storage: args.storage,
    value: args.camera
  })

export const clearCanvasCameraSession = (args: {
  readonly storage: BrowserSessionStorage
  readonly canvasId: CanvasId
}): boolean =>
  clearSessionPreference({
    key: cameraKey(args.canvasId),
    storage: args.storage
  })
