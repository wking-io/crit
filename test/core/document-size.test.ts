import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import {
  Canvas,
  MAX_CANVAS_DOCUMENT_BYTES
} from "../../src/core/index.js"

describe("Canvas Document size policy", () => {
  it.effect("rejects an oversized document before opening it", () =>
    Effect.gen(function*() {
      const exported = Canvas.export(
        Canvas.create({ id: "review", title: "Review" })
      )
      const oversized = {
        ...exported,
        title: "x".repeat(MAX_CANVAS_DOCUMENT_BYTES)
      }

      const failure = yield* Effect.flip(Canvas.open(oversized))

      expect(failure).toMatchObject({
        _tag: "CanvasDocumentTooLarge",
        maxBytes: 10_000_000
      })
      if (failure._tag !== "CanvasDocumentTooLarge") {
        throw new Error(`Expected CanvasDocumentTooLarge, received ${failure._tag}`)
      }
      expect(failure.actualBytes).toBeGreaterThan(failure.maxBytes)
      expect(failure.detail).toContain("maximum is 10000000")
    }))
})
