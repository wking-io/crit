import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { Canvas, CanvasCommand } from "../../src/core/index.js"

describe("Canvas Frame geometry commands", () => {
  it.effect("moves attached Notes and resizes only the Frame", () =>
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
          text: "Align this copy",
          x: 20,
          y: 20
        }),
        CanvasCommand.attachNote({ id: "checkout-note", frameId: "checkout-v1" })
      )

      const change = yield* Canvas.apply(
        canvas,
        CanvasCommand.moveFrame({ id: "checkout-v1", x: 360, y: 240 }),
        CanvasCommand.resizeFrame({
          id: "checkout-v1",
          width: 1440,
          height: 960
        })
      )
      const frame = yield* Canvas.getFrame(canvas, "checkout-v1")
      const note = yield* Canvas.getNote(canvas, "checkout-note")

      expect(change).toEqual({
        commandCount: 2,
        changedFrameIds: ["checkout-v1"],
        changedNoteIds: ["checkout-note"]
      })
      expect(frame.geometry).toEqual({
        x: 360,
        y: 240,
        width: 1440,
        height: 960
      })
      expect(note).toMatchObject({
        text: "Align this copy",
        geometry: { x: 380, y: 260, width: 280, height: 160 }
      })
    }))

  it.effect("rejects invalid geometry without applying earlier commands", () =>
    Effect.gen(function*() {
      const canvas = Canvas.create({ id: "review", title: "Review" })
      yield* Canvas.apply(
        canvas,
        CanvasCommand.addFrame({
          id: "checkout-v1",
          url: "https://checkout.localhost/v1",
          title: "Checkout v1",
          provenance: { kind: "manual", sourceId: "designer" }
        })
      )
      const before = Canvas.export(canvas)

      const invalidSize = yield* Effect.flip(
        Canvas.apply(
          canvas,
          CanvasCommand.moveFrame({ id: "checkout-v1", x: 200, y: 100 }),
          CanvasCommand.resizeFrame({
            id: "checkout-v1",
            width: 0,
            height: 800
          })
        )
      )

      expect(invalidSize).toMatchObject({
        _tag: "CanvasCommandFailed",
        reason: "invalid-command"
      })
      expect(Canvas.export(canvas)).toEqual(before)
    }))
})
