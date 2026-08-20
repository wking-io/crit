import { Effect, Match, Schema } from "effect"

import {
  CanvasCommandSchema,
  FrameDisplay,
  FrameProvenance,
  NoteColorFamily,
  PositiveDimension,
  SnapshotArtifact,
  FrameStatus,
  type CanvasCommand as CanvasCommandInput
} from "./canvas-command.js"
import {
  Author,
  CanvasCommentThread,
  canEditComment,
  canManageCommentThread,
  commentMessageById
} from "./comment.js"
import { causeMessage } from "../internal/cause-message.js"

const CanvasTypeId: unique symbol = Symbol.for("@riff-refine/crit/Canvas")
const NonNegativeInteger = Schema.Finite.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0)
)

export const MAX_CANVAS_DOCUMENT_BYTES = 10_000_000

export interface Canvas {
  readonly [CanvasTypeId]: typeof CanvasTypeId
}

export const CanvasGeometry = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
  width: PositiveDimension,
  height: PositiveDimension
})
export type CanvasGeometry = typeof CanvasGeometry.Type

export const CanvasFrame = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  title: Schema.String,
  status: FrameStatus,
  provenance: FrameProvenance,
  display: FrameDisplay,
  geometry: CanvasGeometry,
  zIndex: Schema.Finite.check(Schema.isInt()),
  snapshot: Schema.optional(SnapshotArtifact)
})
export type CanvasFrame = typeof CanvasFrame.Type

export const CanvasNote = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  author: Author,
  geometry: CanvasGeometry,
  attachedTo: Schema.NullOr(Schema.String),
  zIndex: Schema.Finite.check(Schema.isInt()),
  color: NoteColorFamily.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("blue" as const))
  )
})
export type CanvasNote = typeof CanvasNote.Type

export const CanvasDocument = Schema.Struct({
  format: Schema.Literal("crit-canvas"),
  version: Schema.Literal(1),
  id: Schema.String,
  title: Schema.String,
  revision: NonNegativeInteger,
  frames: Schema.Array(CanvasFrame),
  notes: Schema.Array(CanvasNote),
  owner: Author,
  comments: Schema.Array(CanvasCommentThread).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([]))
  ),
  removedFrameIds: Schema.Array(Schema.String).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([]))
  )
})
export type CanvasDocument = typeof CanvasDocument.Type
export type CanvasOpenInput = Schema.Json | CanvasDocument

export const CanvasSummary = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  revision: NonNegativeInteger,
  frameCount: NonNegativeInteger,
  noteCount: NonNegativeInteger,
  activeCommentCount: NonNegativeInteger,
  resolvedCommentCount: NonNegativeInteger,
  statuses: Schema.Struct({
    inProgress: NonNegativeInteger,
    readyForReview: NonNegativeInteger,
    approved: NonNegativeInteger,
    changesRequested: NonNegativeInteger,
    archived: NonNegativeInteger
  })
})
export type CanvasSummary = typeof CanvasSummary.Type

export const FrameList = Schema.Array(CanvasFrame)
export type FrameList = typeof FrameList.Type

export const NoteList = Schema.Array(CanvasNote)
export type NoteList = typeof NoteList.Type

export const CommentThreadSummary = CanvasCommentThread
export type CommentThreadSummary = CanvasCommentThread
export const CommentThreadList = Schema.Array(CommentThreadSummary)
export type CommentThreadList = typeof CommentThreadList.Type

export const CanvasChange = Schema.Struct({
  commandCount: NonNegativeInteger,
  changedFrameIds: Schema.Array(Schema.String),
  changedNoteIds: Schema.Array(Schema.String),
  changedCommentThreadIds: Schema.Array(Schema.String)
})
export type CanvasChange = typeof CanvasChange.Type

export class CanvasOpenFailed extends Schema.TaggedError<CanvasOpenFailed>()(
  "CanvasOpenFailed",
  {
    reason: Schema.Union([
      Schema.Literal("invalid-envelope"),
      Schema.Literal("invalid-document")
    ]),
    detail: Schema.String
  }
) {}

export class CanvasDocumentTooLarge extends Schema.TaggedError<CanvasDocumentTooLarge>()(
  "CanvasDocumentTooLarge",
  {
    actualBytes: Schema.Number,
    maxBytes: Schema.Number,
    detail: Schema.String
  }
) {}

export class CanvasCommandFailed extends Schema.TaggedError<CanvasCommandFailed>()(
  "CanvasCommandFailed",
  {
    reason: Schema.Union([
      Schema.Literal("invalid-command"),
      Schema.Literal("duplicate-frame"),
      Schema.Literal("frame-not-found"),
      Schema.Literal("duplicate-note"),
      Schema.Literal("note-not-found"),
      Schema.Literal("note-conflict"),
      Schema.Literal("note-forbidden"),
      Schema.Literal("duplicate-comment-thread"),
      Schema.Literal("comment-thread-not-found"),
      Schema.Literal("comment-not-found"),
      Schema.Literal("comment-conflict"),
      Schema.Literal("comment-forbidden"),
      Schema.Literal("archived-frame-comments-unsupported"),
      Schema.Literal("snapshot-source-changed"),
      Schema.Literal("snapshot-source-invalid"),
      Schema.Literal("snapshot-frame-immutable"),
      Schema.Literal("invalid-canvas"),
      Schema.Literal("apply-failed")
    ]),
    detail: Schema.String
  }
) {}

export class FrameNotFound extends Schema.TaggedError<FrameNotFound>()(
  "FrameNotFound",
  { id: Schema.String }
) {}

export class NoteNotFound extends Schema.TaggedError<NoteNotFound>()(
  "NoteNotFound",
  { id: Schema.String }
) {}

export class CommentThreadNotFound extends Schema.TaggedError<CommentThreadNotFound>()(
  "CommentThreadNotFound",
  { id: Schema.String }
) {}

type CanvasState = {
  readonly id: string
  title: string
  revision: number
  frames: Array<CanvasFrame>
  notes: Array<CanvasNote>
  owner: Author
  comments: Array<CanvasCommentThread>
  removedFrameIds: Array<string>
}

const states = new WeakMap<object, CanvasState>()

const clone = <A>(value: A): A => structuredClone(value)

const rememberRemovedFrame = (draft: CanvasState, id: string) => {
  if (!draft.removedFrameIds.includes(id)) draft.removedFrameIds.push(id)
}

const forgetRemovedFrame = (draft: CanvasState, id: string) => {
  draft.removedFrameIds = draft.removedFrameIds.filter((item) => item !== id)
}

class CanvasHandle implements Canvas {
  readonly [CanvasTypeId]: typeof CanvasTypeId = CanvasTypeId
}

const makeCanvas = (state: CanvasState): Canvas => {
  const handle = Object.freeze(new CanvasHandle())
  states.set(handle, state)
  return handle
}

const stateOf = (canvas: Canvas): CanvasState => {
  const state = states.get(canvas)
  if (state === undefined) {
    throw new TypeError("Canvas was not created by @riff-refine/crit")
  }
  return state
}

const documentOf = (state: CanvasState): CanvasDocument => ({
  format: "crit-canvas",
  version: 1,
  id: state.id,
  title: state.title,
  revision: state.revision,
  frames: clone(state.frames),
  notes: clone(state.notes),
  owner: clone(state.owner),
  comments: clone(state.comments),
  removedFrameIds: [...state.removedFrameIds]
})

export const CanvasInternals = {
  setRevision: (canvas: Canvas, revision: number) => {
    stateOf(canvas).revision = revision
  },
  adoptDocument: (canvas: Canvas, incoming: Canvas) => {
    const target = stateOf(canvas)
    const source = stateOf(incoming)
    if (target.id !== source.id) {
      throw new TypeError(
        `Cannot adopt Canvas ${source.id} into Canvas ${target.id}`
      )
    }
    target.title = source.title
    target.revision = source.revision
    target.frames = clone(source.frames)
    target.notes = clone(source.notes)
    target.owner = clone(source.owner)
    target.comments = clone(source.comments)
    target.removedFrameIds = [...source.removedFrameIds]
  }
} as const

const create = (input: {
  readonly id: string
  readonly title: string
  readonly owner: Author
}): Canvas =>
  makeCanvas({
    id: input.id,
    title: input.title,
    revision: 0,
    frames: [],
    notes: [],
    owner: clone(input.owner),
    comments: [],
    removedFrameIds: []
  })

const encodedBytes = (input: CanvasOpenInput) => {
  const serialized = JSON.stringify(input)
  if (serialized === undefined) throw new TypeError("Value is not JSON serializable")
  return new TextEncoder().encode(serialized).byteLength
}

const validateDocument = (document: CanvasDocument) => {
  if (
    document.owner.id.trim().length === 0 ||
    document.owner.name.trim().length === 0
  ) {
    throw new Error("Canvas Owner is invalid")
  }
  const ids = new Set<string>()
  for (const frame of document.frames) {
    if (frame.id.trim().length === 0) throw new Error("Frame IDs cannot be empty")
    if (ids.has(frame.id)) throw new Error(`Duplicate Canvas item ID: ${frame.id}`)
    if (frame.snapshot === undefined) {
      if (frame.status === "archived" || frame.provenance.kind === "snapshot") {
        throw new Error(`Live Frame ${frame.id} cannot be archived or use snapshot provenance`)
      }
    } else if (
      frame.status !== "archived" ||
      frame.provenance.kind !== "snapshot" ||
      frame.provenance.sourceId.trim().length === 0
    ) {
      throw new Error(`Snapshot Frame ${frame.id} has inconsistent archive metadata`)
    }
    ids.add(frame.id)
  }
  for (const note of document.notes) {
    if (note.id.trim().length === 0) throw new Error("Note IDs cannot be empty")
    if (ids.has(note.id)) throw new Error(`Duplicate Canvas item ID: ${note.id}`)
    ids.add(note.id)
    if (note.author.id.trim().length === 0 || note.author.name.trim().length === 0) {
      throw new Error(`Note ${note.id} has an invalid Author`)
    }
    if (
      note.attachedTo !== null &&
      !document.frames.some((frame) => frame.id === note.attachedTo)
    ) {
      throw new Error(
        `Note ${note.id} is attached to missing Frame ${note.attachedTo}`
      )
    }
  }
  const messageIds = new Set<string>()
  for (const thread of document.comments) {
    if (thread.id.trim().length === 0) throw new Error("Comment Thread IDs cannot be empty")
    if (ids.has(thread.id)) throw new Error(`Duplicate Canvas item ID: ${thread.id}`)
    ids.add(thread.id)
    const frame = document.frames.find((candidate) => candidate.id === thread.frameId)
    if (frame === undefined) {
      throw new Error(`Comment Thread ${thread.id} targets missing Frame ${thread.frameId}`)
    }
    if (frame.snapshot !== undefined) {
      throw new Error(`Archived Frame ${thread.frameId} cannot contain Comment Threads`)
    }
    for (const message of [thread.opening, ...thread.replies]) {
      if (message.id.trim().length === 0) throw new Error("Comment IDs cannot be empty")
      if (messageIds.has(message.id)) throw new Error(`Duplicate Comment ID: ${message.id}`)
      messageIds.add(message.id)
      if (message.author.id.trim().length === 0 || message.author.name.trim().length === 0) {
        throw new Error(`Comment ${message.id} has an invalid Author`)
      }
    }
    if ((thread.resolvedAt === null) !== (thread.resolvedBy === null)) {
      throw new Error(`Comment Thread ${thread.id} has inconsistent resolution metadata`)
    }
  }
  return document
}

const fromDocument = (document: CanvasDocument): Canvas => {
  const validated = validateDocument(document)
  return makeCanvas({
    id: validated.id,
    title: validated.title,
    revision: validated.revision,
    frames: clone(Array.from(validated.frames)),
    notes: clone(Array.from(validated.notes)),
    owner: clone(validated.owner),
    comments: clone(Array.from(validated.comments)),
    removedFrameIds: [...validated.removedFrameIds]
  })
}

const documentTooLarge = (actualBytes: number) =>
  new CanvasDocumentTooLarge({
    actualBytes,
    maxBytes: MAX_CANVAS_DOCUMENT_BYTES,
    detail: `Canvas Document is ${actualBytes} bytes; maximum is ${MAX_CANVAS_DOCUMENT_BYTES}`
  })

const open = (
  input: CanvasOpenInput
): Effect.Effect<Canvas, CanvasOpenFailed | CanvasDocumentTooLarge> =>
  Effect.gen(function*() {
    const actualBytes = yield* Effect.try({
      try: () => encodedBytes(input),
      catch: (cause) =>
        new CanvasOpenFailed({
          reason: "invalid-envelope",
          detail: causeMessage(cause)
        })
    })
    if (actualBytes > MAX_CANVAS_DOCUMENT_BYTES) {
      return yield* documentTooLarge(actualBytes)
    }

    const document = yield* Schema.decodeUnknownEffect(CanvasDocument)(input).pipe(
      Effect.mapError(
        (cause) =>
          new CanvasOpenFailed({
            reason: "invalid-envelope",
            detail: String(cause)
          })
      )
    )
    return yield* Effect.try({
      try: () => fromDocument(document),
      catch: (cause) =>
        new CanvasOpenFailed({
          reason: "invalid-document",
          detail: causeMessage(cause)
        })
    })
  })

const exportCanvas = (canvas: Canvas): CanvasDocument => {
  const exported = documentOf(stateOf(canvas))
  const actualBytes = encodedBytes(exported)
  if (actualBytes > MAX_CANVAS_DOCUMENT_BYTES) {
    throw documentTooLarge(actualBytes)
  }
  return exported
}

const summarize = (canvas: Canvas): CanvasSummary => {
  const state = stateOf(canvas)
  const statuses = {
    inProgress: 0,
    readyForReview: 0,
    approved: 0,
    changesRequested: 0,
    archived: 0
  }
  for (const frame of state.frames) {
    if (frame.status === "in-progress") statuses.inProgress += 1
    if (frame.status === "ready-for-review") statuses.readyForReview += 1
    if (frame.status === "approved") statuses.approved += 1
    if (frame.status === "changes-requested") statuses.changesRequested += 1
    if (frame.status === "archived") statuses.archived += 1
  }
  return {
    id: state.id,
    title: state.title,
    revision: state.revision,
    frameCount: state.frames.length,
    noteCount: state.notes.length,
    activeCommentCount: state.comments.filter((thread) => thread.resolvedAt === null).length,
    resolvedCommentCount: state.comments.filter((thread) => thread.resolvedAt !== null).length,
    statuses
  }
}

const ordered = <A extends { readonly id: string; readonly zIndex: number }>(
  values: ReadonlyArray<A>
) =>
  [...values].sort(
    (left, right) => left.zIndex - right.zIndex || left.id.localeCompare(right.id)
  )

const listFrames = (canvas: Canvas): FrameList =>
  clone(ordered(stateOf(canvas).frames))

const listNotes = (canvas: Canvas): NoteList =>
  clone(ordered(stateOf(canvas).notes))

const listCommentThreads = (canvas: Canvas): CommentThreadList =>
  clone(stateOf(canvas).comments)

const getFrame = (
  canvas: Canvas,
  id: string
): Effect.Effect<CanvasFrame, FrameNotFound> => {
  const frame = stateOf(canvas).frames.find((candidate) => candidate.id === id)
  return frame === undefined
    ? Effect.fail(new FrameNotFound({ id }))
    : Effect.succeed(clone(frame))
}

const getNote = (
  canvas: Canvas,
  id: string
): Effect.Effect<CanvasNote, NoteNotFound> => {
  const note = stateOf(canvas).notes.find((candidate) => candidate.id === id)
  return note === undefined
    ? Effect.fail(new NoteNotFound({ id }))
    : Effect.succeed(clone(note))
}

const getCommentThread = (
  canvas: Canvas,
  id: string
): Effect.Effect<CommentThreadSummary, CommentThreadNotFound> => {
  const thread = stateOf(canvas).comments.find((candidate) => candidate.id === id)
  return thread === undefined
    ? Effect.fail(new CommentThreadNotFound({ id }))
    : Effect.succeed(clone(thread))
}

const nextZIndex = (state: CanvasState) =>
  Math.max(
    0,
    ...state.frames.map((frame) => frame.zIndex),
    ...state.notes.map((note) => note.zIndex)
  ) + 1

const previousZIndex = (state: CanvasState) =>
  Math.min(
    0,
    ...state.frames.map((frame) => frame.zIndex),
    ...state.notes.map((note) => note.zIndex)
  ) - 1

type CanvasCommand<Tag extends CanvasCommandInput["_tag"]> = Extract<
  CanvasCommandInput,
  { readonly _tag: Tag }
>

type FrameMutationCommand = CanvasCommand<
  | "SetFrameStatus"
  | "SetFrameSource"
  | "SetFrameTitle"
  | "SetFrameDisplay"
  | "MoveFrame"
  | "ResizeFrame"
  | "BringFrameToFront"
  | "SendFrameToBack"
  | "RemoveFrame"
>

type NoteMutationCommand = CanvasCommand<
  | "EditNote"
  | "SetNoteColor"
  | "MoveNote"
  | "ResizeNote"
  | "BringNoteToFront"
  | "SendNoteToBack"
  | "AttachNote"
  | "DetachNote"
  | "RemoveNote"
>

type CommentMutationCommand = CanvasCommand<
  | "ReplyToCommentThread"
  | "EditComment"
  | "SetCommentThreadResolved"
  | "UpdateCommentAnchor"
>

type CanvasMutationContext = {
  readonly draft: CanvasState
  readonly markFrame: (id: string) => void
  readonly markNote: (id: string) => void
  readonly markCommentThread: (id: string) => void
  readonly frameAt: (id: string) => number
  readonly noteAt: (id: string) => number
  readonly commentThreadAt: (id: string) => number
}

const canvasItemExists = (context: CanvasMutationContext, id: string) =>
  context.draft.frames.some((frame) => frame.id === id) ||
  context.draft.notes.some((note) => note.id === id) ||
  context.draft.comments.some((thread) => thread.id === id)

const applyRenameCanvas = (
  context: CanvasMutationContext,
  command: CanvasCommand<"RenameCanvas">
) => {
  if (command.title.trim().length === 0) {
    throw new CanvasCommandFailed({
      reason: "invalid-command",
      detail: "A Canvas title cannot be empty"
    })
  }
  context.draft.title = command.title
}

const applyAddFrame = (
  context: CanvasMutationContext,
  command: CanvasCommand<"AddFrame">
) => {
  if (canvasItemExists(context, command.id)) {
    throw new CanvasCommandFailed({
      reason: "duplicate-frame",
      detail: `Canvas item already exists: ${command.id}`
    })
  }
  if (command.provenance.kind === "snapshot") {
    throw new CanvasCommandFailed({
      reason: "snapshot-source-invalid",
      detail: "Snapshot Frames must be created by AddSnapshotFrame"
    })
  }
  const frameNumber = context.draft.frames.length
  context.draft.frames.push({
    id: command.id,
    url: command.url,
    title: command.title,
    status: command.status,
    provenance: command.provenance,
    display: { heightMode: "viewport" },
    geometry: {
      x: (frameNumber % 3) * 1240,
      y: Math.floor(frameNumber / 3) * 840,
      width: 1200,
      height: 800
    },
    zIndex: nextZIndex(context.draft)
  })
  forgetRemovedFrame(context.draft, command.id)
  context.markFrame(command.id)
}

const applyAddSnapshotFrame = (
  context: CanvasMutationContext,
  command: CanvasCommand<"AddSnapshotFrame">
) => {
  if (canvasItemExists(context, command.id)) {
    throw new CanvasCommandFailed({
      reason: "duplicate-frame",
      detail: `Canvas item already exists: ${command.id}`
    })
  }
  const source = context.draft.frames.find(
    (frame) => frame.id === command.sourceFrameId
  )
  if (source === undefined || source.snapshot !== undefined) {
    throw new CanvasCommandFailed({
      reason: "snapshot-source-invalid",
      detail: `Snapshot source must be a live Frame: ${command.sourceFrameId}`
    })
  }
  if (source.url !== command.expectedSourceUrl) {
    throw new CanvasCommandFailed({
      reason: "snapshot-source-changed",
      detail: `Frame ${command.sourceFrameId} changed URL while its snapshot was captured`
    })
  }
  if (command.artifact.sourceUrl !== command.expectedSourceUrl) {
    throw new CanvasCommandFailed({
      reason: "snapshot-source-invalid",
      detail: "Snapshot artifact source URL does not match the captured Frame URL"
    })
  }
  context.draft.frames.push({
    id: command.id,
    url: command.url,
    title: source.title,
    status: "archived",
    provenance: { kind: "snapshot", sourceId: source.id },
    display: source.display,
    geometry: {
      ...source.geometry,
      x: source.geometry.x + source.geometry.width + 40
    },
    zIndex: nextZIndex(context.draft),
    snapshot: command.artifact
  })
  forgetRemovedFrame(context.draft, command.id)
  context.markFrame(command.id)
}

const applyAddNote = (
  context: CanvasMutationContext,
  command: CanvasCommand<"AddNote">
) => {
  if (canvasItemExists(context, command.id)) {
    throw new CanvasCommandFailed({
      reason: "duplicate-note",
      detail: `Canvas item already exists: ${command.id}`
    })
  }
  if (
    command.author.id.trim().length === 0 ||
    command.author.name.trim().length === 0
  ) {
    throw new CanvasCommandFailed({
      reason: "invalid-command",
      detail: "A Note Author requires a non-empty ID and name"
    })
  }
  context.draft.notes.push({
    id: command.id,
    text: command.text,
    author: command.author,
    geometry: {
      x: command.x,
      y: command.y,
      width: command.width,
      height: command.height
    },
    attachedTo: null,
    zIndex: nextZIndex(context.draft),
    color: command.color
  })
  context.markNote(command.id)
}

const applyFrameMutation = (
  context: CanvasMutationContext,
  command: FrameMutationCommand
) => {
  const index = context.frameAt(command.id)
  const frame = context.draft.frames[index]!
  Match.valueTags(command, {
    SetFrameStatus: (status) => {
      if (frame.snapshot !== undefined) {
        throw new CanvasCommandFailed({
          reason: "snapshot-frame-immutable",
          detail: `Snapshot Frame content is immutable: ${frame.id}`
        })
      }
      context.draft.frames[index] = { ...frame, status: status.status }
    },
    SetFrameSource: (source) => {
      if (frame.snapshot !== undefined) {
        throw new CanvasCommandFailed({
          reason: "snapshot-frame-immutable",
          detail: `Snapshot Frame content is immutable: ${frame.id}`
        })
      }
      if (source.provenance.kind === "snapshot") {
        throw new CanvasCommandFailed({
          reason: "snapshot-source-invalid",
          detail: "Live Frames cannot use snapshot provenance"
        })
      }
      context.draft.frames[index] = {
        ...frame,
        url: source.url,
        provenance: source.provenance
      }
    },
    SetFrameTitle: (title) => {
      context.draft.frames[index] = { ...frame, title: title.title }
    },
    SetFrameDisplay: (display) => {
      context.draft.frames[index] = { ...frame, display: display.display }
    },
    MoveFrame: (move) => {
      const deltaX = move.x - frame.geometry.x
      const deltaY = move.y - frame.geometry.y
      context.draft.frames[index] = {
        ...frame,
        geometry: { ...frame.geometry, x: move.x, y: move.y }
      }
      context.draft.notes = context.draft.notes.map((note) => {
        if (note.attachedTo !== move.id) return note
        context.markNote(note.id)
        return {
          ...note,
          geometry: {
            ...note.geometry,
            x: note.geometry.x + deltaX,
            y: note.geometry.y + deltaY
          }
        }
      })
    },
    ResizeFrame: (resize) => {
      context.draft.frames[index] = {
        ...frame,
        geometry: {
          ...frame.geometry,
          width: resize.width,
          height: resize.height
        }
      }
    },
    BringFrameToFront: () => {
      context.draft.frames[index] = {
        ...frame,
        zIndex: nextZIndex(context.draft)
      }
    },
    SendFrameToBack: () => {
      context.draft.frames[index] = {
        ...frame,
        zIndex: previousZIndex(context.draft)
      }
    },
    RemoveFrame: (removal) => {
      context.draft.frames.splice(index, 1)
      rememberRemovedFrame(context.draft, removal.id)
      context.draft.notes = context.draft.notes.map((note) => {
        if (note.attachedTo !== removal.id) return note
        context.markNote(note.id)
        return { ...note, attachedTo: null }
      })
      const removedThreads = context.draft.comments.filter(
        (thread) => thread.frameId === removal.id
      )
      context.draft.comments = context.draft.comments.filter(
        (thread) => thread.frameId !== removal.id
      )
      for (const thread of removedThreads) context.markCommentThread(thread.id)
    }
  })
  context.markFrame(command.id)
}

const applyAddCommentThread = (
  context: CanvasMutationContext,
  command: CanvasCommand<"AddCommentThread">
) => {
  if (canvasItemExists(context, command.id)) {
    throw new CanvasCommandFailed({
      reason: "duplicate-comment-thread",
      detail: `Canvas item already exists: ${command.id}`
    })
  }
  const frame = context.draft.frames[context.frameAt(command.frameId)]!
  if (frame.snapshot !== undefined) {
    throw new CanvasCommandFailed({
      reason: "archived-frame-comments-unsupported",
      detail: `Archived Frame ${frame.id} does not support comments`
    })
  }
  if (command.opening.body.trim().length === 0) {
    throw new CanvasCommandFailed({
      reason: "invalid-command",
      detail: "The opening Comment cannot be empty"
    })
  }
  context.draft.comments.push({
    id: command.id,
    frameId: command.frameId,
    anchor: command.anchor,
    opening: command.opening,
    replies: [],
    resolvedAt: null,
    resolvedBy: null
  })
  context.markCommentThread(command.id)
}

const applyCommentMutation = (
  context: CanvasMutationContext,
  command: CommentMutationCommand
) => {
  const index = context.commentThreadAt(command.id)
  const thread = context.draft.comments[index]!
  Match.valueTags(command, {
    ReplyToCommentThread: (reply) => {
      if (reply.reply.body.trim().length === 0) {
        throw new CanvasCommandFailed({
          reason: "invalid-command",
          detail: "A Reply cannot be empty"
        })
      }
      if (
        context.draft.comments.some((candidate) =>
          candidate.opening.id === reply.reply.id ||
          candidate.replies.some((message) => message.id === reply.reply.id)
        )
      ) {
        throw new CanvasCommandFailed({
          reason: "invalid-command",
          detail: `Comment already exists: ${reply.reply.id}`
        })
      }
      context.draft.comments[index] = {
        ...thread,
        replies: [...thread.replies, reply.reply]
      }
    },
    EditComment: (edit) => {
      const message = commentMessageById(thread, edit.commentId)
      if (message === undefined) {
        throw new CanvasCommandFailed({
          reason: "comment-not-found",
          detail: `Comment not found: ${edit.commentId}`
        })
      }
      if (!canEditComment(message, edit.actorId)) {
        throw new CanvasCommandFailed({
          reason: "comment-forbidden",
          detail: "Only the Comment Author may edit it"
        })
      }
      if (message.body !== edit.expectedBody) {
        throw new CanvasCommandFailed({
          reason: "comment-conflict",
          detail: `Comment ${edit.commentId} changed before this edit`
        })
      }
      if (edit.body.trim().length === 0) {
        throw new CanvasCommandFailed({
          reason: "invalid-command",
          detail: "A Comment cannot be empty"
        })
      }
      const edited = { ...message, body: edit.body, editedAt: edit.editedAt }
      context.draft.comments[index] = thread.opening.id === edit.commentId
        ? { ...thread, opening: edited }
        : {
            ...thread,
            replies: thread.replies.map((reply) =>
              reply.id === edit.commentId ? edited : reply
            )
          }
    },
    SetCommentThreadResolved: (resolution) => {
      if (
        !canManageCommentThread(
          context.draft.owner,
          thread,
          resolution.actor.id
        )
      ) {
        throw new CanvasCommandFailed({
          reason: "comment-forbidden",
          detail:
            "Only the Canvas Owner or opening Comment Author may change resolution"
        })
      }
      context.draft.comments[index] = {
        ...thread,
        resolvedAt: resolution.resolved ? resolution.at : null,
        resolvedBy: resolution.resolved ? resolution.actor : null
      }
    },
    UpdateCommentAnchor: (update) => {
      if (
        !canManageCommentThread(context.draft.owner, thread, update.actorId)
      ) {
        throw new CanvasCommandFailed({
          reason: "comment-forbidden",
          detail:
            "Only the Canvas Owner or opening Comment Author may re-anchor a thread"
        })
      }
      context.draft.comments[index] = { ...thread, anchor: update.anchor }
    }
  })
  context.markCommentThread(command.id)
}

const applyNoteMutation = (
  context: CanvasMutationContext,
  command: NoteMutationCommand
) => {
  const index = context.noteAt(command.id)
  const note = context.draft.notes[index]!
  Match.valueTags(command, {
    EditNote: (edit) => {
      if (note.author.id !== edit.actorId) {
        throw new CanvasCommandFailed({
          reason: "note-forbidden",
          detail: "Only the Note Author may edit it"
        })
      }
      if (note.text !== edit.expectedText) {
        throw new CanvasCommandFailed({
          reason: "note-conflict",
          detail: `Note ${edit.id} changed before this edit`
        })
      }
      context.draft.notes[index] = { ...note, text: edit.text }
    },
    SetNoteColor: (color) => {
      if (note.author.id !== color.actorId) {
        throw new CanvasCommandFailed({
          reason: "note-forbidden",
          detail: "Only the Note Author may change its color"
        })
      }
      context.draft.notes[index] = { ...note, color: color.color }
    },
    MoveNote: (move) => {
      context.draft.notes[index] = {
        ...note,
        geometry: { ...note.geometry, x: move.x, y: move.y }
      }
    },
    ResizeNote: (resize) => {
      context.draft.notes[index] = {
        ...note,
        geometry: {
          ...note.geometry,
          width: resize.width,
          height: resize.height
        }
      }
    },
    BringNoteToFront: () => {
      context.draft.notes[index] = {
        ...note,
        zIndex: nextZIndex(context.draft)
      }
    },
    SendNoteToBack: () => {
      context.draft.notes[index] = {
        ...note,
        zIndex: previousZIndex(context.draft)
      }
    },
    AttachNote: (attachment) => {
      context.frameAt(attachment.frameId)
      context.draft.notes[index] = {
        ...note,
        attachedTo: attachment.frameId
      }
    },
    DetachNote: () => {
      context.draft.notes[index] = { ...note, attachedTo: null }
    },
    RemoveNote: (removal) => {
      if (note.author.id !== removal.actorId) {
        throw new CanvasCommandFailed({
          reason: "note-forbidden",
          detail: "Only the Note Author may remove it"
        })
      }
      context.draft.notes.splice(index, 1)
    }
  })
  context.markNote(command.id)
}

const applyCanvasCommand = (
  context: CanvasMutationContext,
  command: CanvasCommandInput
) => Match.valueTags(command, {
  RenameCanvas: (rename) => applyRenameCanvas(context, rename),
  AddFrame: (frame) => applyAddFrame(context, frame),
  AddSnapshotFrame: (snapshot) => applyAddSnapshotFrame(context, snapshot),
  SetFrameStatus: (frame) => applyFrameMutation(context, frame),
  SetFrameSource: (frame) => applyFrameMutation(context, frame),
  SetFrameTitle: (frame) => applyFrameMutation(context, frame),
  SetFrameDisplay: (frame) => applyFrameMutation(context, frame),
  MoveFrame: (frame) => applyFrameMutation(context, frame),
  ResizeFrame: (frame) => applyFrameMutation(context, frame),
  BringFrameToFront: (frame) => applyFrameMutation(context, frame),
  SendFrameToBack: (frame) => applyFrameMutation(context, frame),
  RemoveFrame: (frame) => applyFrameMutation(context, frame),
  AddNote: (note) => applyAddNote(context, note),
  EditNote: (note) => applyNoteMutation(context, note),
  SetNoteColor: (note) => applyNoteMutation(context, note),
  MoveNote: (note) => applyNoteMutation(context, note),
  ResizeNote: (note) => applyNoteMutation(context, note),
  BringNoteToFront: (note) => applyNoteMutation(context, note),
  SendNoteToBack: (note) => applyNoteMutation(context, note),
  AttachNote: (note) => applyNoteMutation(context, note),
  DetachNote: (note) => applyNoteMutation(context, note),
  RemoveNote: (note) => applyNoteMutation(context, note),
  AddCommentThread: (thread) => applyAddCommentThread(context, thread),
  ReplyToCommentThread: (thread) => applyCommentMutation(context, thread),
  EditComment: (thread) => applyCommentMutation(context, thread),
  SetCommentThreadResolved: (thread) =>
    applyCommentMutation(context, thread),
  UpdateCommentAnchor: (thread) => applyCommentMutation(context, thread)
})

const apply = (
  canvas: Canvas,
  ...commands: ReadonlyArray<CanvasCommandInput>
): Effect.Effect<CanvasChange, CanvasCommandFailed> =>
  Effect.forEach(commands, (command) =>
    Schema.decodeUnknownEffect(CanvasCommandSchema)(command).pipe(
      Effect.mapError(
        (cause) =>
          new CanvasCommandFailed({
            reason: "invalid-command",
            detail: String(cause)
          })
      )
    )
  ).pipe(
    Effect.flatMap((decoded) =>
      Effect.try({
        try: () => {
          const current = stateOf(canvas)
          const draft: CanvasState = {
            id: current.id,
            title: current.title,
            revision: current.revision,
            frames: clone(current.frames),
            notes: clone(current.notes),
            owner: clone(current.owner),
            comments: clone(current.comments),
            removedFrameIds: [...current.removedFrameIds]
          }
          const changedFrameIds: Array<string> = []
          const changedNoteIds: Array<string> = []
          const changedCommentThreadIds: Array<string> = []
          const markFrame = (id: string) => {
            if (!changedFrameIds.includes(id)) changedFrameIds.push(id)
          }
          const markNote = (id: string) => {
            if (!changedNoteIds.includes(id)) changedNoteIds.push(id)
          }
          const markCommentThread = (id: string) => {
            if (!changedCommentThreadIds.includes(id)) changedCommentThreadIds.push(id)
          }
          const frameAt = (id: string) => {
            const index = draft.frames.findIndex((frame) => frame.id === id)
            if (index < 0) {
              throw new CanvasCommandFailed({
                reason: "frame-not-found",
                detail: `Frame not found: ${id}`
              })
            }
            return index
          }
          const noteAt = (id: string) => {
            const index = draft.notes.findIndex((note) => note.id === id)
            if (index < 0) {
              throw new CanvasCommandFailed({
                reason: "note-not-found",
                detail: `Note not found: ${id}`
              })
            }
            return index
          }
          const commentThreadAt = (id: string) => {
            const index = draft.comments.findIndex((thread) => thread.id === id)
            if (index < 0) {
              throw new CanvasCommandFailed({
                reason: "comment-thread-not-found",
                detail: `Comment Thread not found: ${id}`
              })
            }
            return index
          }

          const context: CanvasMutationContext = {
            draft,
            markFrame,
            markNote,
            markCommentThread,
            frameAt,
            noteAt,
            commentThreadAt
          }
          for (const command of decoded) applyCanvasCommand(context, command)
          current.title = draft.title
          current.frames = draft.frames
          current.notes = draft.notes
          current.owner = draft.owner
          current.comments = draft.comments
          current.removedFrameIds = draft.removedFrameIds
          return {
            commandCount: decoded.length,
            changedFrameIds,
            changedNoteIds,
            changedCommentThreadIds
          }
        },
        catch: (cause) =>
          cause instanceof CanvasCommandFailed
            ? cause
            : new CanvasCommandFailed({
                reason: "apply-failed",
                detail: causeMessage(cause)
              })
      })
    )
  )

export const Canvas = {
  create,
  fromDocument,
  open,
  apply,
  export: exportCanvas,
  summarize,
  listFrames,
  listNotes,
  listCommentThreads,
  getFrame,
  getNote,
  getCommentThread
} as const
