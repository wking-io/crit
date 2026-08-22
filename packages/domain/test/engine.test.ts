import { readFileSync } from "node:fs"

import { assert, describe, expect, it } from "vitest"

import {
  CanvasEngine,
  decodeCanvasChange,
  decodeCanvasProjection
} from "../src/index.js"

const fixture = () => JSON.parse(
  readFileSync(new URL("fixtures/replay.json", import.meta.url), "utf8")
)

const decodedFixture = () => {
  const input = fixture()
  return {
    initial: decodeCanvasProjection(input.initial),
    changes: input.changes.map(decodeCanvasChange),
    projection: decodeCanvasProjection(input.projection)
  }
}

describe("CanvasProjection", () => {
  it("strictly decodes the current persisted schema version", () => {
    expect(decodeCanvasProjection({
      schemaVersion: 2,
      canvasId: "canvas_checkout",
      title: "Checkout",
      frames: [], notes: [], threads: [], stack: [], stackChangedByChangeId: null,
      issuedIds: { frameIds: [], noteIds: [], threadIds: [], commentIds: [] }
    })).toEqual({
      schemaVersion: 2,
      canvasId: "canvas_checkout",
      title: "Checkout",
      frames: [], notes: [], threads: [], stack: [], stackChangedByChangeId: null,
      issuedIds: { frameIds: [], noteIds: [], threadIds: [], commentIds: [] }
    })

    for (const input of [
      { schemaVersion: 2, canvasId: "canvas_checkout", title: "Checkout" },
      { schemaVersion: 1, canvasId: "canvas_checkout", title: " Checkout " },
      { schemaVersion: 1, canvasId: "canvas_checkout", title: "Checkout", cursor: "forged" }
    ]) {
      expect(() => decodeCanvasProjection(input)).toThrow()
    }
  })
})

describe("CanvasEngine.apply", () => {
  it("applies a chained batch in order", () => {
    const { initial, changes, projection } = decodedFixture()
    const first = changes[0]
    const second = changes[1]
    if (first === undefined || second === undefined) {
      throw new Error("Replay fixture needs two changes")
    }
    const firstResult = CanvasEngine.apply(initial, first)
    assert(firstResult._tag === "applied")

    expect(CanvasEngine.apply(firstResult.projection, second)).toEqual({
      _tag: "applied",
      projection
    })
  })

  it("rejects a later stale command without exposing a partial projection", () => {
    const initial = decodeCanvasProjection({
      schemaVersion: 2,
      canvasId: "canvas_checkout",
      title: "Checkout",
      frames: [], notes: [], threads: [], stack: [], stackChangedByChangeId: null,
      issuedIds: { frameIds: [], noteIds: [], threadIds: [], commentIds: [] }
    })
    const change = decodeCanvasChange({
      canvasId: "canvas_checkout",
      changeId: "change_stale",
      commands: [
        { _tag: "rename-canvas", expectedTitle: "Checkout", title: "Review" },
        { _tag: "rename-canvas", expectedTitle: "Checkout", title: "Final" }
      ]
    })
    const before = structuredClone(initial)

    expect(CanvasEngine.apply(initial, change)).toEqual({
      _tag: "rejected",
      failure: {
        _tag: "canvas-title-mismatch",
        commandIndex: 1,
        expectedTitle: "Checkout",
        actualTitle: "Review"
      }
    })
    expect(initial).toEqual(before)
  })

  it("accepts a no-op and preserves the same immutable projection", () => {
    const initial = decodeCanvasProjection({
      schemaVersion: 2,
      canvasId: "canvas_checkout",
      title: "Checkout",
      frames: [], notes: [], threads: [], stack: [], stackChangedByChangeId: null,
      issuedIds: { frameIds: [], noteIds: [], threadIds: [], commentIds: [] }
    })
    const change = decodeCanvasChange({
      canvasId: "canvas_checkout",
      changeId: "change_noop",
      commands: [
        { _tag: "rename-canvas", expectedTitle: "Checkout", title: "Checkout" }
      ]
    })
    const result = CanvasEngine.apply(initial, change)

    expect(result).toEqual({ _tag: "applied", projection: initial })
    if (result._tag === "applied") expect(result.projection).toBe(initial)
  })

  it("rejects a change for another Canvas before dispatching commands", () => {
    const { initial, changes } = decodedFixture()
    const other = decodeCanvasChange({
      ...changes[0],
      canvasId: "canvas_other",
      commands: [
        { _tag: "rename-canvas", expectedTitle: "Wrong", title: "Still wrong" }
      ]
    })

    expect(CanvasEngine.apply(initial, other)).toEqual({
      _tag: "rejected",
      failure: {
        _tag: "canvas-mismatch",
        expectedCanvasId: "canvas_checkout",
        actualCanvasId: "canvas_other"
      }
    })
  })
})

describe("CanvasEngine.replay", () => {
  it("returns the initial projection for an empty history", () => {
    const { initial } = decodedFixture()
    const result = CanvasEngine.replay(initial, [])
    expect(result).toEqual({ _tag: "replayed", projection: initial })
    if (result._tag === "replayed") expect(result.projection).toBe(initial)
  })

  it("rejects duplicate change identity with both positions", () => {
    const { initial, changes } = decodedFixture()
    const first = changes[0]
    if (first === undefined) throw new Error("Replay fixture needs a change")

    expect(CanvasEngine.replay(initial, [first, first])).toEqual({
      _tag: "replay-failed",
      failure: {
        _tag: "duplicate-change",
        changeId: "change_review",
        firstIndex: 0,
        currentIndex: 1
      }
    })
  })

  it("wraps a rejected change with its history position and identity", () => {
    const { initial, changes } = decodedFixture()
    const reordered = [...changes].reverse()

    expect(CanvasEngine.replay(initial, reordered)).toMatchObject({
      _tag: "replay-failed",
      failure: {
        _tag: "change-rejected",
        changeIndex: 0,
        changeId: "change_critique",
        failure: {
          _tag: "canvas-title-mismatch",
          commandIndex: 0
        }
      }
    })
  })

  it("replays fixtures deterministically without mutating inputs", () => {
    const { initial, changes, projection } = decodedFixture()
    const initialBefore = structuredClone(initial)
    const changesBefore = structuredClone(changes)

    for (let run = 0; run < 10; run += 1) {
      expect(CanvasEngine.replay(initial, changes)).toEqual({
        _tag: "replayed",
        projection
      })
    }
    expect(initial).toEqual(initialBefore)
    expect(changes).toEqual(changesBefore)
  })

  it("ignores accepted-change metadata through structural input compatibility", () => {
    const { initial, changes, projection } = decodedFixture()
    const acceptedValues = changes.map((change, index) => ({
      ...change,
      observedCursor: null,
      sequence: index + 1,
      cursor: `cursor_${index + 1}`,
      acceptedAt: "2026-08-21T12:00:00.000Z",
      attribution: { _tag: "person", person: { personId: "person_one", displayName: "One" } }
    }))

    expect(CanvasEngine.replay(initial, acceptedValues)).toEqual({
      _tag: "replayed",
      projection
    })
  })
})
