import type { CanvasId } from "@crit/domain"

import {
  getSessionPreference,
  removeSessionPreference,
  setSessionPreference
} from "./browser-session.js"
import { CanvasCamera } from "./canvas-camera.js"

export const getCanvasCameraSession = (args: {
  readonly canvasId: CanvasId
}) =>
  getSessionPreference({
    canvasId: args.canvasId,
    name: "camera",
    schema: CanvasCamera.schema
  })

export const setCanvasCameraSession = (args: {
  readonly canvasId: CanvasId
  readonly camera: ReturnType<typeof CanvasCamera.make>
}) =>
  setSessionPreference({
    canvasId: args.canvasId,
    name: "camera",
    schema: CanvasCamera.schema,
    value: args.camera
  })

export const removeCanvasCameraSession = (args: {
  readonly canvasId: CanvasId
}) =>
  removeSessionPreference({
    canvasId: args.canvasId,
    name: "camera"
  })
