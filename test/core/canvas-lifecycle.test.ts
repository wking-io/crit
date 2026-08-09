import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { Canvas, type CanvasDocument } from "../../src/core/index.js"

describe("Canvas lifecycle", () => {
  it("opens an already-decoded document synchronously and owns its state", () => {
    const document = Canvas.export(
      Canvas.create({ id: "trusted", title: "Trusted" })
    )

    const opened = Canvas.fromDocument(document)
    ;(document as { title: string }).title = "Mutated outside the Canvas"

    expect(Canvas.summarize(opened).title).toBe("Trusted")
  })

  it("treats broken trusted-document invariants as defects", () => {
    const document = Canvas.export(
      Canvas.create({ id: "trusted", title: "Trusted" })
    )
    const broken = {
      ...document,
      frames: [
        {
          id: "duplicate",
          url: "/one",
          title: "One",
          status: "in-progress",
          provenance: { kind: "manual", sourceId: "test" },
          display: { heightMode: "viewport" },
          geometry: { x: 0, y: 0, width: 100, height: 100 },
          zIndex: 1
        },
        {
          id: "duplicate",
          url: "/two",
          title: "Two",
          status: "in-progress",
          provenance: { kind: "manual", sourceId: "test" },
          display: { heightMode: "viewport" },
          geometry: { x: 100, y: 0, width: 100, height: 100 },
          zIndex: 2
        }
      ]
    } as CanvasDocument

    expect(() => Canvas.fromDocument(broken)).toThrow(
      "Duplicate Canvas item ID: duplicate"
    )
  })

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
        activeCommentCount: 0,
        resolvedCommentCount: 0,
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
