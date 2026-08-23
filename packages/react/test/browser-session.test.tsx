import { Id } from "@crit/domain"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import {
  CanvasCamera,
  browserSessionStorage,
  clearCanvasCameraSession,
  clearSessionPreference,
  readCanvasCameraSession,
  readSessionPreference,
  sessionPreferenceKey,
  writeCanvasCameraSession,
  writeSessionPreference,
  type BrowserSessionStorage
} from "../src/index.js"

const canvasA = Id.canvas("canvas_review")
const canvasB = Id.canvas("canvas_other")
const Label = Schema.String.check(Schema.isNonEmpty())

const memoryStorage = (): BrowserSessionStorage => {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => {
      values.delete(key)
    },
    setItem: (key, value) => {
      values.set(key, value)
    }
  }
}

describe("browser session preferences", () => {
  it("round-trips a value through one storage object", () => {
    const storage = memoryStorage()
    const key = sessionPreferenceKey({ canvasId: canvasA, name: "label" })
    expect(writeSessionPreference({
      key,
      schema: Label,
      storage,
      value: "pinned"
    })).toBe(true)
    expect(readSessionPreference({ key, schema: Label, storage })).toBe("pinned")
  })

  it("keeps two storage objects independent", () => {
    const first = memoryStorage()
    const second = memoryStorage()
    const key = sessionPreferenceKey({ canvasId: canvasA, name: "label" })
    expect(writeSessionPreference({
      key,
      schema: Label,
      storage: first,
      value: "tab-one"
    })).toBe(true)
    expect(writeSessionPreference({
      key,
      schema: Label,
      storage: second,
      value: "tab-two"
    })).toBe(true)
    expect(readSessionPreference({ key, schema: Label, storage: first })).toBe("tab-one")
    expect(readSessionPreference({ key, schema: Label, storage: second })).toBe("tab-two")
  })

  it("ignores missing, corrupt, and mismatched records", () => {
    const storage = memoryStorage()
    const key = sessionPreferenceKey({ canvasId: canvasA, name: "label" })
    expect(readSessionPreference({ key, schema: Label, storage })).toBeUndefined()
    storage.setItem(key, "{")
    expect(readSessionPreference({ key, schema: Label, storage })).toBeUndefined()
    storage.setItem(key, JSON.stringify({ schemaVersion: 1, value: 4 }))
    expect(readSessionPreference({ key, schema: Label, storage })).toBeUndefined()
  })

  it("clears one key without touching another canvas", () => {
    const storage = memoryStorage()
    const first = sessionPreferenceKey({ canvasId: canvasA, name: "label" })
    const second = sessionPreferenceKey({ canvasId: canvasB, name: "label" })
    writeSessionPreference({ key: first, schema: Label, storage, value: "a" })
    writeSessionPreference({ key: second, schema: Label, storage, value: "b" })
    expect(clearSessionPreference({ key: first, storage })).toBe(true)
    expect(readSessionPreference({ key: first, schema: Label, storage })).toBeUndefined()
    expect(readSessionPreference({ key: second, schema: Label, storage })).toBe("b")
  })

  it("returns false when storage rejects a write", () => {
    const storage: BrowserSessionStorage = {
      getItem: () => null,
      removeItem: () => undefined,
      setItem: () => {
        throw new Error("quota")
      }
    }
    expect(writeSessionPreference({
      key: sessionPreferenceKey({ canvasId: canvasA, name: "label" }),
      schema: Label,
      storage,
      value: "pinned"
    })).toBe(false)
  })
})

describe("canvas camera session", () => {
  it("restores a camera for one canvas after a reload of the same storage", () => {
    const storage = memoryStorage()
    const camera = CanvasCamera.make({ x: 12, y: -8, zoom: 0.5 })
    expect(writeCanvasCameraSession({ camera, canvasId: canvasA, storage })).toBe(true)
    expect(readCanvasCameraSession({ canvasId: canvasA, storage })).toEqual(camera)
    expect(readCanvasCameraSession({ canvasId: canvasB, storage })).toBeUndefined()
    expect(clearCanvasCameraSession({ canvasId: canvasA, storage })).toBe(true)
    expect(readCanvasCameraSession({ canvasId: canvasA, storage })).toBeUndefined()
  })

  it("uses the document sessionStorage when the host asks for the browser store", () => {
    const storage = browserSessionStorage()
    expect(storage).toBeDefined()
    if (storage === undefined) return
    const camera = CanvasCamera.make({ x: 40, y: 40, zoom: 2 })
    const key = sessionPreferenceKey({ canvasId: canvasA, name: "camera" })
    expect(writeCanvasCameraSession({ camera, canvasId: canvasA, storage })).toBe(true)
    expect(readCanvasCameraSession({ canvasId: canvasA, storage })).toEqual(camera)
    expect(storage.getItem(key)).toContain("\"schemaVersion\":1")
    clearCanvasCameraSession({ canvasId: canvasA, storage })
  })
})
