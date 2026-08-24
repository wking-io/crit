import { Id } from "@crit/domain"
import { Effect, Layer, Result, Schema } from "effect"
import { KeyValueStore } from "effect/unstable/persistence"
import { afterEach, describe, expect, it } from "vitest"

import {
  CanvasCamera,
  CanvasSelection,
  SessionStorageUnavailable,
  getCanvasCameraSession,
  getCanvasSelectionSession,
  getSessionPreference,
  layerMemory,
  layerSessionStorage,
  layerStorage,
  removeCanvasCameraSession,
  removeCanvasSelectionSession,
  removeSessionPreference,
  sessionPreferenceKey,
  setCanvasCameraSession,
  setCanvasSelectionSession,
  setSessionPreference
} from "../src/index.js"

const canvasA = Id.canvas("canvas_review")
const canvasB = Id.canvas("canvas_other")
const Label = Schema.String.check(Schema.isNonEmpty())

const run = <A, E>(
  effect: Effect.Effect<A, E, KeyValueStore.KeyValueStore>
): Promise<A> => Effect.runPromise(effect.pipe(Effect.provide(layerMemory)))

describe("browser session preferences", () => {
  it("round-trips a value through one KeyValueStore", async() => {
    const value = await run(Effect.gen(function*() {
      yield* setSessionPreference({
        canvasId: canvasA,
        name: "label",
        schema: Label,
        value: "pinned"
      })
      return yield* getSessionPreference({
        canvasId: canvasA,
        name: "label",
        schema: Label
      })
    }))
    expect(value).toBe("pinned")
  })

  it("keeps two memory layers independent", async() => {
    const first = await run(setSessionPreference({
      canvasId: canvasA,
      name: "label",
      schema: Label,
      value: "tab-one"
    }).pipe(Effect.andThen(getSessionPreference({
      canvasId: canvasA,
      name: "label",
      schema: Label
    }))))
    const second = await run(setSessionPreference({
      canvasId: canvasA,
      name: "label",
      schema: Label,
      value: "tab-two"
    }).pipe(Effect.andThen(getSessionPreference({
      canvasId: canvasA,
      name: "label",
      schema: Label
    }))))
    expect(first).toBe("tab-one")
    expect(second).toBe("tab-two")
  })

  it("ignores missing, corrupt, and mismatched records", async() => {
    const values = await run(Effect.gen(function*() {
      const missing = yield* getSessionPreference({
        canvasId: canvasA,
        name: "label",
        schema: Label
      })
      const store = yield* KeyValueStore.KeyValueStore
      yield* store.set(sessionPreferenceKey({ canvasId: canvasA, name: "label" }), "{")
      const corrupt = yield* getSessionPreference({
        canvasId: canvasA,
        name: "label",
        schema: Label
      })
      yield* store.set(
        sessionPreferenceKey({ canvasId: canvasA, name: "label" }),
        JSON.stringify({ schemaVersion: 1, value: 4 })
      )
      const mismatched = yield* getSessionPreference({
        canvasId: canvasA,
        name: "label",
        schema: Label
      })
      return { missing, corrupt, mismatched }
    }))
    expect(values).toEqual({
      missing: undefined,
      corrupt: undefined,
      mismatched: undefined
    })
  })

  it("clears one key without touching another canvas", async() => {
    const values = await run(Effect.gen(function*() {
      yield* setSessionPreference({
        canvasId: canvasA,
        name: "label",
        schema: Label,
        value: "a"
      })
      yield* setSessionPreference({
        canvasId: canvasB,
        name: "label",
        schema: Label,
        value: "b"
      })
      yield* removeSessionPreference({ canvasId: canvasA, name: "label" })
      return {
        first: yield* getSessionPreference({
          canvasId: canvasA,
          name: "label",
          schema: Label
        }),
        second: yield* getSessionPreference({
          canvasId: canvasB,
          name: "label",
          schema: Label
        })
      }
    }))
    expect(values).toEqual({ first: undefined, second: "b" })
  })

  it("fails the write when storage rejects it", async() => {
    const result = await Effect.runPromise(Effect.result(
      setSessionPreference({
        canvasId: canvasA,
        name: "label",
        schema: Label,
        value: "pinned"
      }).pipe(Effect.provide(layerStorage(() => ({
        getItem: () => null,
        setItem: () => {
          throw new Error("quota")
        },
        removeItem: () => undefined,
        clear: () => undefined,
        key: () => null,
        length: 0
      }))))
    ))
    expect(Result.isFailure(result)).toBe(true)
  })
})

describe("canvas camera session", () => {
  afterEach(() => {
    globalThis.sessionStorage.removeItem(
      sessionPreferenceKey({ canvasId: canvasA, name: "camera" })
    )
  })

  it("restores a camera for one canvas after a reload of the same store", async() => {
    const camera = CanvasCamera.make({ x: 12, y: -8, zoom: 0.5 })
    const values = await run(Effect.gen(function*() {
      yield* setCanvasCameraSession({ camera, canvasId: canvasA })
      return {
        saved: yield* getCanvasCameraSession({ canvasId: canvasA }),
        other: yield* getCanvasCameraSession({ canvasId: canvasB })
      }
    }))
    expect(values.saved).toEqual(camera)
    expect(values.other).toBeUndefined()
    const cleared = await run(Effect.gen(function*() {
      yield* removeCanvasCameraSession({ canvasId: canvasA })
      return yield* getCanvasCameraSession({ canvasId: canvasA })
    }))
    expect(cleared).toBeUndefined()
  })

  it("fails the sessionStorage layer with a tagged error when access is blocked", async() => {
    const view = globalThis.document.defaultView
    expect(view).toBeDefined()
    if (view === undefined) return
    const original = view.sessionStorage
    Object.defineProperty(view, "sessionStorage", {
      configurable: true,
      get: () => {
        throw new DOMException("blocked")
      }
    })
    try {
      const result = await Effect.runPromise(
        Effect.scoped(Layer.build(layerSessionStorage)).pipe(Effect.result)
      )
      expect(Result.isFailure(result)).toBe(true)
      if (!Result.isFailure(result)) return
      expect(result.failure).toBeInstanceOf(SessionStorageUnavailable)
      if (!(result.failure instanceof SessionStorageUnavailable)) return
      expect(result.failure.reason).toBe("blocked")
    } finally {
      Object.defineProperty(view, "sessionStorage", {
        configurable: true,
        enumerable: true,
        value: original
      })
    }
  })

  it("uses sessionStorage when the host provides that layer", async() => {
    const camera = CanvasCamera.make({ x: 40, y: 40, zoom: 2 })
    const saved = await Effect.runPromise(
      setCanvasCameraSession({ camera, canvasId: canvasA }).pipe(
        Effect.andThen(getCanvasCameraSession({ canvasId: canvasA })),
        Effect.provide(layerSessionStorage)
      )
    )
    expect(saved).toEqual(camera)
    expect(
      globalThis.sessionStorage.getItem(
        sessionPreferenceKey({ canvasId: canvasA, name: "camera" })
      )
    ).toContain("\"schemaVersion\":1")
  })
})

describe("canvas selection session", () => {
  afterEach(() => {
    globalThis.sessionStorage.removeItem(
      sessionPreferenceKey({ canvasId: canvasA, name: "selection" })
    )
  })

  it("restores a selection for one canvas after a reload of the same store", async() => {
    const selection = CanvasSelection.make([
      { _tag: "frame", frameId: "frame_checkout" }
    ])
    const values = await run(Effect.gen(function*() {
      yield* setCanvasSelectionSession({ canvasId: canvasA, selection })
      return {
        saved: yield* getCanvasSelectionSession({ canvasId: canvasA }),
        other: yield* getCanvasSelectionSession({ canvasId: canvasB })
      }
    }))
    expect(values.saved).toEqual(selection)
    expect(values.other).toBeUndefined()
    const cleared = await run(Effect.gen(function*() {
      yield* removeCanvasSelectionSession({ canvasId: canvasA })
      return yield* getCanvasSelectionSession({ canvasId: canvasA })
    }))
    expect(cleared).toBeUndefined()
  })

  it("uses sessionStorage when the host provides that layer", async() => {
    const selection = CanvasSelection.make([
      { _tag: "frame", frameId: "frame_checkout" }
    ])
    const saved = await Effect.runPromise(
      setCanvasSelectionSession({ canvasId: canvasA, selection }).pipe(
        Effect.andThen(getCanvasSelectionSession({ canvasId: canvasA })),
        Effect.provide(layerSessionStorage)
      )
    )
    expect(saved).toEqual(selection)
    expect(
      globalThis.sessionStorage.getItem(
        sessionPreferenceKey({ canvasId: canvasA, name: "selection" })
      )
    ).toContain("\"schemaVersion\":1")
  })
})
