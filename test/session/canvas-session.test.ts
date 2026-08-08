import { describe, expect, it } from "@effect/vitest"
import { Deferred, Effect, Layer, SubscriptionRef } from "effect"

import { Canvas, CanvasCommand, type CanvasDocument } from "../../src/core/index.js"
import {
  CritClient,
  CritClientConflict,
  type CritClientShape
} from "../../src/session/crit-client.js"
import { CanvasSession } from "../../src/session/canvas-session.js"

describe("CanvasSession autosave", () => {
  it.effect("coalesces edits made during an in-flight save into one follow-up save", () =>
    Effect.scoped(
      Effect.gen(function*() {
        let stored = Canvas.export(
          Canvas.create({ id: "review", title: "Review" })
        )
        let saveCount = 0
        let activeSaves = 0
        let maximumActiveSaves = 0
        const expectedRevisions: Array<number> = []
        const firstSaveStarted = yield* Deferred.make<void>()
        const releaseFirstSave = yield* Deferred.make<void>()

        const client: CritClientShape = {
          load: () => Effect.succeed(stored),
          save: (document, expectedRevision) =>
            Effect.gen(function*() {
              saveCount += 1
              activeSaves += 1
              maximumActiveSaves = Math.max(maximumActiveSaves, activeSaves)
              expectedRevisions.push(expectedRevision)
              if (saveCount === 1) {
                yield* Deferred.succeed(firstSaveStarted, undefined)
                yield* Deferred.await(releaseFirstSave)
              }
              stored = {
                ...document,
                revision: expectedRevision + 1
              } satisfies CanvasDocument
              activeSaves -= 1
              return stored
            })
        }
        const clientLayer = Layer.succeed(CritClient, client)

        const session = yield* CanvasSession.open("review").pipe(
          Effect.provide(clientLayer)
        )
        yield* session.dispatch(
          CanvasCommand.addFrame({
            id: "checkout-v1",
            url: "https://checkout.localhost/v1",
            title: "Checkout v1",
            provenance: { kind: "agent", sourceId: "iteration-agent" }
          })
        )
        yield* Deferred.await(firstSaveStarted)

        yield* session.dispatch(
          CanvasCommand.addFrame({
            id: "checkout-v2",
            url: "https://checkout.localhost/v2",
            title: "Checkout v2",
            provenance: { kind: "agent", sourceId: "iteration-agent" }
          })
        )
        yield* Deferred.succeed(releaseFirstSave, undefined)
        yield* session.flush()

        const state = yield* SubscriptionRef.get(session.state)
        const persisted = yield* Canvas.open(stored)

        expect(saveCount).toBe(2)
        expect(maximumActiveSaves).toBe(1)
        expect(expectedRevisions).toEqual([0, 1])
        expect(state).toEqual({
          canvasId: "review",
          revision: 2,
          mutation: 2,
          confirmedMutation: 2,
          saveStatus: "clean",
          detail: null
        })
        expect(Canvas.listFrames(persisted).map((frame) => frame.id)).toEqual([
          "shape:checkout-v1",
          "shape:checkout-v2"
        ])
      })
    ))

  it.effect("keeps a dirty Session in conflict until it is explicitly resolved", () =>
    Effect.scoped(
      Effect.gen(function*() {
        const stored = Canvas.export(
          Canvas.create({ id: "review", title: "Review" })
        )
        let saveCount = 0
        const firstSaveStarted = yield* Deferred.make<void>()
        const releaseFirstSave = yield* Deferred.make<void>()
        const conflict = new CritClientConflict({
          id: "review",
          expectedRevision: 0,
          currentRevision: 1
        })
        const client: CritClientShape = {
          load: () => Effect.succeed(stored),
          save: () =>
            Effect.gen(function*() {
              saveCount += 1
              if (saveCount === 1) {
                yield* Deferred.succeed(firstSaveStarted, undefined)
                yield* Deferred.await(releaseFirstSave)
              }
              return yield* conflict
            })
        }
        const clientLayer = Layer.succeed(CritClient, client)
        const session = yield* CanvasSession.open("review").pipe(
          Effect.provide(clientLayer)
        )

        yield* session.dispatch(
          CanvasCommand.addFrame({
            id: "checkout-v1",
            url: "https://checkout.localhost/v1",
            title: "Checkout v1",
            provenance: { kind: "agent", sourceId: "iteration-agent" }
          })
        )
        yield* Deferred.await(firstSaveStarted)
        yield* Deferred.succeed(releaseFirstSave, undefined)
        const flushFailure = yield* Effect.flip(session.flush())

        yield* session.dispatch(
          CanvasCommand.addFrame({
            id: "checkout-v2",
            url: "https://checkout.localhost/v2",
            title: "Checkout v2",
            provenance: { kind: "agent", sourceId: "iteration-agent" }
          })
        )
        yield* Effect.yieldNow
        const state = yield* SubscriptionRef.get(session.state)

        expect(flushFailure).toBeInstanceOf(CritClientConflict)
        expect(saveCount).toBe(2)
        expect(state).toEqual({
          canvasId: "review",
          revision: 0,
          mutation: 2,
          confirmedMutation: 0,
          saveStatus: "conflict",
          detail: "Expected revision 0; current revision is 1"
        })
      })
    ))
})
