import { Schema } from "effect"

import { CanvasItemRef, CommentThread, Frame, Note } from "./content.js"
import { isCanonicalIdOrder } from "./canonical-order.js"
import { CanvasId, ChangeId, CommentId, CommentThreadId, FrameId, NoteId } from "./ids.js"
import { NonBlankString } from "./text.js"

export const CanvasTitle = NonBlankString
export type CanvasTitle = typeof CanvasTitle.Type

const IssuedIds = Schema.Struct({
  frameIds: Schema.Array(FrameId),
  noteIds: Schema.Array(NoteId),
  threadIds: Schema.Array(CommentThreadId),
  commentIds: Schema.Array(CommentId)
})

const CanvasProjectionFields = Schema.Struct({
  schemaVersion: Schema.Literal(2),
  canvasId: CanvasId,
  title: CanvasTitle,
  frames: Schema.Array(Frame),
  notes: Schema.Array(Note),
  threads: Schema.Array(CommentThread),
  stack: Schema.Array(CanvasItemRef),
  stackChangedByChangeId: Schema.NullOr(ChangeId),
  issuedIds: IssuedIds
})

const itemKey = (item: CanvasItemRef) => item._tag === "frame"
  ? `frame:${item.frameId}`
  : `note:${item.noteId}`
const projectionFailure = (projection: typeof CanvasProjectionFields.Type) => {
  const frameIds = projection.frames.map((frame) => frame.frameId)
  const noteIds = projection.notes.map((note) => note.noteId)
  const threadIds = projection.threads.map((thread) => thread.threadId)
  const commentIds = projection.threads.flatMap((thread) => thread.comments.map((comment) => comment.commentId))
  if (![frameIds, noteIds, threadIds, projection.issuedIds.frameIds,
    projection.issuedIds.noteIds, projection.issuedIds.threadIds,
    projection.issuedIds.commentIds].every(isCanonicalIdOrder) ||
    new Set(commentIds).size !== commentIds.length) {
    return "Entity and issued ID collections must be sorted and unique"
  }
  const issuedFrameIds = new Set(projection.issuedIds.frameIds)
  const issuedNoteIds = new Set(projection.issuedIds.noteIds)
  const issuedThreadIds = new Set(projection.issuedIds.threadIds)
  const issuedCommentIds = new Set(projection.issuedIds.commentIds)
  if (!frameIds.every((id) => issuedFrameIds.has(id)) ||
      !noteIds.every((id) => issuedNoteIds.has(id)) ||
      !threadIds.every((id) => issuedThreadIds.has(id)) ||
      !commentIds.every((id) => issuedCommentIds.has(id))) {
    return "Every active ID must have been issued"
  }
  const activeItems = new Set<string>()
  for (const id of frameIds) activeItems.add(`frame:${id}`)
  for (const id of noteIds) activeItems.add(`note:${id}`)
  const stackItems = new Set<string>()
  for (const item of projection.stack) {
    const key = itemKey(item)
    if (!activeItems.has(key) || stackItems.has(key)) {
      return "Stack must contain each active Frame and Note exactly once"
    }
    stackItems.add(key)
  }
  if (activeItems.size !== stackItems.size) {
    return "Stack must contain each active Frame and Note exactly once"
  }
  if (projection.stack.length > 0 && projection.stackChangedByChangeId === null) {
    return "A non-empty stack must have change provenance"
  }
  const activeFrameIds = new Set(frameIds)
  if (projection.notes.some((note) => note.attachedFrameId !== null && !activeFrameIds.has(note.attachedFrameId))) {
    return "A Note attachment must reference an active Frame"
  }
  for (const thread of projection.threads) {
    if (!activeFrameIds.has(thread.anchor.frameId)) return "A comment anchor must reference an active Frame"
  }
  return undefined
}

export const CanvasProjection = CanvasProjectionFields.check(
  Schema.makeFilter<typeof CanvasProjectionFields.Type>(projectionFailure)
)
export type CanvasProjection = typeof CanvasProjection.Type

export const decodeCanvasProjection = (input: Schema.Json): CanvasProjection =>
  Schema.decodeUnknownSync(CanvasProjection, { onExcessProperty: "error" })(input)

export const emptyCanvasProjection = (canvasId: CanvasId, title: CanvasTitle): CanvasProjection => ({
  schemaVersion: 2,
  canvasId,
  title,
  frames: [], notes: [], threads: [], stack: [], stackChangedByChangeId: null,
  issuedIds: { frameIds: [], noteIds: [], threadIds: [], commentIds: [] }
})
