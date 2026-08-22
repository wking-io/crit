import { Schema } from "effect"

import { CanvasItemRef, CommentThread, Frame, Note } from "./content.js"
import { isCanonicalIdOrder } from "./canonical-order.js"
import { CanvasId, ChangeId, CommentId, CommentThreadId, FrameId, NoteId } from "./ids.js"

export const CanvasTitle = Schema.Trimmed.check(Schema.isNonEmpty())
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
  if (!frameIds.every((id) => projection.issuedIds.frameIds.includes(id)) ||
      !noteIds.every((id) => projection.issuedIds.noteIds.includes(id)) ||
      !threadIds.every((id) => projection.issuedIds.threadIds.includes(id)) ||
      !commentIds.every((id) => projection.issuedIds.commentIds.includes(id))) {
    return "Every active ID must have been issued"
  }
  const activeItems = [...frameIds.map((id) => `frame:${id}`), ...noteIds.map((id) => `note:${id}`)].sort()
  const stackItems = projection.stack.map(itemKey)
  if (new Set(stackItems).size !== stackItems.length ||
      activeItems.length !== stackItems.length ||
      !activeItems.every((id) => stackItems.includes(id))) {
    return "Stack must contain each active Frame and Note exactly once"
  }
  if (projection.stack.length > 0 && projection.stackChangedByChangeId === null) {
    return "A non-empty stack must have change provenance"
  }
  const frameById = new Map(projection.frames.map((frame) => [frame.frameId, frame]))
  if (projection.notes.some((note) => note.attachedFrameId !== null && !frameById.has(note.attachedFrameId))) {
    return "A Note attachment must reference an active Frame"
  }
  for (const thread of projection.threads) {
    const frame = frameById.get(thread.anchor.frameId)
    if (frame === undefined) return "A comment anchor must reference an active Frame"
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
