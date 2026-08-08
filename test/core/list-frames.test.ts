import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { Canvas, CanvasCommand } from "../../src/core/index.js"

describe("Canvas.listFrames", () => {
  it.effect("returns the complete semantic Frame read model in stable canvas order", () =>
    Effect.gen(function*() {
      const canvas = Canvas.create({ id: "review", title: "Review" })
      yield* Canvas.apply(
        canvas,
        CanvasCommand.addFrame({
          id: "checkout-v1",
          url: "https://checkout.localhost",
          title: "Checkout v1",
          provenance: { kind: "manifest", sourceId: "storefront:v1" }
        }),
        CanvasCommand.addFrame({
          id: "checkout-v2",
          url: "https://checkout.localhost",
          title: "Checkout v2",
          provenance: { kind: "agent", sourceId: "iteration-agent" }
        })
      )
      yield* Canvas.apply(
        canvas,
        CanvasCommand.moveFrame({ id: "checkout-v1", x: 600, y: 300 }),
        CanvasCommand.updateFrame({
          id: "checkout-v2",
          changes: { status: "approved", display: { heightMode: "fit-page" } }
        })
      )
      const reopened = yield* Canvas.open(Canvas.export(canvas))

      expect(Canvas.listFrames(reopened)).toEqual([
        {
          id: "checkout-v1",
          url: "https://checkout.localhost",
          title: "Checkout v1",
          status: "in-progress",
          provenance: { kind: "manifest", sourceId: "storefront:v1" },
          display: { heightMode: "viewport" },
          geometry: { x: 600, y: 300, width: 1200, height: 800 },
          zIndex: 1
        },
        {
          id: "checkout-v2",
          url: "https://checkout.localhost",
          title: "Checkout v2",
          status: "approved",
          provenance: { kind: "agent", sourceId: "iteration-agent" },
          display: { heightMode: "fit-page" },
          geometry: { x: 1240, y: 0, width: 1200, height: 800 },
          zIndex: 2
        }
      ])
    }))
})
