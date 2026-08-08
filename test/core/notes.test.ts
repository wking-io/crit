import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { Canvas, CanvasCommand } from "../../src/core/index.js"

describe("Canvas Notes", () => {
  it.effect("moves an attached Note with its Frame until it is detached", () =>
    Effect.gen(function*() {
      const canvas = Canvas.create({ id: "review", title: "Review" })
      yield* Canvas.apply(
        canvas,
        CanvasCommand.addFrame({
          id: "candidate",
          url: "https://checkout.localhost",
          title: "Checkout",
          provenance: { kind: "agent", sourceId: "builder" }
        }),
        CanvasCommand.addNote({
          id: "feedback",
          text: "Keep this aligned with the CTA",
          x: 80,
          y: 120
        }),
        CanvasCommand.attachNote({ id: "feedback", frameId: "candidate" })
      )

      yield* Canvas.apply(
        canvas,
        CanvasCommand.moveFrame({ id: "candidate", x: 300, y: 200 })
      )
      expect(Canvas.listNotes(canvas)).toMatchObject([
        {
          id: "feedback",
          text: "Keep this aligned with the CTA",
          attachedTo: "candidate",
          geometry: { x: 380, y: 320 }
        }
      ])

      yield* Canvas.apply(
        canvas,
        CanvasCommand.detachNote({ id: "feedback" }),
        CanvasCommand.moveFrame({ id: "candidate", x: 600, y: 400 })
      )
      expect(Canvas.listNotes(canvas)[0]).toMatchObject({
        id: "feedback",
        attachedTo: null,
        geometry: { x: 380, y: 320 }
      })
    }))

  it.effect("rejects a stale text edit without changing the Note", () =>
    Effect.gen(function*() {
      const canvas = Canvas.create({ id: "review", title: "Review" })
      yield* Canvas.apply(
        canvas,
        CanvasCommand.addNote({
          id: "feedback",
          text: "Original",
          x: 40,
          y: 60
        }),
        CanvasCommand.updateNote({
          id: "feedback",
          expectedText: "Original",
          text: "Human edit"
        })
      )

      const failure = yield* Effect.flip(
        Canvas.apply(
          canvas,
          CanvasCommand.updateNote({
            id: "feedback",
            expectedText: "Original",
            text: "Agent edit"
          })
        )
      )

      expect(failure).toMatchObject({
        _tag: "CanvasCommandFailed",
        reason: "note-conflict"
      })
      expect(Canvas.listNotes(canvas)[0]?.text).toBe("Human edit")
    }))
})

