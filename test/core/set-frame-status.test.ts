import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { Canvas, CanvasCommand } from "../../src/core/index.js"

describe("Canvas SetFrameStatus command", () => {
  it.effect("changes the review status without changing Frame identity", () =>
    Effect.gen(function*() {
      const canvas = Canvas.create({ id: "review", title: "Review", owner: { id: "git:test", name: "Test Author" } })
      yield* Canvas.apply(
        canvas,
        CanvasCommand.addFrame({
          id: "checkout-v1",
          url: "https://checkout.localhost/v1",
          title: "Checkout v1",
          provenance: { kind: "agent", sourceId: "iteration-agent" }
        }),
        CanvasCommand.addFrame({
          id: "checkout-v2",
          url: "https://checkout.localhost/v2",
          title: "Checkout v2",
          provenance: { kind: "agent", sourceId: "iteration-agent" }
        })
      )

      const change = yield* Canvas.apply(
        canvas,
        CanvasCommand.setFrameStatus({
          id: "checkout-v2",
          status: "ready-for-review"
        })
      )
      const reopened = yield* Canvas.open(Canvas.export(canvas))

      expect(change).toEqual({
        commandCount: 1,
        changedFrameIds: ["checkout-v2"],
        changedNoteIds: [],
        changedCommentThreadIds: []
      })
      expect(Canvas.summarize(reopened).statuses).toEqual({
        inProgress: 1,
        readyForReview: 1,
        approved: 0,
        changesRequested: 0,
        archived: 0
      })
    }))
})
