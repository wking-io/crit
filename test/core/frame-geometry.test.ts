import type { StoreSnapshot } from "@tldraw/store"
import { createShapeId, type TLRecord } from "@tldraw/tlschema"
import { getIndexAbove } from "@tldraw/utils"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { Canvas, CanvasCommand } from "../../src/core/index.js"
import { critSchema } from "../../src/core/internal/tldraw-schema.js"

describe("Canvas Frame geometry commands", () => {
  it.effect("moves and resizes a Frame without rewriting its child Annotations", () =>
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
        id: createShapeId("checkout-highlight"),
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
        CanvasCommand.moveFrame({ id: frameId, x: 360, y: 240 }),
        CanvasCommand.resizeFrame({
          id: frameId,
          width: 1440,
          height: 960
        })
      )
      const frame = yield* Canvas.getFrame(withAnnotation, frameId)
      const after = Canvas.export(withAnnotation).document as StoreSnapshot<TLRecord>

      expect(change).toEqual({
        commandCount: 2,
        changedFrameIds: [frameId]
      })
      expect(frame.geometry).toEqual({
        x: 360,
        y: 240,
        width: 1440,
        height: 960
      })
      expect(after.store[annotation.id]).toEqual(annotation)
    }))

  it.effect("rejects invalid geometry without applying earlier commands in the batch", () =>
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
      const invalidPosition = yield* Effect.flip(
        Canvas.apply(
          canvas,
          CanvasCommand.moveFrame({
            id: "checkout-v1",
            x: Number.POSITIVE_INFINITY,
            y: 100
          })
        )
      )

      expect(invalidSize).toMatchObject({
        _tag: "CanvasCommandFailed",
        reason: "invalid-command"
      })
      expect(invalidPosition).toMatchObject({
        _tag: "CanvasCommandFailed",
        reason: "invalid-command"
      })
      expect(Canvas.export(canvas)).toEqual(before)
    }))
})
