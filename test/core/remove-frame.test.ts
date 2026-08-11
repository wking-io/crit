import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { Canvas, CanvasCommand } from "../../src/core/index.js"

describe("Canvas RemoveFrame command", () => {
  it.effect("removes a Frame and detaches its Notes in place", () =>
    Effect.gen(function*() {
      const canvas = Canvas.create({ id: "review", title: "Review" })
      yield* Canvas.apply(
        canvas,
        CanvasCommand.addFrame({
          id: "checkout-v1",
          url: "https://checkout.localhost/v1",
          title: "Checkout v1",
          provenance: { kind: "agent", sourceId: "iteration-agent" }
        }),
        CanvasCommand.addNote({
          id: "checkout-note",
          text: "Attached feedback",
          author: { id: "author", name: "Test Author" },
          x: 20,
          y: 20
        }),
        CanvasCommand.attachNote({ id: "checkout-note", frameId: "checkout-v1" })
      )

      const change = yield* Canvas.apply(
        canvas,
        CanvasCommand.removeFrame({ id: "checkout-v1" })
      )

      expect(change).toEqual({
        commandCount: 1,
        changedFrameIds: ["checkout-v1"],
        changedNoteIds: ["checkout-note"],
        changedCommentThreadIds: []
      })
      expect(Canvas.summarize(canvas)).toMatchObject({
        frameCount: 0,
        noteCount: 1
      })
      expect(Canvas.listNotes(canvas)).toMatchObject([{
        id: "checkout-note",
        attachedTo: null,
        geometry: { x: 20, y: 20 }
      }])
    }))
})
