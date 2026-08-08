import { describe, expect, it } from "@effect/vitest"
import { createShapeId } from "@tldraw/tlschema"
import { Deferred, Effect, Fiber, Layer, SubscriptionRef } from "effect"

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
          detail: null,
          recoveryStatus: "unavailable",
          recoveryDetail: "Draft recovery is unavailable"
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
          detail: "Expected revision 0; current revision is 1",
          recoveryStatus: "unavailable",
          recoveryDetail: "Draft recovery is unavailable"
        })
      })
    ))

  it.effect("adopts a newer external revision while the Session is clean", () =>
    Effect.scoped(
      Effect.gen(function*() {
        let stored = Canvas.export(
          Canvas.create({ id: "review", title: "Review" })
        )
        let loadCount = 0
        const client: CritClientShape = {
          load: () => {
            loadCount += 1
            return Effect.succeed(stored)
          },
          save: (document, expectedRevision) => {
            stored = { ...document, revision: expectedRevision + 1 }
            return Effect.succeed(stored)
          }
        }
        const session = yield* CanvasSession.open("review", {
          refreshInterval: false
        }).pipe(Effect.provide(Layer.succeed(CritClient, client)))
        const originalStore = session.store

        const external = yield* Canvas.open(stored)
        yield* Canvas.apply(
          external,
          CanvasCommand.addFrame({
            id: "agent-candidate",
            url: "https://checkout.localhost/agent",
            title: "Agent candidate",
            status: "approved",
            provenance: { kind: "agent", sourceId: "codex" }
          })
        )
        stored = { ...Canvas.export(external), revision: 1 }

        const adopted = yield* session.refresh()
        const unchanged = yield* session.refresh()
        const state = yield* SubscriptionRef.get(session.state)
        const frame = session.store.get(createShapeId("agent-candidate"))

        expect(adopted).toBe(true)
        expect(unchanged).toBe(false)
        expect(session.store).toBe(originalStore)
        expect(frame).toMatchObject({
          type: "crit-frame",
          props: {
            url: "https://checkout.localhost/agent",
            status: "approved"
          }
        })
        expect(state).toMatchObject({
          revision: 1,
          mutation: 0,
          confirmedMutation: 0,
          saveStatus: "clean"
        })
        expect(loadCount).toBe(3)
      })
    ))

  it.effect("defers external adoption while local edits are dirty", () =>
    Effect.scoped(
      Effect.gen(function*() {
        let stored = Canvas.export(
          Canvas.create({ id: "review", title: "Review" })
        )
        let loadCount = 0
        const client: CritClientShape = {
          load: () => {
            loadCount += 1
            return Effect.succeed(stored)
          },
          save: (document, expectedRevision) =>
            Effect.succeed({ ...document, revision: expectedRevision + 1 })
        }
        const session = yield* CanvasSession.open("review", {
          autosaveDelay: "1 hour",
          refreshInterval: false
        }).pipe(Effect.provide(Layer.succeed(CritClient, client)))
        yield* session.dispatch(
          CanvasCommand.addFrame({
            id: "local-draft",
            url: "https://checkout.localhost/local",
            title: "Local draft",
            provenance: { kind: "manual", sourceId: "browser" }
          })
        )

        const external = yield* Canvas.open(stored)
        yield* Canvas.apply(
          external,
          CanvasCommand.addFrame({
            id: "agent-candidate",
            url: "https://checkout.localhost/agent",
            title: "Agent candidate",
            provenance: { kind: "agent", sourceId: "codex" }
          })
        )
        stored = { ...Canvas.export(external), revision: 1 }

        const adopted = yield* session.refresh()
        const state = yield* SubscriptionRef.get(session.state)

        expect(adopted).toBe(false)
        expect(loadCount).toBe(1)
        expect(session.store.get(createShapeId("local-draft"))).toBeDefined()
        expect(session.store.get(createShapeId("agent-candidate"))).toBeUndefined()
        expect(state).toMatchObject({
          revision: 0,
          mutation: 1,
          confirmedMutation: 0,
          saveStatus: "dirty"
        })
      })
    ))

  it.effect("does not adopt a revision when a local edit races the refresh", () =>
    Effect.scoped(
      Effect.gen(function*() {
        const initial = Canvas.export(
          Canvas.create({ id: "review", title: "Review" })
        )
        const external = yield* Canvas.open(initial)
        yield* Canvas.apply(
          external,
          CanvasCommand.addFrame({
            id: "agent-candidate",
            url: "https://checkout.localhost/agent",
            title: "Agent candidate",
            provenance: { kind: "agent", sourceId: "codex" }
          })
        )
        const remote = { ...Canvas.export(external), revision: 1 }
        const refreshStarted = yield* Deferred.make<void>()
        const releaseRefresh = yield* Deferred.make<void>()
        let loadCount = 0
        const client: CritClientShape = {
          load: () =>
            Effect.gen(function*() {
              loadCount += 1
              if (loadCount === 1) return initial
              yield* Deferred.succeed(refreshStarted, undefined)
              yield* Deferred.await(releaseRefresh)
              return remote
            }),
          save: (document, expectedRevision) =>
            Effect.succeed({ ...document, revision: expectedRevision + 1 })
        }
        const session = yield* CanvasSession.open("review", {
          autosaveDelay: "1 hour",
          refreshInterval: false
        }).pipe(Effect.provide(Layer.succeed(CritClient, client)))

        const refreshFiber = yield* Effect.forkChild(session.refresh())
        yield* Deferred.await(refreshStarted)
        yield* session.dispatch(
          CanvasCommand.addFrame({
            id: "local-draft",
            url: "https://checkout.localhost/local",
            title: "Local draft",
            provenance: { kind: "manual", sourceId: "browser" }
          })
        )
        yield* Deferred.succeed(releaseRefresh, undefined)
        const adopted = yield* Fiber.join(refreshFiber)

        expect(adopted).toBe(false)
        expect(session.store.get(createShapeId("local-draft"))).toBeDefined()
        expect(session.store.get(createShapeId("agent-candidate"))).toBeUndefined()
      })
    ))
})
