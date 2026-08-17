import { describe, expect, it } from "vitest"

import {
  clearPersistedCanvasCamera,
  readPersistedCanvasCamera,
  writePersistedCanvasCamera,
  type CanvasCameraStorage
} from "../../src/react/canvas-camera-persistence.js"

const memoryStorage = (): CanvasCameraStorage & {
  readonly values: Map<string, string>
} => {
  const values = new Map<string, string>()
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, value) }
  }
}

describe("canvas camera persistence", () => {
  it("round-trips a finite camera per Canvas and clears the opt-in", () => {
    const storage = memoryStorage()
    const camera = { x: -320.5, y: 112, zoom: .65 }

    expect(writePersistedCanvasCamera(storage, "review/one", camera)).toBe(true)
    expect(readPersistedCanvasCamera(storage, "review/one")).toEqual(camera)
    expect(readPersistedCanvasCamera(storage, "review/two")).toBeNull()

    expect(clearPersistedCanvasCamera(storage, "review/one")).toBe(true)
    expect(readPersistedCanvasCamera(storage, "review/one")).toBeNull()
  })

  it("rejects malformed or unsafe values without throwing", () => {
    const storage = memoryStorage()
    storage.values.set("@riff-refine/crit/camera/review", JSON.stringify({
      schemaVersion: 1,
      camera: { x: 0, y: 0, zoom: 0 }
    }))

    expect(readPersistedCanvasCamera(storage, "review")).toBeNull()

    const unavailable: CanvasCameraStorage = {
      getItem: () => { throw new Error("blocked") },
      removeItem: () => { throw new Error("blocked") },
      setItem: () => { throw new Error("blocked") }
    }
    expect(readPersistedCanvasCamera(unavailable, "review")).toBeNull()
    expect(writePersistedCanvasCamera(
      unavailable,
      "review",
      { x: 0, y: 0, zoom: 1 }
    )).toBe(false)
    expect(clearPersistedCanvasCamera(unavailable, "review")).toBe(false)
  })
})
