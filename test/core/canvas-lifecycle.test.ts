import { describe, expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"

import { Canvas, type CanvasDocument } from "../../src/core/index.js"

describe("Canvas lifecycle", () => {
  it.effect("rejects a Canvas Document without its creation-time owner", () =>
    Effect.gen(function*() {
      const document = Canvas.export(
        Canvas.create({
          id: "owned",
          title: "Owned",
          owner: { id: "git:owner", name: "Owner" }
        })
      )
      const { owner: _owner, ...ownerless } = document

      const failure = yield* Effect.flip(
        Canvas.open(Schema.decodeUnknownSync(Schema.Json)(ownerless))
      )

      expect(failure).toMatchObject({ reason: "invalid-envelope" })
    }))

  it("opens an already-decoded document synchronously and owns its state", () => {
    const document = Canvas.export(
      Canvas.create({ id: "trusted", title: "Trusted", owner: { id: "git:test", name: "Test Author" } })
    )

    const opened = Canvas.fromDocument(document)
    // SAFETY: This test intentionally mutates an exported readonly value at
    // runtime to prove Canvas owns an isolated copy of its state.
    const mutableDocument = document as { title: string }
    mutableDocument.title = "Mutated outside the Canvas"

    expect(Canvas.summarize(opened).title).toBe("Trusted")
  })

  it("treats broken trusted-document invariants as defects", () => {
    const document = Canvas.export(
      Canvas.create({ id: "trusted", title: "Trusted", owner: { id: "git:test", name: "Test Author" } })
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
    } satisfies CanvasDocument

    expect(() => Canvas.fromDocument(broken)).toThrow(
      "Duplicate Canvas item ID: duplicate"
    )
  })

  it.effect("reopens an exported empty Canvas without changing its meaning", () =>
    Effect.gen(function*() {
      const created = Canvas.create({
        id: "checkout-iterations",
        title: "Checkout iterations",
        owner: { id: "git:test", name: "Test Author" }
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
