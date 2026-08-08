import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Option, SubscriptionRef } from "effect"

import { Canvas, CanvasCommand, type CanvasDocument } from "../../src/core/index.js"
import {
  CanvasSession,
  type CanvasSessionState
} from "../../src/session/canvas-session.js"
import { CritClient, type CritClientShape } from "../../src/session/crit-client.js"
import {
  DraftJournal,
  type CanvasDraft,
  type DraftJournalShape
} from "../../src/session/draft-journal.js"

const documentAtRevision = (revision: number): CanvasDocument => ({
  ...Canvas.export(Canvas.create({ id: "review", title: "Review" })),
  revision
})

describe("CanvasSession draft recovery", () => {
  it.effect("restores a matching draft and resumes autosave", () =>
    Effect.scoped(
      Effect.gen(function*() {
        const authoritative = documentAtRevision(2)
        const draftCanvas = yield* Canvas.open(authoritative)
        yield* Canvas.apply(
          draftCanvas,
          CanvasCommand.addFrame({
            id: "checkout-v1",
            url: "https://checkout.localhost/v1",
            title: "Checkout v1",
            provenance: { kind: "agent", sourceId: "iteration-agent" }
          })
        )
        const draft: CanvasDraft = {
          schemaVersion: 1,
          canvasId: "review",
          sessionId: "browser-session",
          baseRevision: 2,
          mutation: 7,
          document: Canvas.export(draftCanvas)
        }
        let stored = authoritative
        const clearedThrough: Array<number> = []
        const client: CritClientShape = {
          load: () => Effect.succeed(stored),
          save: (document, expectedRevision) => {
            stored = { ...document, revision: expectedRevision + 1 }
            return Effect.succeed(stored)
          }
        }
        const journal: DraftJournalShape = {
          load: () => Effect.succeed(Option.some(draft)),
          save: () => Effect.void,
          clear: (_canvasId, _sessionId, throughMutation) =>
            Effect.sync(() => {
              clearedThrough.push(throughMutation)
            })
        }
        const session = yield* CanvasSession.open("review", {
          sessionId: "browser-session"
        }).pipe(
          Effect.provide(
            Layer.merge(
              Layer.succeed(CritClient, client),
              Layer.succeed(DraftJournal, journal)
            )
          )
        )

        yield* session.flush()
        const state = yield* SubscriptionRef.get(session.state)
        const persisted = yield* Canvas.open(stored)

        expect(state).toEqual({
          canvasId: "review",
          revision: 3,
          mutation: 7,
          confirmedMutation: 7,
          saveStatus: "clean",
          detail: null,
          recoveryStatus: "recovered",
          recoveryDetail: null
        } satisfies CanvasSessionState)
        expect(Canvas.listFrames(persisted).map((frame) => frame.id)).toEqual([
          "shape:checkout-v1"
        ])
        expect(clearedThrough).toEqual([7])
      })
    ))

  it.effect("holds a revision-mismatched draft as an explicit recovery conflict", () =>
    Effect.scoped(
      Effect.gen(function*() {
        const authoritative = documentAtRevision(3)
        const staleDraft: CanvasDraft = {
          schemaVersion: 1,
          canvasId: "review",
          sessionId: "browser-session",
          baseRevision: 2,
          mutation: 4,
          document: documentAtRevision(2)
        }
        let saveCount = 0
        const client: CritClientShape = {
          load: () => Effect.succeed(authoritative),
          save: () => {
            saveCount += 1
            return Effect.succeed(authoritative)
          }
        }
        const journal: DraftJournalShape = {
          load: () => Effect.succeed(Option.some(staleDraft)),
          save: () => Effect.void,
          clear: () => Effect.void
        }
        const session = yield* CanvasSession.open("review", {
          sessionId: "browser-session"
        }).pipe(
          Effect.provide(
            Layer.merge(
              Layer.succeed(CritClient, client),
              Layer.succeed(DraftJournal, journal)
            )
          )
        )
        const state = yield* SubscriptionRef.get(session.state)

        expect(saveCount).toBe(0)
        expect(session.recoveryDraft).toEqual(staleDraft)
        expect(state).toMatchObject({
          revision: 3,
          saveStatus: "conflict",
          recoveryStatus: "conflict",
          recoveryDetail:
            "Draft base revision 2 does not match authoritative revision 3"
        })
      })
    ))
})
