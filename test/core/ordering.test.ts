import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { Canvas, CanvasCommand } from "../../src/core/index.js"

describe("Canvas item ordering", () => {
  it.effect("moves Frames and Notes across one shared front-to-back stack", () =>
    Effect.gen(function*() {
      const canvas = Canvas.create({ id: "review", title: "Review", owner: { id: "git:test", name: "Test Author" } })
      yield* Canvas.apply(
        canvas,
        CanvasCommand.addFrame({
          id: "candidate",
          url: "https://example.com",
          title: "Candidate",
          provenance: { kind: "manual", sourceId: "test" }
        }),
        CanvasCommand.addNote({
          id: "feedback",
          text: "Review",
          author: { id: "author", name: "Test Author" },
          x: 20,
          y: 30
        })
      )

      const broughtForward = yield* Canvas.apply(
        canvas,
        CanvasCommand.bringFrameToFront({ id: "candidate" })
      )
      let document = Canvas.export(canvas)
      expect(document.frames[0]!.zIndex).toBeGreaterThan(
        document.notes[0]!.zIndex
      )
      expect(broughtForward.changedFrameIds).toEqual(["candidate"])

      const sentBack = yield* Canvas.apply(
        canvas,
        CanvasCommand.sendNoteToBack({ id: "feedback" })
      )
      document = Canvas.export(canvas)
      expect(document.notes[0]!.zIndex).toBeLessThan(
        document.frames[0]!.zIndex
      )
      expect(sentBack.changedNoteIds).toEqual(["feedback"])
    }))
})
