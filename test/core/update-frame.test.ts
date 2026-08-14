import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { Canvas, CanvasCommand } from "../../src/core/index.js"

describe("Canvas Frame field commands", () => {
  it.effect("updates editable Frame fields atomically and accepts canonical Frame IDs", () =>
    Effect.gen(function*() {
      const canvas = Canvas.create({ id: "review", title: "Review", owner: { id: "git:test", name: "Test Author" } })
      const added = yield* Canvas.apply(
        canvas,
        CanvasCommand.addFrame({
          id: "checkout-v1",
          url: "https://checkout.localhost/v1",
          title: "Checkout v1",
          provenance: { kind: "manifest", sourceId: "storefront:v1" }
        })
      )
      const frameId = added.changedFrameIds[0]!

      const change = yield* Canvas.apply(
        canvas,
        CanvasCommand.setFrameSource({
          id: frameId,
          url: "https://checkout.localhost/v2",
          provenance: { kind: "agent", sourceId: "refinement-agent" }
        }),
        CanvasCommand.setFrameTitle({
          id: frameId,
          title: "Checkout refined"
        }),
        CanvasCommand.setFrameStatus({ id: frameId, status: "approved" }),
        CanvasCommand.setFrameDisplay({
          id: frameId,
          display: { heightMode: "fit-page" }
        })
      )
      const reopened = yield* Canvas.open(Canvas.export(canvas))
      const frame = yield* Canvas.getFrame(reopened, frameId)

      expect(change).toEqual({
        commandCount: 4,
        changedFrameIds: [frameId],
        changedNoteIds: [],
        changedCommentThreadIds: []
      })
      expect(frame).toEqual({
        id: frameId,
        url: "https://checkout.localhost/v2",
        title: "Checkout refined",
        status: "approved",
        provenance: { kind: "agent", sourceId: "refinement-agent" },
        display: { heightMode: "fit-page" },
        geometry: { x: 0, y: 0, width: 1200, height: 800 },
        zIndex: 1
      })
    }))

  it.effect("rolls back the batch when a field command is invalid", () =>
    Effect.gen(function*() {
      const canvas = Canvas.create({ id: "review", title: "Review", owner: { id: "git:test", name: "Test Author" } })
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

      const failure = yield* Effect.flip(
        Canvas.apply(
          canvas,
          CanvasCommand.setFrameTitle({
            id: "checkout-v1",
            title: "This must be rolled back"
          }),
          CanvasCommand.setFrameSource({
            id: "checkout-v1",
            url: "https://checkout.localhost/snapshot",
            provenance: { kind: "snapshot", sourceId: "snapshot" }
          })
        )
      )

      expect(failure).toMatchObject({
        _tag: "CanvasCommandFailed",
        reason: "snapshot-source-invalid"
      })
      expect(Canvas.export(canvas)).toEqual(before)
    }))
})
