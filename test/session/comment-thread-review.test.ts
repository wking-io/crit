import { describe, expect, it } from "vitest"

import {
  CanvasCommandFailed,
  type CanvasDocument
} from "../../src/core/index.js"
import {
  makeCommentThreadReview,
  type CommentThreadReviewTransition
} from "../../src/session/comment-thread-review.js"

const alice = { id: "git-alice", name: "Alice" }
const bob = { id: "git-bob", name: "Bob" }

const dispatchKey = (transition: CommentThreadReviewTransition) => {
  if (transition.type !== "dispatch") {
    throw new TypeError(`Expected a dispatch transition, received ${transition.type}`)
  }
  return transition.key
}

const document = (): CanvasDocument => ({
  format: "crit-canvas",
  version: 1,
  id: "review",
  title: "Review",
  revision: 0,
  owner: alice,
  frames: [{
    id: "candidate",
    url: "https://app.localhost/candidate",
    title: "Candidate",
    status: "in-progress",
    provenance: { kind: "agent", sourceId: "codex" },
    display: { heightMode: "viewport" },
    geometry: { x: 0, y: 0, width: 1200, height: 800 },
    zIndex: 1
  }],
  notes: [],
  comments: []
})

const makeReview = () => makeCommentThreadReview({
  document: document(),
  currentAuthor: alice,
  clock: { now: () => "2026-08-11T12:00:00.000Z" },
  ids: {
    commentThreadId: () => "thread-created",
    commentId: () => "comment-created"
  }
})

const withThread = (
  input: CanvasDocument,
  resolved = false
): CanvasDocument => ({
  ...input,
  comments: [{
    id: "thread-existing",
    frameId: "candidate",
    anchor: { kind: "frame", xRatio: 0.4, yRatio: 0.6 },
    opening: {
      id: "comment-existing",
      body: "Opening",
      author: bob,
      createdAt: "2026-08-10T12:00:00.000Z",
      editedAt: null
    },
    replies: [{
      id: "reply-existing",
      body: "I can take this",
      author: alice,
      createdAt: "2026-08-10T12:30:00.000Z",
      editedAt: null
    }],
    resolvedAt: resolved ? "2026-08-10T13:00:00.000Z" : null,
    resolvedBy: resolved ? bob : null
  }]
})

describe("Comment Thread Review", () => {
  it("constructs a new Comment Thread command from a normalized anchor", () => {
    const review = makeReview()
    const anchor = { kind: "frame", xRatio: 0.25, yRatio: 0.75 } as const

    expect(review.focus(
      { kind: "new", frameId: "candidate", anchor },
      { draft: "clean" }
    )).toMatchObject({
      type: "changed",
      state: { kind: "composing", frameId: "candidate", anchor }
    })

    const transition = review.perform({ type: "submit", body: "  Tighten this spacing  " })

    expect(transition).toMatchObject({
      type: "dispatch",
      state: {
        kind: "composing",
        pending: { kind: "create" }
      },
      commands: [{
        _tag: "AddCommentThread",
        id: "thread-created",
        frameId: "candidate",
        anchor,
        opening: {
          id: "comment-created",
          body: "Tighten this spacing",
          author: alice,
          createdAt: "2026-08-11T12:00:00.000Z",
          editedAt: null
        }
      }]
    })
  })

  it("opens a resolved Comment Thread for reading without a Current Author", () => {
    const review = makeCommentThreadReview({
      document: withThread(document(), true),
      currentAuthor: null,
      clock: { now: () => "2026-08-11T12:00:00.000Z" },
      ids: {
        commentThreadId: () => "unused-thread",
        commentId: () => "unused-comment"
      }
    })

    const transition = review.focus(
      { kind: "thread", threadId: "thread-existing" },
      { draft: "clean" }
    )

    expect(transition).toMatchObject({
      type: "changed",
      state: {
        kind: "thread",
        frameId: "candidate",
        threadId: "thread-existing",
        thread: { resolvedAt: "2026-08-10T13:00:00.000Z" },
        canReply: false,
        resolution: null,
        pending: null
      }
    })
    expect(
      transition.type === "changed" && transition.state.kind === "thread"
        ? [...transition.state.editableCommentIds]
        : ["unexpected-state"]
    ).toEqual([])
  })

  it("constructs a Reply command while reviewing an existing thread", () => {
    const review = makeCommentThreadReview({
      document: withThread(document()),
      currentAuthor: alice,
      clock: { now: () => "2026-08-11T12:00:00.000Z" },
      ids: {
        commentThreadId: () => "unused-thread",
        commentId: () => "reply-created"
      }
    })
    review.focus(
      { kind: "thread", threadId: "thread-existing" },
      { draft: "clean" }
    )

    const transition = review.perform({ type: "submit", body: "  Ship it  " })

    expect(transition).toMatchObject({
      type: "dispatch",
      state: { kind: "thread", pending: { kind: "reply" } },
      commands: [{
        _tag: "ReplyToCommentThread",
        id: "thread-existing",
        reply: {
          id: "reply-created",
          body: "Ship it",
          author: alice,
          createdAt: "2026-08-11T12:00:00.000Z",
          editedAt: null
        }
      }]
    })
  })

  it("constructs an Edit Comment command only for an editable Comment", () => {
    const review = makeCommentThreadReview({
      document: withThread(document()),
      currentAuthor: alice,
      clock: { now: () => "2026-08-11T12:05:00.000Z" },
      ids: {
        commentThreadId: () => "unused-thread",
        commentId: () => "unused-comment"
      }
    })
    review.focus(
      { kind: "thread", threadId: "thread-existing" },
      { draft: "clean" }
    )

    const transition = review.perform({
      type: "edit",
      commentId: "reply-existing",
      expectedBody: "I can take this",
      body: "  I fixed this  "
    })

    expect(transition).toMatchObject({
      type: "dispatch",
      state: {
        kind: "thread",
        pending: { kind: "edit", commentId: "reply-existing" }
      },
      commands: [{
        _tag: "EditComment",
        id: "thread-existing",
        commentId: "reply-existing",
        actorId: alice.id,
        expectedBody: "I can take this",
        body: "I fixed this",
        editedAt: "2026-08-11T12:05:00.000Z"
      }]
    })

    expect(review.settle(dispatchKey(transition), {
      type: "accepted"
    })).toMatchObject({ type: "changed", clearDraft: "editing" })
  })

  it("lets the Canvas Owner resolve a Comment Thread opened by another Author", () => {
    const review = makeCommentThreadReview({
      document: withThread(document()),
      currentAuthor: alice,
      clock: { now: () => "2026-08-11T12:10:00.000Z" },
      ids: {
        commentThreadId: () => "unused-thread",
        commentId: () => "unused-comment"
      }
    })
    const opened = review.focus(
      { kind: "thread", threadId: "thread-existing" },
      { draft: "clean" }
    )
    expect(opened).toMatchObject({
      type: "changed",
      state: { kind: "thread", resolution: "resolve" }
    })

    expect(review.perform({
      type: "set-resolved",
      resolved: true
    })).toMatchObject({
      type: "dispatch",
      state: { kind: "thread", pending: { kind: "resolve" } },
      commands: [{
        _tag: "SetCommentThreadResolved",
        id: "thread-existing",
        actor: alice,
        resolved: true,
        at: "2026-08-11T12:10:00.000Z"
      }]
    })
  })

  it("requires an explicit discard before replacing a dirty review", () => {
    const input = withThread(document())
    const review = makeCommentThreadReview({
      document: input,
      currentAuthor: alice,
      clock: { now: () => "2026-08-11T12:00:00.000Z" },
      ids: {
        commentThreadId: () => "unused-thread",
        commentId: () => "unused-comment"
      }
    })
    review.focus({
      kind: "new",
      frameId: "candidate",
      anchor: { kind: "frame", xRatio: 0.2, yRatio: 0.3 }
    }, { draft: "clean" })

    expect(review.focus(
      { kind: "thread", threadId: "thread-existing" },
      { draft: "dirty" }
    )).toMatchObject({
      type: "blocked",
      reason: "dirty-draft",
      state: { kind: "composing" }
    })

    expect(review.focus(
      { kind: "thread", threadId: "thread-existing" },
      { draft: "dirty", discardDraft: true }
    )).toMatchObject({
      type: "changed",
      clearDraft: "all",
      state: { kind: "thread", threadId: "thread-existing" }
    })
  })

  it("reconciles an open review from the latest Canvas Document", () => {
    const initial = withThread(document())
    const review = makeCommentThreadReview({
      document: initial,
      currentAuthor: alice,
      clock: { now: () => "2026-08-11T12:00:00.000Z" },
      ids: {
        commentThreadId: () => "unused-thread",
        commentId: () => "unused-comment"
      }
    })
    review.focus(
      { kind: "thread", threadId: "thread-existing" },
      { draft: "clean" }
    )
    const resolved = withThread(document(), true)
    const changed: CanvasDocument = {
      ...resolved,
      comments: [{
        ...resolved.comments[0]!,
        anchor: { kind: "frame", xRatio: 0.8, yRatio: 0.1 },
        opening: {
          ...resolved.comments[0]!.opening,
          body: "Updated elsewhere"
        }
      }]
    }

    expect(review.reconcile(changed, alice)).toMatchObject({
      type: "changed",
      state: {
        kind: "thread",
        thread: {
          anchor: { kind: "frame", xRatio: 0.8, yRatio: 0.1 },
          opening: { body: "Updated elsewhere" },
          resolvedAt: "2026-08-10T13:00:00.000Z"
        },
        resolution: "reopen"
      }
    })
  })

  it("preserves a review for retry when optimistic dispatch is rejected", () => {
    const review = makeCommentThreadReview({
      document: withThread(document()),
      currentAuthor: alice,
      clock: { now: () => "2026-08-11T12:00:00.000Z" },
      ids: {
        commentThreadId: () => "unused-thread",
        commentId: () => "reply-created"
      }
    })
    review.focus(
      { kind: "thread", threadId: "thread-existing" },
      { draft: "clean" }
    )
    const dispatch = review.perform({ type: "submit", body: "Try this" })
    expect(review.perform({ type: "submit", body: "Duplicate" })).toMatchObject({
      type: "blocked",
      reason: "dispatch-pending"
    })

    const rejected = review.settle(
      dispatchKey(dispatch),
      {
        type: "rejected",
        cause: new CanvasCommandFailed({
          reason: "comment-conflict",
          detail: "Changed elsewhere"
        })
      }
    )

    expect(rejected).toMatchObject({
      type: "changed",
      state: {
        kind: "thread",
        threadId: "thread-existing",
        pending: null,
        failure: {
          reason: "comment-conflict",
          detail: "Changed elsewhere"
        }
      }
    })
    expect(rejected).not.toHaveProperty("clearDraft")
    expect(review.perform({ type: "submit", body: "Try again" })).toMatchObject({
      type: "dispatch",
      state: { pending: { kind: "reply" } }
    })
  })

  it("closes a new review only after optimistic dispatch is accepted", () => {
    const review = makeReview()
    review.focus({
      kind: "new",
      frameId: "candidate",
      anchor: { kind: "frame", xRatio: 0.5, yRatio: 0.5 }
    }, { draft: "clean" })
    const dispatch = review.perform({ type: "submit", body: "Feedback" })

    expect(review.state()).toMatchObject({
      kind: "composing",
      pending: { kind: "create" }
    })
    expect(review.settle(
      dispatchKey(dispatch),
      { type: "accepted" }
    )).toMatchObject({
      type: "changed",
      clearDraft: "composer",
      state: { kind: "idle", notice: null }
    })
  })

  it("closes an open review when its durable target is removed", () => {
    const review = makeCommentThreadReview({
      document: withThread(document()),
      currentAuthor: alice,
      clock: { now: () => "2026-08-11T12:00:00.000Z" },
      ids: {
        commentThreadId: () => "unused-thread",
        commentId: () => "unused-comment"
      }
    })
    review.focus(
      { kind: "thread", threadId: "thread-existing" },
      { draft: "clean" }
    )

    expect(review.reconcile(document(), alice)).toMatchObject({
      type: "changed",
      clearDraft: "all",
      state: { kind: "idle", notice: "target-removed" }
    })
  })

  it("does not allocate identity or time for an empty Comment", () => {
    const allocated: Array<string> = []
    const review = makeCommentThreadReview({
      document: document(),
      currentAuthor: alice,
      clock: { now: () => {
        allocated.push("time")
        return "2026-08-11T12:00:00.000Z"
      } },
      ids: {
        commentThreadId: () => {
          allocated.push("thread")
          return "thread-created"
        },
        commentId: () => {
          allocated.push("comment")
          return "comment-created"
        }
      }
    })
    review.focus({
      kind: "new",
      frameId: "candidate",
      anchor: { kind: "frame", xRatio: 0.5, yRatio: 0.5 }
    }, { draft: "clean" })

    expect(review.perform({ type: "submit", body: "   " })).toMatchObject({
      type: "blocked",
      reason: "empty-comment"
    })
    expect(allocated).toEqual([])
  })
})
