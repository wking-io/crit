import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { Canvas, CanvasCommand } from "../../src/core/index.js"

describe("Canvas UpdateFrame command", () => {
  it.effect("updates editable Frame fields atomically and accepts canonical Frame IDs", () =>
    Effect.gen(function*() {
      const canvas = Canvas.create({ id: "review", title: "Review" })
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
        CanvasCommand.updateFrame({
          id: frameId,
          changes: {
            url: "https://checkout.localhost/v2",
            title: "Checkout refined",
            status: "approved",
            provenance: { kind: "agent", sourceId: "refinement-agent" },
            display: { heightMode: "fit-page" }
          }
        })
      )
      const reopened = yield* Canvas.open(Canvas.export(canvas))
      const frame = yield* Canvas.getFrame(reopened, frameId)

      expect(change).toEqual({
        commandCount: 1,
        changedFrameIds: [frameId]
      })
      expect(frame).toEqual({
        id: frameId,
        url: "https://checkout.localhost/v2",
        title: "Checkout refined",
        status: "approved",
        provenance: { kind: "agent", sourceId: "refinement-agent" },
        display: { heightMode: "fit-page" }
      })
    }))

  it.effect("rejects an empty update without changing the Canvas", () =>
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

      const failure = yield* Effect.flip(
        Canvas.apply(
          canvas,
          CanvasCommand.updateFrame({ id: "checkout-v1", changes: {} })
        )
      )

      expect(failure).toMatchObject({
        _tag: "CanvasCommandFailed",
        reason: "invalid-command"
      })
      expect(Canvas.export(canvas)).toEqual(before)
    }))
})
