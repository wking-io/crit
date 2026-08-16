import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { Canvas, CanvasCommand } from "../../src/core/index.js"

describe("Canvas RenameCanvas command", () => {
  it.effect("renames the Canvas without changing its stable ID", () =>
    Effect.gen(function*() {
      const canvas = Canvas.create({
        id: "checkout-review",
        title: "Checkout review",
        owner: { id: "git:test", name: "Test Author" }
      })

      const change = yield* Canvas.apply(
        canvas,
        CanvasCommand.renameCanvas({ title: "Checkout refinements" })
      )

      expect(Canvas.export(canvas)).toMatchObject({
        id: "checkout-review",
        title: "Checkout refinements"
      })
      expect(change).toEqual({
        commandCount: 1,
        changedFrameIds: [],
        changedNoteIds: [],
        changedCommentThreadIds: []
      })
    }))

  it.effect("rejects a blank title atomically", () =>
    Effect.gen(function*() {
      const canvas = Canvas.create({
        id: "review",
        title: "Review",
        owner: { id: "git:test", name: "Test Author" }
      })
      const before = Canvas.export(canvas)

      const failure = yield* Effect.flip(
        Canvas.apply(canvas, CanvasCommand.renameCanvas({ title: "   " }))
      )

      expect(failure).toMatchObject({
        _tag: "CanvasCommandFailed",
        reason: "invalid-command"
      })
      expect(Canvas.export(canvas)).toEqual(before)
    }))
})
