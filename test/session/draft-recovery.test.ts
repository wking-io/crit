import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Option, SubscriptionRef } from "effect"

import { Canvas, CanvasCommand, type CanvasCommand as CanvasCommandValue } from "../../src/core/index.js"
import { CanvasSession } from "../../src/session/canvas-session.js"
import { CritClient, type CritClientShape } from "../../src/session/crit-client.js"
import { DraftJournal, type CanvasDraft, type DraftJournalShape } from "../../src/session/draft-journal.js"
import { TEST_AUTHOR } from "../support/author-identity.js"

describe("CanvasSession draft recovery", () => {
  it.effect("replays semantic draft commands over a newer authoritative revision", () =>
    Effect.scoped(Effect.gen(function*() {
      let stored = { ...Canvas.export(Canvas.create({ id: "review", title: "Review", owner: { id: "git:test", name: "Test Author" } })), revision: 3 }
      const commands: ReadonlyArray<CanvasCommandValue> = [CanvasCommand.addFrame({
        id: "recovered", url: "/recovered", title: "Recovered",
        provenance: { kind: "agent", sourceId: "codex" }
      })]
      const draft: CanvasDraft = {
        schemaVersion: 1, canvasId: "review", sessionId: "browser",
        baseRevision: 1, mutation: 7, commands
      }
      const client: CritClientShape = {
        currentAuthor: () => Effect.succeed(TEST_AUTHOR),
        load: () => Effect.succeed(stored),
        apply: (_id, incoming) => Effect.gen(function*() {
          const canvas = yield* Canvas.open(stored)
          yield* Canvas.apply(canvas, ...incoming)
          stored = { ...Canvas.export(canvas), revision: stored.revision + 1 }
          return stored
        }).pipe(Effect.orDie)
      }
      const journal: DraftJournalShape = {
        load: () => Effect.succeed(Option.some(draft)),
        save: () => Effect.void,
        clear: () => Effect.void
      }
      const session = yield* CanvasSession.open("review", { sessionId: "browser" }).pipe(
        Effect.provide(Layer.merge(
          Layer.succeed(CritClient, client),
          Layer.succeed(DraftJournal, journal)
        ))
      )
      yield* session.flush()
      const state = yield* SubscriptionRef.get(session.state)
      expect(state).toMatchObject({ revision: 4, confirmedMutation: 7, saveStatus: "clean", recoveryStatus: "recovered" })
      expect(stored.frames.map((frame) => frame.id)).toEqual(["recovered"])
    }))
  )

  it.effect("keeps an unreplayable draft as an explicit recovery conflict", () =>
    Effect.scoped(Effect.gen(function*() {
      const stored = Canvas.export(Canvas.create({ id: "review", title: "Review", owner: { id: "git:test", name: "Test Author" } }))
      const draft: CanvasDraft = {
        schemaVersion: 1, canvasId: "review", sessionId: "browser", baseRevision: 0, mutation: 1,
        commands: [CanvasCommand.editNote({
          id: "missing",
          actorId: "author",
          expectedText: "",
          text: "lost"
        })]
      }
      const client: CritClientShape = {
        currentAuthor: () => Effect.succeed(TEST_AUTHOR),
        load: () => Effect.succeed(stored),
        apply: () => Effect.succeed(stored)
      }
      const journal: DraftJournalShape = {
        load: () => Effect.succeed(Option.some(draft)), save: () => Effect.void, clear: () => Effect.void
      }
      const session = yield* CanvasSession.open("review", { sessionId: "browser" }).pipe(
        Effect.provide(Layer.merge(Layer.succeed(CritClient, client), Layer.succeed(DraftJournal, journal)))
      )
      expect(session.state.value).toMatchObject({ saveStatus: "conflict", recoveryStatus: "conflict" })
      expect(session.document.value.notes).toEqual([])
      yield* session.discardLocalChanges()
      expect(session.state.value).toMatchObject({
        saveStatus: "clean",
        recoveryStatus: "available"
      })
    })))
})
