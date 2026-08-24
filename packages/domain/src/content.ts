import { Schema } from "effect"

import { CommentAnchor } from "./anchor.js"
import { Geometry } from "./geometry.js"
import { ActorSnapshot } from "./identity.js"
import { ChangeId, CommentId, CommentThreadId, FrameId, NoteId } from "./ids.js"
import { RepresentationRef } from "./representation.js"
import { NonBlankString } from "./text.js"

export const AuthoredText = NonBlankString
export type AuthoredText = typeof AuthoredText.Type
export const ReviewStatus = Schema.Literals(["in-progress", "ready-for-review", "approved", "changes-requested"])
export type ReviewStatus = typeof ReviewStatus.Type
export const NoteColor = Schema.Literals(["neutral", "red", "orange", "green", "blue", "purple"])
export type NoteColor = typeof NoteColor.Type

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
  author: ActorSnapshot,
  color: NoteColor,
  geometry: Geometry,
  attachedFrameId: Schema.NullOr(FrameId),
  createdByChangeId: ChangeId,
  updatedByChangeId: ChangeId,
  textChangedByChangeId: ChangeId,
  colorChangedByChangeId: ChangeId,
  geometryChangedByChangeId: ChangeId,
  attachmentChangedByChangeId: ChangeId
})
export type Note = typeof Note.Type

export const Comment = Schema.Struct({
  commentId: CommentId,
  body: AuthoredText,
  author: ActorSnapshot,
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

export const FrameItemRef = Schema.TaggedStruct("frame", { frameId: FrameId })
export const NoteItemRef = Schema.TaggedStruct("note", { noteId: NoteId })
export const CanvasItemRef = Schema.Union([FrameItemRef, NoteItemRef])
export type CanvasItemRef = typeof CanvasItemRef.Type
