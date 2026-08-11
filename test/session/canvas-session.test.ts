import { describe, expect, it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Layer, SubscriptionRef } from "effect"

import { Canvas, CanvasCommand, type CanvasCommand as CanvasCommandValue } from "../../src/core/index.js"
import { CanvasSession } from "../../src/session/canvas-session.js"
import {
  CritClient,
  CritClientUnavailable,
  type CritClientShape
} from "../../src/session/crit-client.js"
import { TEST_AUTHOR } from "../support/author-identity.js"

const applyTo = (stored: ReturnType<typeof Canvas.export>, commands: ReadonlyArray<CanvasCommandValue>) =>
  Effect.gen(function*() {
    const canvas = yield* Canvas.open(stored)
    yield* Canvas.apply(canvas, ...commands)
    return { ...Canvas.export(canvas), revision: stored.revision + 1 }
  }).pipe(Effect.orDie)

describe("CanvasSession", () => {
  it.effect("resolves Current Author once for the Canvas Session lifetime", () =>
    Effect.scoped(
      Effect.gen(function*() {
        const stored = Canvas.export(Canvas.create({
          id: "review",
          title: "Review",
          owner: { id: "git:owner", name: "Canvas Owner" }
        }))
        let authorLoads = 0
        const client: CritClientShape = {
          currentAuthor: () => Effect.sync(() => {
            authorLoads += 1
            return TEST_AUTHOR
          }),
          load: () => Effect.succeed(stored),
          apply: () => Effect.succeed(stored)
        }
        const session = yield* CanvasSession.open("review", {
          refreshInterval: false,
          presenceRefreshInterval: false
        }).pipe(Effect.provide(Layer.succeed(CritClient, client)))

        yield* session.refresh()

        expect(authorLoads).toBe(1)
        expect(session.state.value.presence.currentAuthor).toEqual(TEST_AUTHOR)
        expect(session.document.value.owner).toEqual({
          id: "git:owner",
          name: "Canvas Owner"
        })
      })
    ))

  it.effect("fails opening when Current Author cannot be resolved", () =>
    Effect.scoped(
      Effect.gen(function*() {
        const stored = Canvas.export(Canvas.create({ id: "review", title: "Review", owner: TEST_AUTHOR }))
        const client: CritClientShape = {
          currentAuthor: () => Effect.fail(new CritClientUnavailable({
            operation: "current-author",
            id: "current-author",
            detail: "Git user.email is not configured"
          })),
          load: () => Effect.succeed(stored),
          apply: () => Effect.succeed(stored)
        }

        const failure = yield* Effect.flip(
          CanvasSession.open("review").pipe(
            Effect.provide(Layer.succeed(CritClient, client))
          )
        )

        expect(failure).toMatchObject({
          operation: "current-author",
          detail: "Git user.email is not configured"
        })
      })
    ))

  it.effect("keeps the session open with anonymous presence when activity retrieval fails", () =>
    Effect.scoped(
      Effect.gen(function*() {
        const stored = Canvas.export(Canvas.create({ id: "review", title: "Review", owner: TEST_AUTHOR }))
        const client: CritClientShape = {
          currentAuthor: () => Effect.succeed(TEST_AUTHOR),
          load: () => Effect.succeed(stored),
          apply: () => Effect.succeed(stored),
          activities: () => Effect.fail(new CritClientUnavailable({
            operation: "activity",
            id: "review",
            detail: "Activity store is unreadable"
          }))
        }
        const session = yield* CanvasSession.open("review", {
          refreshInterval: false,
          presenceRefreshInterval: false
        }).pipe(Effect.provide(Layer.succeed(CritClient, client)))

        expect(yield* session.refreshPresence()).toBe(false)
        expect(session.state.value.presence).toEqual({
          currentAuthor: TEST_AUTHOR,
          activities: [],
          availability: "unavailable"
        })
      })
    ))

  it.effect("surfaces renewable agent activity independently of Canvas revisions", () =>
    Effect.scoped(
      Effect.gen(function*() {
        const stored = Canvas.export(Canvas.create({ id: "review", title: "Review", owner: { id: "git:test", name: "Test Author" } }))
        const client: CritClientShape = {
          currentAuthor: () => Effect.succeed(TEST_AUTHOR),
          load: () => Effect.succeed(stored),
          apply: () => Effect.succeed(stored),
          activities: (canvasId) => Effect.succeed({
            schemaVersion: 1,
            canvasId,
            activities: [{
              schemaVersion: 1,
              canvasId,
              activityId: "codex-1",
              harness: "Codex",
              model: "GPT-5",
              detail: "Refining checkout",
              reference: null,
              createdAt: "2026-08-08T12:00:00.000Z",
              updatedAt: "2026-08-08T12:00:00.000Z",
              activeUntil: "2026-08-08T12:02:00.000Z"
            }]
          })
        }
        const session = yield* CanvasSession.open("review", {
          refreshInterval: false
        }).pipe(Effect.provide(Layer.succeed(CritClient, client)))

        expect(yield* session.refreshPresence()).toBe(true)
        expect(yield* SubscriptionRef.get(session.state)).toMatchObject({
          revision: 0,
          presence: {
            currentAuthor: TEST_AUTHOR,
            availability: "available",
            activities: [{
              activityId: "codex-1",
              detail: "Refining checkout"
            }]
          }
        })
      })
    ))

  it.effect("coalesces edits made during an in-flight command batch", () =>
    Effect.scoped(
      Effect.gen(function*() {
        let stored = Canvas.export(Canvas.create({ id: "review", title: "Review", owner: { id: "git:test", name: "Test Author" } }))
        let applyCount = 0
        let active = 0
        let maximumActive = 0
        const firstStarted = yield* Deferred.make<void>()
        const releaseFirst = yield* Deferred.make<void>()
        const client: CritClientShape = {
          currentAuthor: () => Effect.succeed(TEST_AUTHOR),
          load: () => Effect.succeed(stored),
          apply: (_id, commands) =>
            Effect.gen(function*() {
              applyCount += 1
              active += 1
              maximumActive = Math.max(maximumActive, active)
              if (applyCount === 1) {
                yield* Deferred.succeed(firstStarted, undefined)
                yield* Deferred.await(releaseFirst)
              }
              stored = yield* applyTo(stored, commands)
              active -= 1
              return stored
            })
        }
        const session = yield* CanvasSession.open("review").pipe(
          Effect.provide(Layer.succeed(CritClient, client))
        )

        yield* session.dispatch(CanvasCommand.addFrame({
          id: "first", url: "/first", title: "First",
          provenance: { kind: "agent", sourceId: "agent-a" }
        }))
        const firstFlush = yield* Effect.forkChild(session.flush())
        yield* Deferred.await(firstStarted)
        yield* session.dispatch(CanvasCommand.addFrame({
          id: "second", url: "/second", title: "Second",
          provenance: { kind: "agent", sourceId: "agent-b" }
        }))
        yield* Deferred.succeed(releaseFirst, undefined)
        yield* Fiber.join(firstFlush)
        yield* session.flush()

        const state = yield* SubscriptionRef.get(session.state)
        const persisted = yield* Canvas.open(stored)
        expect(applyCount).toBe(2)
        expect(maximumActive).toBe(1)
        expect(state).toMatchObject({ revision: 2, mutation: 2, confirmedMutation: 2, saveStatus: "clean" })
        expect(Canvas.listFrames(persisted).map((frame) => frame.id)).toEqual(["first", "second"])
      })
    ))

  it.effect("adopts a newer filesystem revision while clean", () =>
    Effect.scoped(
      Effect.gen(function*() {
        let stored = Canvas.export(Canvas.create({ id: "review", title: "Review", owner: { id: "git:test", name: "Test Author" } }))
        const client: CritClientShape = {
          currentAuthor: () => Effect.succeed(TEST_AUTHOR),
          load: () => Effect.succeed(stored),
          apply: (_id, commands) => applyTo(stored, commands).pipe(
            Effect.tap((next) => Effect.sync(() => { stored = next }))
          )
        }
        const session = yield* CanvasSession.open("review", { refreshInterval: false }).pipe(
          Effect.provide(Layer.succeed(CritClient, client))
        )
        stored = yield* applyTo(stored, [CanvasCommand.addFrame({
          id: "agent-frame", url: "/agent", title: "Agent frame",
          provenance: { kind: "agent", sourceId: "codex" }
        })])

        expect(yield* session.refresh()).toBe(true)
        expect(yield* session.refresh()).toBe(false)
        expect(session.document.value.frames.map((frame) => frame.id)).toEqual(["agent-frame"])
      })
    ))
})
