import { readFileSync } from "node:fs"

import { Effect, Exit } from "effect"
import { describe, expect, it } from "vitest"

import {
  decodeCanvasChange,
  decodeCanvasProjection
} from "../src/index.js"
import { DomainReplayConformance } from "../src/testing.js"

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

describe("DomainReplayConformance", () => {
  it("replays the fixture onto an identical projection", async() => {
    const { initial, changes, projection } = decodedFixture()
    const result = await Effect.runPromiseExit(DomainReplayConformance.identicalProjection({
      initial,
      changes,
      expected: projection
    }))
    expect(Exit.isSuccess(result)).toBe(true)
  })

  it("keeps the projection when a stale batch is rejected", async() => {
    const initial = decodeCanvasProjection({
      schemaVersion: 3,
      canvasId: "canvas_checkout",
      title: "Checkout",
      frames: [],
      stack: [],
      stackChangedByChangeId: null,
      issuedIds: { frameIds: [] }
    })
    const change = decodeCanvasChange({
      canvasId: "canvas_checkout",
      changeId: "change_stale",
      commands: [
        { _tag: "renameCanvas", expectedTitle: "Checkout", title: "Review" },
        { _tag: "renameCanvas", expectedTitle: "Checkout", title: "Final" }
      ]
    })
    const result = await Effect.runPromiseExit(DomainReplayConformance.rejectedBatchUnchanged({
      initial,
      change
    }))
    expect(Exit.isSuccess(result)).toBe(true)
    expect(initial.title).toBe("Checkout")
  })
})
