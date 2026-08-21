import { Schema } from "effect"

import type { CanvasCamera } from "./canvas-camera.js"

export interface CanvasCameraStorage {
  readonly getItem: (key: string) => string | null
  readonly removeItem: (key: string) => void
  readonly setItem: (key: string, value: string) => void
}

const cameraStorageKey = (canvasId: string) =>
  `@riff-refine/crit/camera/${encodeURIComponent(canvasId)}`
const cameraPersistencePreferenceKey = (canvasId: string) =>
  `@riff-refine/crit/camera-preference/${encodeURIComponent(canvasId)}`

const PersistedCanvasCamera = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  camera: Schema.Struct({
    x: Schema.Finite,
    y: Schema.Finite,
    zoom: Schema.Finite.check(Schema.isGreaterThan(0))
  })
})
const decodePersistedCanvasCamera = Schema.decodeUnknownSync(
  PersistedCanvasCamera
)
const isPersistableCanvasCamera = Schema.is(PersistedCanvasCamera.fields.camera)
const CanvasCameraPersistencePreference = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  enabled: Schema.Boolean
})
const decodeCanvasCameraPersistencePreference = Schema.decodeUnknownSync(
  CanvasCameraPersistencePreference
)

export const browserCanvasCameraStorage = (): CanvasCameraStorage | null => {
  try {
    return globalThis.document?.defaultView?.localStorage ?? null
  } catch {
    return null
  }
}

export const readPersistedCanvasCamera = (
  storage: CanvasCameraStorage,
  canvasId: string
): CanvasCamera | null => {
  try {
    const source = storage.getItem(cameraStorageKey(canvasId))
    if (source === null) return null
    return decodePersistedCanvasCamera(JSON.parse(source)).camera
  } catch {
    return null
  }
}

export const readCanvasCameraPersistenceEnabled = (
  storage: CanvasCameraStorage,
  canvasId: string
) => {
  try {
    const source = storage.getItem(cameraPersistencePreferenceKey(canvasId))
    if (source === null) return true
    return decodeCanvasCameraPersistencePreference(JSON.parse(source)).enabled
  } catch {
    return true
  }
}

export const writeCanvasCameraPersistenceEnabled = (
  storage: CanvasCameraStorage,
  canvasId: string,
  enabled: boolean
) => {
  try {
    storage.setItem(cameraPersistencePreferenceKey(canvasId), JSON.stringify({
      schemaVersion: 1,
      enabled
    }))
    return true
  } catch {
    return false
  }
}

export const writePersistedCanvasCamera = (
  storage: CanvasCameraStorage,
  canvasId: string,
  camera: CanvasCamera
) => {
  if (!isPersistableCanvasCamera(camera)) return false
  try {
    storage.setItem(cameraStorageKey(canvasId), JSON.stringify({
      schemaVersion: 1,
      camera
    }))
    return true
  } catch {
    return false
  }
}

export const clearPersistedCanvasCamera = (
  storage: CanvasCameraStorage,
  canvasId: string
) => {
  try {
    storage.removeItem(cameraStorageKey(canvasId))
    return true
  } catch {
    return false
  }
}
