import { Schema } from "effect"

import { CommentAnchor } from "./anchor.js"
import { Geometry } from "./geometry.js"
import { ChangeId, CommentId, CommentThreadId, FrameId, NoteId } from "./ids.js"
import { RepresentationRef } from "./representation.js"

export const AuthoredText = Schema.Trimmed.check(Schema.isNonEmpty())
export type AuthoredText = typeof AuthoredText.Type
export const ReviewStatus = Schema.Literals(["in-progress", "ready-for-review", "approved", "changes-requested"])
export type ReviewStatus = typeof ReviewStatus.Type

export const Frame = Schema.Struct({
  frameId: FrameId,
  title: AuthoredText,
  representation: RepresentationRef,
  status: ReviewStatus,
  geometry: Geometry,
  createdByChangeId: ChangeId,
  updatedByChangeId: ChangeId,
  titleChangedByChangeId: ChangeId,
  representationChangedByChangeId: ChangeId,
  statusChangedByChangeId: ChangeId,
  geometryChangedByChangeId: ChangeId
})
export type Frame = typeof Frame.Type

export const Note = Schema.Struct({
  noteId: NoteId,
  text: AuthoredText,
  geometry: Geometry,
  attachedFrameId: Schema.NullOr(FrameId),
  createdByChangeId: ChangeId,
  updatedByChangeId: ChangeId,
  textChangedByChangeId: ChangeId,
  geometryChangedByChangeId: ChangeId,
  attachmentChangedByChangeId: ChangeId
})
export type Note = typeof Note.Type

export const Comment = Schema.Struct({
  commentId: CommentId,
  body: AuthoredText,
  createdByChangeId: ChangeId,
  bodyChangedByChangeId: ChangeId
})
export type Comment = typeof Comment.Type

export const CommentThread = Schema.Struct({
  threadId: CommentThreadId,
  anchor: CommentAnchor,
  resolved: Schema.Boolean,
  comments: Schema.NonEmptyArray(Comment),
  createdByChangeId: ChangeId,
  updatedByChangeId: ChangeId,
  anchorChangedByChangeId: ChangeId,
  resolutionChangedByChangeId: ChangeId
})
export type CommentThread = typeof CommentThread.Type

export const CanvasItemRef = Schema.Union([
  Schema.TaggedStruct("frame", { frameId: FrameId }),
  Schema.TaggedStruct("note", { noteId: NoteId })
])
export type CanvasItemRef = typeof CanvasItemRef.Type
