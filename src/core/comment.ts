import { Schema } from "effect"

const Ratio = Schema.Finite.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(1)
)

export const Author = Schema.Struct({
  id: Schema.String,
  name: Schema.String
})
export type Author = typeof Author.Type

export const CommentMessage = Schema.Struct({
  id: Schema.String,
  body: Schema.String,
  author: Author,
  createdAt: Schema.String,
  editedAt: Schema.NullOr(Schema.String)
})
export type CommentMessage = typeof CommentMessage.Type

export const FrameCommentAnchor = Schema.Struct({
  kind: Schema.Literal("frame"),
  xRatio: Ratio,
  yRatio: Ratio
})
export type FrameCommentAnchor = typeof FrameCommentAnchor.Type

export const ElementFingerprint = Schema.Struct({
  tagName: Schema.String,
  id: Schema.optionalKey(Schema.String),
  testId: Schema.optionalKey(Schema.String),
  ariaLabel: Schema.optionalKey(Schema.String),
  text: Schema.optionalKey(Schema.String)
})
export type ElementFingerprint = typeof ElementFingerprint.Type

export const ElementCommentAnchor = Schema.Struct({
  kind: Schema.Literal("element"),
  documentUrl: Schema.String,
  selector: Schema.String,
  fingerprint: ElementFingerprint,
  xRatio: Ratio,
  yRatio: Ratio
})
export type ElementCommentAnchor = typeof ElementCommentAnchor.Type

export const CommentAnchor = Schema.Union([
  FrameCommentAnchor,
  ElementCommentAnchor
])
export type CommentAnchor = typeof CommentAnchor.Type

export const CanvasCommentThread = Schema.Struct({
  id: Schema.String,
  frameId: Schema.String,
  anchor: CommentAnchor,
  opening: CommentMessage,
  replies: Schema.Array(CommentMessage),
  resolvedAt: Schema.NullOr(Schema.String),
  resolvedBy: Schema.NullOr(Author)
})
export type CanvasCommentThread = typeof CanvasCommentThread.Type

export const canManageCommentThread = (
  owner: Author | null,
  thread: CanvasCommentThread,
  actorId: string
) => owner?.id === actorId || thread.opening.author.id === actorId

export const commentMessageById = (
  thread: CanvasCommentThread,
  messageId: string
) => thread.opening.id === messageId
  ? thread.opening
  : thread.replies.find((reply) => reply.id === messageId)
