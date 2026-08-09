import { Effect, Schema } from "effect"

import {
  CanvasCommandSchema,
  FrameDisplay,
  FrameProvenance,
  SnapshotArtifact,
  FrameStatus,
  type CanvasCommand as CanvasCommandInput
} from "./canvas-command.js"

const CanvasTypeId: unique symbol = Symbol.for("@riff-refine/crit/Canvas")
const PositiveDimension = Schema.Finite.check(Schema.isGreaterThan(0))
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
  geometry: CanvasGeometry,
  attachedTo: Schema.NullOr(Schema.String),
  zIndex: Schema.Finite.check(Schema.isInt())
})
export type CanvasNote = typeof CanvasNote.Type

export const CanvasDocument = Schema.Struct({
  format: Schema.Literal("crit-canvas"),
  version: Schema.Literal(1),
  id: Schema.String,
  title: Schema.String,
  revision: NonNegativeInteger,
  frames: Schema.Array(CanvasFrame),
  notes: Schema.Array(CanvasNote)
})
export type CanvasDocument = typeof CanvasDocument.Type

export const CanvasSummary = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  revision: NonNegativeInteger,
  frameCount: NonNegativeInteger,
  noteCount: NonNegativeInteger,
  statuses: Schema.Struct({
    inProgress: NonNegativeInteger,
    readyForReview: NonNegativeInteger,
    approved: NonNegativeInteger,
    changesRequested: NonNegativeInteger,
    archived: NonNegativeInteger
  })
})
export type CanvasSummary = typeof CanvasSummary.Type

export const FrameSummary = CanvasFrame
export type FrameSummary = CanvasFrame
export const FrameList = Schema.Array(FrameSummary)
export type FrameList = typeof FrameList.Type

export const NoteSummary = CanvasNote
export type NoteSummary = CanvasNote
export const NoteList = Schema.Array(NoteSummary)
export type NoteList = typeof NoteList.Type

export const CanvasChange = Schema.Struct({
  commandCount: NonNegativeInteger,
  changedFrameIds: Schema.Array(Schema.String),
  changedNoteIds: Schema.Array(Schema.String)
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

type CanvasState = {
  readonly id: string
  title: string
  revision: number
  frames: Array<CanvasFrame>
  notes: Array<CanvasNote>
}

const states = new WeakMap<object, CanvasState>()

const clone = <A>(value: A): A => structuredClone(value)

const makeCanvas = (state: CanvasState): Canvas => {
  const handle = Object.freeze({}) as Canvas
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
  notes: clone(state.notes)
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
  }
} as const

const create = (input: { readonly id: string; readonly title: string }): Canvas =>
  makeCanvas({
    id: input.id,
    title: input.title,
    revision: 0,
    frames: [],
    notes: []
  })

const encodedBytes = (input: unknown) => {
  const serialized = JSON.stringify(input)
  if (serialized === undefined) throw new TypeError("Value is not JSON serializable")
  return new TextEncoder().encode(serialized).byteLength
}

const validateDocument = (document: CanvasDocument) => {
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
    if (
      note.attachedTo !== null &&
      !document.frames.some((frame) => frame.id === note.attachedTo)
    ) {
      throw new Error(
        `Note ${note.id} is attached to missing Frame ${note.attachedTo}`
      )
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
    notes: clone(Array.from(validated.notes))
  })
}

const documentTooLarge = (actualBytes: number) =>
  new CanvasDocumentTooLarge({
    actualBytes,
    maxBytes: MAX_CANVAS_DOCUMENT_BYTES,
    detail: `Canvas Document is ${actualBytes} bytes; maximum is ${MAX_CANVAS_DOCUMENT_BYTES}`
  })

const open = (
  input: unknown
): Effect.Effect<Canvas, CanvasOpenFailed | CanvasDocumentTooLarge> =>
  Effect.gen(function*() {
    const actualBytes = yield* Effect.try({
      try: () => encodedBytes(input),
      catch: (cause) =>
        new CanvasOpenFailed({
          reason: "invalid-envelope",
          detail: cause instanceof Error ? cause.message : String(cause)
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
          detail: cause instanceof Error ? cause.message : String(cause)
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

const getFrame = (
  canvas: Canvas,
  id: string
): Effect.Effect<FrameSummary, FrameNotFound> => {
  const frame = stateOf(canvas).frames.find((candidate) => candidate.id === id)
  return frame === undefined
    ? Effect.fail(new FrameNotFound({ id }))
    : Effect.succeed(clone(frame))
}

const getNote = (
  canvas: Canvas,
  id: string
): Effect.Effect<NoteSummary, NoteNotFound> => {
  const note = stateOf(canvas).notes.find((candidate) => candidate.id === id)
  return note === undefined
    ? Effect.fail(new NoteNotFound({ id }))
    : Effect.succeed(clone(note))
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
            notes: clone(current.notes)
          }
          const changedFrameIds: Array<string> = []
          const changedNoteIds: Array<string> = []
          const markFrame = (id: string) => {
            if (!changedFrameIds.includes(id)) changedFrameIds.push(id)
          }
          const markNote = (id: string) => {
            if (!changedNoteIds.includes(id)) changedNoteIds.push(id)
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

          for (const command of decoded) {
            if (command._tag === "AddFrame") {
              if (
                draft.frames.some((frame) => frame.id === command.id) ||
                draft.notes.some((note) => note.id === command.id)
              ) {
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
              const frameNumber = draft.frames.length
              draft.frames.push({
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
                zIndex: nextZIndex(draft)
              })
              markFrame(command.id)
              continue
            }

            if (command._tag === "AddSnapshotFrame") {
              if (
                draft.frames.some((frame) => frame.id === command.id) ||
                draft.notes.some((note) => note.id === command.id)
              ) {
                throw new CanvasCommandFailed({
                  reason: "duplicate-frame",
                  detail: `Canvas item already exists: ${command.id}`
                })
              }
              const source = draft.frames.find(
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
              draft.frames.push({
                id: command.id,
                url: command.url,
                title: `${source.title} · Snapshot`,
                status: "archived",
                provenance: {
                  kind: "snapshot",
                  sourceId: source.id
                },
                display: source.display,
                geometry: {
                  ...source.geometry,
                  x: source.geometry.x + source.geometry.width + 40
                },
                zIndex: nextZIndex(draft),
                snapshot: command.artifact
              })
              markFrame(command.id)
              continue
            }

            if (command._tag === "AddNote") {
              if (
                draft.frames.some((frame) => frame.id === command.id) ||
                draft.notes.some((note) => note.id === command.id)
              ) {
                throw new CanvasCommandFailed({
                  reason: "duplicate-note",
                  detail: `Canvas item already exists: ${command.id}`
                })
              }
              draft.notes.push({
                id: command.id,
                text: command.text,
                geometry: {
                  x: command.x,
                  y: command.y,
                  width: command.width,
                  height: command.height
                },
                attachedTo: null,
                zIndex: nextZIndex(draft)
              })
              markNote(command.id)
              continue
            }

            if (
              command._tag === "SetFrameStatus" ||
              command._tag === "UpdateFrame" ||
              command._tag === "MoveFrame" ||
              command._tag === "ResizeFrame" ||
              command._tag === "BringFrameToFront" ||
              command._tag === "SendFrameToBack" ||
              command._tag === "RemoveFrame"
            ) {
              const index = frameAt(command.id)
              const frame = draft.frames[index]!

              if (
                frame.snapshot !== undefined &&
                (command._tag === "SetFrameStatus" ||
                  (command._tag === "UpdateFrame" &&
                    (command.changes.url !== undefined ||
                      command.changes.status !== undefined ||
                      command.changes.provenance !== undefined)))
              ) {
                throw new CanvasCommandFailed({
                  reason: "snapshot-frame-immutable",
                  detail: `Snapshot Frame content is immutable: ${frame.id}`
                })
              }

              if (
                command._tag === "UpdateFrame" &&
                command.changes.provenance?.kind === "snapshot"
              ) {
                throw new CanvasCommandFailed({
                  reason: "snapshot-source-invalid",
                  detail: "Live Frames cannot use snapshot provenance"
                })
              }
              if (command._tag === "RemoveFrame") {
                draft.frames.splice(index, 1)
                const attached = draft.notes.filter(
                  (note) => note.attachedTo === command.id
                )
                draft.notes = draft.notes.filter(
                  (note) => note.attachedTo !== command.id
                )
                for (const note of attached) markNote(note.id)
              } else if (command._tag === "SetFrameStatus") {
                draft.frames[index] = { ...frame, status: command.status }
              } else if (command._tag === "UpdateFrame") {
                if (
                  Object.values(command.changes).every(
                    (value) => value === undefined
                  )
                ) {
                  throw new CanvasCommandFailed({
                    reason: "invalid-command",
                    detail: `UpdateFrame requires at least one change: ${command.id}`
                  })
                }
                draft.frames[index] = {
                  ...frame,
                  ...(command.changes.url === undefined
                    ? {}
                    : { url: command.changes.url }),
                  ...(command.changes.title === undefined
                    ? {}
                    : { title: command.changes.title }),
                  ...(command.changes.status === undefined
                    ? {}
                    : { status: command.changes.status }),
                  ...(command.changes.provenance === undefined
                    ? {}
                    : { provenance: command.changes.provenance }),
                  display: command.changes.display ?? frame.display
                }
              } else if (command._tag === "MoveFrame") {
                const deltaX = command.x - frame.geometry.x
                const deltaY = command.y - frame.geometry.y
                draft.frames[index] = {
                  ...frame,
                  geometry: { ...frame.geometry, x: command.x, y: command.y }
                }
                draft.notes = draft.notes.map((note) => {
                  if (note.attachedTo !== command.id) return note
                  markNote(note.id)
                  return {
                    ...note,
                    geometry: {
                      ...note.geometry,
                      x: note.geometry.x + deltaX,
                      y: note.geometry.y + deltaY
                    }
                  }
                })
              } else if (command._tag === "ResizeFrame") {
                draft.frames[index] = {
                  ...frame,
                  geometry: {
                    ...frame.geometry,
                    width: command.width,
                    height: command.height
                  }
                }
              } else {
                draft.frames[index] = {
                  ...frame,
                  zIndex:
                    command._tag === "BringFrameToFront"
                      ? nextZIndex(draft)
                      : previousZIndex(draft)
                }
              }
              markFrame(command.id)
              continue
            }

            const index = noteAt(command.id)
            const note = draft.notes[index]!
            if (command._tag === "UpdateNote") {
              if (note.text !== command.expectedText) {
                throw new CanvasCommandFailed({
                  reason: "note-conflict",
                  detail: `Note ${command.id} changed before this edit`
                })
              }
              draft.notes[index] = { ...note, text: command.text }
            } else if (command._tag === "MoveNote") {
              draft.notes[index] = {
                ...note,
                geometry: { ...note.geometry, x: command.x, y: command.y }
              }
            } else if (command._tag === "ResizeNote") {
              draft.notes[index] = {
                ...note,
                geometry: {
                  ...note.geometry,
                  width: command.width,
                  height: command.height
                }
              }
            } else if (command._tag === "BringNoteToFront") {
              draft.notes[index] = { ...note, zIndex: nextZIndex(draft) }
            } else if (command._tag === "SendNoteToBack") {
              draft.notes[index] = { ...note, zIndex: previousZIndex(draft) }
            } else if (command._tag === "AttachNote") {
              frameAt(command.frameId)
              draft.notes[index] = { ...note, attachedTo: command.frameId }
            } else if (command._tag === "DetachNote") {
              draft.notes[index] = { ...note, attachedTo: null }
            } else {
              draft.notes.splice(index, 1)
            }
            markNote(command.id)
          }

          current.title = draft.title
          current.frames = draft.frames
          current.notes = draft.notes
          return {
            commandCount: decoded.length,
            changedFrameIds,
            changedNoteIds
          }
        },
        catch: (cause) =>
          cause instanceof CanvasCommandFailed
            ? cause
            : new CanvasCommandFailed({
                reason: "apply-failed",
                detail: cause instanceof Error ? cause.message : String(cause)
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
  getFrame,
  getNote
} as const
