import {
  CanvasCommand,
  canEditComment,
  canManageCommentThread,
  commentMessageById,
  type Author,
  type CanvasCommand as CanvasCommandValue,
  type CanvasCommandFailed,
  type CanvasCommentThread,
  type CanvasDocument,
  type CommentAnchor
} from "../core/index.js"

declare const dispatchKeyBrand: unique symbol
export type CommentThreadReviewDispatchKey = number & {
  readonly [dispatchKeyBrand]: true
}

export type CommentThreadReviewTarget =
  | {
      readonly kind: "new"
      readonly frameId: string
      readonly anchor: CommentAnchor
    }
  | {
      readonly kind: "thread"
      readonly threadId: string
    }

export type CommentThreadReviewPending =
  | { readonly kind: "create"; readonly key: CommentThreadReviewDispatchKey }
  | { readonly kind: "reply"; readonly key: CommentThreadReviewDispatchKey }
  | {
      readonly kind: "edit"
      readonly commentId: string
      readonly key: CommentThreadReviewDispatchKey
    }
  | {
      readonly kind: "resolve" | "reopen"
      readonly key: CommentThreadReviewDispatchKey
    }

export type CommentThreadReviewFailure = {
  readonly reason: CanvasCommandFailed["reason"]
  readonly detail: string
}

export type CommentThreadReviewState =
  | {
      readonly kind: "idle"
      readonly notice: "target-removed" | null
    }
  | {
      readonly kind: "composing"
      readonly frameId: string
      readonly anchor: CommentAnchor
      readonly canCreate: boolean
      readonly pending: CommentThreadReviewPending | null
      readonly failure: CommentThreadReviewFailure | null
    }
  | {
      readonly kind: "thread"
      readonly frameId: string
      readonly threadId: string
      readonly thread: CanvasCommentThread
      readonly canReply: boolean
      readonly editableCommentIds: ReadonlySet<string>
      readonly resolution: "resolve" | "reopen" | null
      readonly pending: CommentThreadReviewPending | null
      readonly failure: CommentThreadReviewFailure | null
    }

export type CommentThreadReviewAction =
  | { readonly type: "submit"; readonly body: string }
  | {
      readonly type: "edit"
      readonly commentId: string
      readonly expectedBody: string
      readonly body: string
    }
  | { readonly type: "set-resolved"; readonly resolved: boolean }

export type CommentThreadReviewDispatchOutcome =
  | { readonly type: "accepted" }
  | { readonly type: "rejected"; readonly cause: CanvasCommandFailed }

export type CommentThreadReviewBlockedReason =
  | "dirty-draft"
  | "dispatch-pending"
  | "review-idle"
  | "current-author-required"
  | "frame-not-found"
  | "archived-frame"
  | "comment-thread-not-found"
  | "comment-not-found"
  | "comment-forbidden"
  | "empty-comment"

export type CommentThreadReviewTransition =
  | {
      readonly type: "changed"
      readonly state: CommentThreadReviewState
      readonly clearDraft?: "composer" | "editing" | "all"
    }
  | {
      readonly type: "blocked"
      readonly state: CommentThreadReviewState
      readonly reason: CommentThreadReviewBlockedReason
    }
  | {
      readonly type: "dispatch"
      readonly state: CommentThreadReviewState
      readonly key: CommentThreadReviewDispatchKey
      readonly commands: readonly [
        CanvasCommandValue,
        ...ReadonlyArray<CanvasCommandValue>
      ]
    }

export interface CommentThreadReview {
  readonly state: () => CommentThreadReviewState
  readonly reconcile: (
    document: CanvasDocument,
    currentAuthor: Author | null
  ) => CommentThreadReviewTransition
  readonly focus: (
    target: CommentThreadReviewTarget | null,
    options: {
      readonly draft: "clean" | "dirty"
      readonly discardDraft?: true
    }
  ) => CommentThreadReviewTransition
  readonly perform: (
    action: CommentThreadReviewAction
  ) => CommentThreadReviewTransition
  readonly settle: (
    key: CommentThreadReviewDispatchKey,
    outcome: CommentThreadReviewDispatchOutcome
  ) => CommentThreadReviewTransition
}

export type ReviewClock = {
  readonly now: () => string
}

export type ReviewIds = {
  readonly commentThreadId: () => string
  readonly commentId: () => string
}

export type MakeCommentThreadReviewInput = {
  readonly document: CanvasDocument
  readonly currentAuthor: Author | null
  readonly clock: ReviewClock
  readonly ids: ReviewIds
}

const idle = (notice: "target-removed" | null = null): CommentThreadReviewState => ({
  kind: "idle",
  notice
})

export const makeCommentThreadReview = (
  input: MakeCommentThreadReviewInput
): CommentThreadReview => {
  let currentDocument = input.document
  let currentAuthor = input.currentAuthor
  let currentState: CommentThreadReviewState = idle()
  let nextDispatchKey = 1

  const stateForThread = (
    thread: CanvasCommentThread
  ): Extract<CommentThreadReviewState, { readonly kind: "thread" }> => {
    const actorId = currentAuthor?.id
    const canManage = actorId === undefined
      ? false
      : canManageCommentThread(currentDocument.owner, thread, actorId)
    return {
      kind: "thread",
      frameId: thread.frameId,
      threadId: thread.id,
      thread,
      canReply: currentAuthor !== null,
      editableCommentIds: new Set(
        [thread.opening, ...thread.replies]
          .filter((message) =>
            actorId !== undefined && canEditComment(message, actorId)
          )
          .map((message) => message.id)
      ),
      resolution: canManage
        ? thread.resolvedAt === null ? "resolve" : "reopen"
        : null,
      pending: null,
      failure: null
    }
  }

  const changed = (
    state: CommentThreadReviewState,
    clearDraft?: "composer" | "editing" | "all"
  ): CommentThreadReviewTransition => {
    currentState = state
    return clearDraft === undefined
      ? { type: "changed", state }
      : { type: "changed", state, clearDraft }
  }

  const blocked = (
    reason: CommentThreadReviewBlockedReason
  ): CommentThreadReviewTransition => ({
    type: "blocked",
    state: currentState,
    reason
  })

  const reconcile = (
    document: CanvasDocument,
    author: Author | null
  ): CommentThreadReviewTransition => {
    currentDocument = document
    currentAuthor = author
    if (currentState.kind === "idle") return changed(currentState)
    const state = currentState

    const frame = document.frames.find(({ id }) => id === state.frameId)
    if (frame === undefined || frame.snapshot !== undefined) {
      return changed(idle("target-removed"), "all")
    }
    if (state.kind === "composing") {
      return changed({
        ...state,
        canCreate: currentAuthor !== null
      })
    }

    const thread = document.comments.find(({ id }) => id === state.threadId)
    if (thread === undefined) return changed(idle("target-removed"), "all")
    return changed({
      ...stateForThread(thread),
      pending: state.pending,
      failure: state.failure
    })
  }

  const focus: CommentThreadReview["focus"] = (target, options) => {
    if (currentState.kind !== "idle" && currentState.pending !== null) {
      return blocked("dispatch-pending")
    }
    if (
      currentState.kind !== "idle" &&
      options.draft === "dirty" &&
      options.discardDraft !== true
    ) {
      return blocked("dirty-draft")
    }
    if (target === null) return changed(idle(), options.discardDraft ? "all" : undefined)
    if (target.kind === "thread") {
      const thread = currentDocument.comments.find(({ id }) => id === target.threadId)
      if (thread === undefined) return blocked("comment-thread-not-found")
      return changed(
        stateForThread(thread),
        options.discardDraft ? "all" : undefined
      )
    }

    const frame = currentDocument.frames.find(({ id }) => id === target.frameId)
    if (frame === undefined) return blocked("frame-not-found")
    if (frame.snapshot !== undefined) return blocked("archived-frame")

    return changed({
      kind: "composing",
      frameId: frame.id,
      anchor: target.anchor,
      canCreate: currentAuthor !== null,
      pending: null,
      failure: null
    }, options.discardDraft ? "all" : undefined)
  }

  const perform: CommentThreadReview["perform"] = (action) => {
    if (currentState.kind === "idle") return blocked("review-idle")
    if (currentState.pending !== null) return blocked("dispatch-pending")
    if (currentAuthor === null) return blocked("current-author-required")
    if (action.type === "edit") {
      if (currentState.kind !== "thread") return blocked("comment-forbidden")
      const comment = commentMessageById(currentState.thread, action.commentId)
      if (comment === undefined) return blocked("comment-not-found")
      if (!canEditComment(comment, currentAuthor.id)) {
        return blocked("comment-forbidden")
      }
      const body = action.body.trim()
      if (body.length === 0) return blocked("empty-comment")
      const key = nextDispatchKey++ as CommentThreadReviewDispatchKey
      const state: CommentThreadReviewState = {
        ...currentState,
        pending: { kind: "edit", commentId: action.commentId, key },
        failure: null
      }
      currentState = state
      return {
        type: "dispatch",
        state,
        key,
        commands: [CanvasCommand.editComment({
          id: state.threadId,
          commentId: action.commentId,
          actorId: currentAuthor.id,
          expectedBody: action.expectedBody,
          body,
          editedAt: input.clock.now()
        })]
      }
    }
    if (action.type === "set-resolved") {
      if (
        currentState.kind !== "thread" ||
        !canManageCommentThread(
          currentDocument.owner,
          currentState.thread,
          currentAuthor.id
        )
      ) {
        return blocked("comment-forbidden")
      }
      const key = nextDispatchKey++ as CommentThreadReviewDispatchKey
      const state: CommentThreadReviewState = {
        ...currentState,
        pending: {
          kind: action.resolved ? "resolve" : "reopen",
          key
        },
        failure: null
      }
      currentState = state
      return {
        type: "dispatch",
        state,
        key,
        commands: [CanvasCommand.setCommentThreadResolved({
          id: state.threadId,
          actor: currentAuthor,
          resolved: action.resolved,
          at: input.clock.now()
        })]
      }
    }
    if (action.type !== "submit") return blocked("comment-forbidden")

    const body = action.body.trim()
    if (body.length === 0) return blocked("empty-comment")

    const key = nextDispatchKey++ as CommentThreadReviewDispatchKey
    const message = {
      id: input.ids.commentId(),
      body,
      author: currentAuthor,
      createdAt: input.clock.now(),
      editedAt: null
    }
    if (currentState.kind === "thread") {
      const state: CommentThreadReviewState = {
        ...currentState,
        pending: { kind: "reply", key },
        failure: null
      }
      currentState = state
      return {
        type: "dispatch",
        state,
        key,
        commands: [CanvasCommand.replyToCommentThread({
          id: state.threadId,
          reply: message
        })]
      }
    }

    const state: CommentThreadReviewState = {
      ...currentState,
      pending: { kind: "create", key },
      failure: null
    }
    currentState = state
    return {
      type: "dispatch",
      state,
      key,
      commands: [CanvasCommand.addCommentThread({
        id: input.ids.commentThreadId(),
        frameId: currentState.frameId,
        anchor: currentState.anchor,
        opening: message
      })]
    }
  }

  const settle: CommentThreadReview["settle"] = (key, outcome) => {
    if (currentState.kind === "idle" || currentState.pending?.key !== key) {
      return changed(currentState)
    }
    const pending = currentState.pending
    if (outcome.type === "rejected") {
      return changed({
        ...currentState,
        pending: null,
        failure: {
          reason: outcome.cause.reason,
          detail: outcome.cause.detail
        }
      })
    }
    if (pending.kind === "create") return changed(idle(), "composer")
    return changed(
      { ...currentState, pending: null, failure: null },
      pending.kind === "reply"
        ? "composer"
        : pending.kind === "edit" ? "editing" : undefined
    )
  }

  return {
    state: () => currentState,
    reconcile,
    focus,
    perform,
    settle
  }
}
