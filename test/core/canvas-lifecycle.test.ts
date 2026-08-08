import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { Canvas } from "../../src/core/index.js"

describe("Canvas lifecycle", () => {
  it.effect("reopens an exported empty Canvas without changing its meaning", () =>
    Effect.gen(function*() {
      const created = Canvas.create({
        id: "checkout-iterations",
        title: "Checkout iterations"
      })

      const reopened = yield* Canvas.open(Canvas.export(created))

      expect(Canvas.summarize(reopened)).toEqual({
        id: "checkout-iterations",
        title: "Checkout iterations",
        revision: 0,
        frameCount: 0,
        noteCount: 0,
        statuses: {
          inProgress: 0,
          readyForReview: 0,
          approved: 0,
          changesRequested: 0,
          archived: 0
        }
      })
    }))
})
