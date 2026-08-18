import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import {
  Canvas,
  CanvasCommand,
  canEditComment
} from "../../src/core/index.js"

const alice = { id: "git-alice", name: "Alice" }
const bob = { id: "git-bob", name: "Bob" }
const eve = { id: "git-eve", name: "Eve" }

const message = (id: string, body: string, author = alice) => ({
  id,
  body,
  author,
  createdAt: "2026-08-09T12:00:00.000Z",
  editedAt: null
})

const addLiveFrame = (canvas: ReturnType<typeof Canvas.create>) => Canvas.apply(
  canvas,
  CanvasCommand.addFrame({
    id: "candidate",
    url: "https://app.localhost/candidate",
    title: "Candidate",
    provenance: { kind: "agent", sourceId: "codex" }
  })
)

describe("Canvas Comments", () => {
  it("projects Comment editing capability from authorship", () => {
    const comment = message("comment-1", "Tighten this spacing")

    expect(canEditComment(comment, alice.id)).toBe(true)
    expect(canEditComment(comment, bob.id)).toBe(false)
  })

  it.effect("persists flat threads and enforces author and owner permissions", () =>
    Effect.gen(function*() {
      const canvas = Canvas.create({ id: "review", title: "Review", owner: alice })
      yield* addLiveFrame(canvas)
      yield* Canvas.apply(
        canvas,
        CanvasCommand.addCommentThread({
          id: "thread-1",
          frameId: "candidate",
          anchor: { kind: "frame", xRatio: 0.25, yRatio: 0.75 },
          opening: message("comment-1", "Tighten this spacing")
        }),
        CanvasCommand.replyToCommentThread({
          id: "thread-1",
          reply: message("reply-1", "On it", bob)
        })
      )

      const forbiddenEdit = yield* Effect.flip(Canvas.apply(
        canvas,
        CanvasCommand.editComment({
          id: "thread-1",
          commentId: "reply-1",
          actorId: alice.id,
          expectedBody: "On it",
          body: "Changed by someone else",
          editedAt: "2026-08-09T12:01:00.000Z"
        })
      ))
      expect(forbiddenEdit).toMatchObject({ reason: "comment-forbidden" })

      yield* Canvas.apply(
        canvas,
        CanvasCommand.editComment({
          id: "thread-1",
          commentId: "reply-1",
          actorId: bob.id,
          expectedBody: "On it",
          body: "Fixed",
          editedAt: "2026-08-09T12:02:00.000Z"
        })
      )

      const forbiddenResolve = yield* Effect.flip(Canvas.apply(
        canvas,
        CanvasCommand.setCommentThreadResolved({
          id: "thread-1",
          actor: eve,
          resolved: true,
          at: "2026-08-09T12:03:00.000Z"
        })
      ))
      expect(forbiddenResolve).toMatchObject({ reason: "comment-forbidden" })

      yield* Canvas.apply(
        canvas,
        CanvasCommand.setCommentThreadResolved({
          id: "thread-1",
          actor: alice,
          resolved: true,
          at: "2026-08-09T12:04:00.000Z"
        })
      )

      const document = Canvas.export(canvas)
      expect(document.owner).toEqual(alice)
      expect(document.comments).toMatchObject([{
        id: "thread-1",
        opening: { body: "Tighten this spacing" },
        replies: [{ body: "Fixed", editedAt: "2026-08-09T12:02:00.000Z" }],
        resolvedBy: alice
      }])
      expect(Canvas.summarize(canvas)).toMatchObject({
        activeCommentCount: 0,
        resolvedCommentCount: 1
      })
    }))

  it.effect("lets the Canvas Owner manage a thread opened by another author", () =>
    Effect.gen(function*() {
      const canvas = Canvas.create({ id: "review", title: "Review", owner: alice })
      yield* addLiveFrame(canvas)
      yield* Canvas.apply(
        canvas,
        CanvasCommand.addCommentThread({
          id: "owner-thread",
          frameId: "candidate",
          anchor: { kind: "frame", xRatio: 0.5, yRatio: 0.5 },
          opening: message("owner-comment", "First", alice)
        }),
        CanvasCommand.addCommentThread({
          id: "bob-thread",
          frameId: "candidate",
          anchor: { kind: "frame", xRatio: 0.6, yRatio: 0.6 },
          opening: message("bob-comment", "Second", bob)
        }),
        CanvasCommand.setCommentThreadResolved({
          id: "bob-thread",
          actor: alice,
          resolved: true,
          at: "2026-08-09T12:04:00.000Z"
        })
      )

      expect(Canvas.export(canvas).comments[1]).toMatchObject({
        id: "bob-thread",
        resolvedBy: alice
      })
      expect(Canvas.export(canvas).owner).toEqual(alice)
    }))

  it.effect("rejects Comments on archived snapshot Frames", () =>
    Effect.gen(function*() {
      const canvas = Canvas.create({ id: "review", title: "Review", owner: alice })
      yield* addLiveFrame(canvas)
      yield* Canvas.apply(
        canvas,
        CanvasCommand.addSnapshotFrame({
          id: "snapshot-artifact",
          sourceFrameId: "candidate",
          expectedSourceUrl: "https://app.localhost/candidate",
          url: "/__crit/snapshots/artifact",
          artifact: {
            artifactId: "artifact",
            sourceUrl: "https://app.localhost/candidate",
            capturedAt: "2026-08-09T12:00:00.000Z",
            sizeBytes: 10
          }
        })
      )

      const failure = yield* Effect.flip(Canvas.apply(
        canvas,
        CanvasCommand.addCommentThread({
          id: "archived-thread",
          frameId: "snapshot-artifact",
          anchor: { kind: "frame", xRatio: 0.5, yRatio: 0.5 },
          opening: message("archived-comment", "This must be rejected")
        })
      ))

      expect(failure).toMatchObject({
        reason: "archived-frame-comments-unsupported"
      })
      expect(Canvas.export(canvas).comments).toEqual([])
    }))

  it.effect("keeps stored Comment Threads unchanged through unrelated Frame edits", () =>
    Effect.gen(function*() {
      const canvas = Canvas.create({ id: "review", title: "Review", owner: alice })
      yield* addLiveFrame(canvas)
      yield* Canvas.apply(
        canvas,
        CanvasCommand.addCommentThread({
          id: "thread-1",
          frameId: "candidate",
          anchor: { kind: "frame", xRatio: 0.25, yRatio: 0.75 },
          opening: message("comment-1", "Tighten this spacing")
        })
      )
      const comments = Canvas.export(canvas).comments

      yield* Canvas.apply(
        canvas,
        CanvasCommand.setFrameTitle({ id: "candidate", title: "Candidate v2" })
      )

      expect(Canvas.export(canvas).comments).toEqual(comments)
    }))
})
