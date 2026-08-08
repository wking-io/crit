import type { StoreSnapshot } from "@tldraw/store"
import { createShapeId, type TLRecord } from "@tldraw/tlschema"
import { getIndexAbove } from "@tldraw/utils"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { Canvas, CanvasCommand } from "../../src/core/index.js"
import { critSchema } from "../../src/core/internal/tldraw-schema.js"

describe("Canvas RemoveFrame command", () => {
  it.effect("removes a Frame and its attached Annotation descendants", () =>
    Effect.gen(function*() {
      const canvas = Canvas.create({ id: "review", title: "Review" })
      const added = yield* Canvas.apply(
        canvas,
        CanvasCommand.addFrame({
          id: "checkout-v1",
          url: "https://checkout.localhost/v1",
          title: "Checkout v1",
          provenance: { kind: "agent", sourceId: "iteration-agent" }
        })
      )
      const frameId = added.changedFrameIds[0]!
      const document = Canvas.export(canvas)
      const snapshot = document.document as StoreSnapshot<TLRecord>
      const annotation = critSchema.types.shape.create({
        id: createShapeId("checkout-note"),
        type: "highlight",
        parentId: createShapeId("checkout-v1"),
        index: getIndexAbove(null),
        x: 20,
        y: 20,
        props: {
          color: "yellow",
          size: "m",
          segments: [
            {
              type: "free",
              points: [
                { x: 0, y: 0, z: 0.5 },
                { x: 100, y: 40, z: 0.5 }
              ]
            }
          ],
          isComplete: true,
          isPen: false,
          scale: 1
        }
      })
      snapshot.store[annotation.id] = annotation
      const withAnnotation = yield* Canvas.open(document)

      const change = yield* Canvas.apply(
        withAnnotation,
        CanvasCommand.removeFrame({ id: frameId })
      )
      const after = Canvas.export(withAnnotation).document as StoreSnapshot<TLRecord>

      expect(change).toEqual({
        commandCount: 1,
        changedFrameIds: [frameId]
      })
      expect(Canvas.summarize(withAnnotation).frameCount).toBe(0)
      expect(Object.hasOwn(after.store, frameId)).toBe(false)
      expect(after.store[annotation.id]).toBeUndefined()
    }))
})
