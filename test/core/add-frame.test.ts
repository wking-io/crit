import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { Canvas, CanvasCommand } from "../../src/core/index.js"

describe("Canvas AddFrame command", () => {
  it.effect("adds a stable Frame that survives a Canvas Document round trip", () =>
    Effect.gen(function*() {
      const canvas = Canvas.create({
        id: "checkout-iterations",
        title: "Checkout iterations"
      })

      const change = yield* Canvas.apply(
        canvas,
        CanvasCommand.addFrame({
          id: "checkout-v1",
          url: "https://checkout.localhost/v1",
          title: "Checkout v1",
          provenance: {
            kind: "manifest",
            sourceId: "storefront:checkout-v1"
          }
        })
      )
      const reopened = Canvas.fromDocument(Canvas.export(canvas))

      expect(change).toEqual({
        commandCount: 1,
        changedFrameIds: ["checkout-v1"],
        changedNoteIds: []
      })
      expect(Canvas.summarize(reopened)).toEqual({
        id: "checkout-iterations",
        title: "Checkout iterations",
        revision: 0,
        frameCount: 1,
        noteCount: 0,
        statuses: {
          inProgress: 1,
          readyForReview: 0,
          approved: 0,
          changesRequested: 0,
          archived: 0
        }
      })
    }))

  it.effect("leaves the Canvas unchanged when any command in a batch fails", () =>
    Effect.gen(function*() {
      const canvas = Canvas.create({ id: "review", title: "Review" })
      const before = Canvas.export(canvas)

      const failure = yield* Effect.flip(
        Canvas.apply(
          canvas,
          CanvasCommand.addFrame({
            id: "checkout-v1",
            url: "https://checkout.localhost/v1",
            title: "Checkout v1",
            provenance: { kind: "agent", sourceId: "iteration-agent" }
          }),
          CanvasCommand.setFrameStatus({
            id: "missing-frame",
            status: "approved"
          })
        )
      )

      expect(failure).toMatchObject({
        _tag: "CanvasCommandFailed",
        reason: "frame-not-found"
      })
      expect(Canvas.export(canvas)).toEqual(before)
    }))
})
