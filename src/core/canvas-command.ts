import { Schema } from "effect"

export const FrameReviewStatus = Schema.Union([
  Schema.Literal("in-progress"),
  Schema.Literal("approved"),
  Schema.Literal("changes-requested")
])
export type FrameReviewStatus = typeof FrameReviewStatus.Type

export const FrameStatus = Schema.Union([
  FrameReviewStatus,
  Schema.Literal("archived")
])
export type FrameStatus = typeof FrameStatus.Type

export const FrameProvenance = Schema.Struct({
  kind: Schema.Union([
    Schema.Literal("manual"),
    Schema.Literal("agent"),
    Schema.Literal("manifest"),
    Schema.Literal("discovery"),
    Schema.Literal("snapshot")
  ]),
  sourceId: Schema.String
})
export type FrameProvenance = typeof FrameProvenance.Type

export const FrameDisplay = Schema.Struct({
  heightMode: Schema.Union([
    Schema.Literal("viewport"),
    Schema.Literal("fit-page")
  ])
})
export type FrameDisplay = typeof FrameDisplay.Type

export const AddFrameCommand = Schema.TaggedStruct("AddFrame", {
  id: Schema.String,
  url: Schema.String,
  title: Schema.String,
  status: FrameReviewStatus,
  provenance: FrameProvenance
})
export type AddFrameCommand = typeof AddFrameCommand.Type

export const FrameSnapshot = Schema.Struct({
  artifactId: Schema.String.check(Schema.isPattern(/^[a-z0-9-]+$/)),
  sourceUrl: Schema.String.check(Schema.isPattern(/^https?:\/\//)),
  capturedAt: Schema.String.check(
    Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  ),
  sizeBytes: Schema.Finite.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(0)
  )
})
export type FrameSnapshot = typeof FrameSnapshot.Type

export const AddSnapshotFrameCommand = Schema.TaggedStruct(
  "AddSnapshotFrame",
  {
    id: Schema.String,
    sourceFrameId: Schema.String,
    expectedSourceUrl: Schema.String,
    url: Schema.String,
    artifact: FrameSnapshot
  }
)
export type AddSnapshotFrameCommand = typeof AddSnapshotFrameCommand.Type

export const SetFrameStatusCommand = Schema.TaggedStruct("SetFrameStatus", {
  id: Schema.String,
  status: FrameReviewStatus
})
export type SetFrameStatusCommand = typeof SetFrameStatusCommand.Type

export const UpdateFrameCommand = Schema.TaggedStruct("UpdateFrame", {
  id: Schema.String,
  changes: Schema.Struct({
    url: Schema.optional(Schema.String),
    title: Schema.optional(Schema.String),
    status: Schema.optional(FrameReviewStatus),
    provenance: Schema.optional(FrameProvenance),
    display: Schema.optional(FrameDisplay)
  })
})
export type UpdateFrameCommand = typeof UpdateFrameCommand.Type

export const RemoveFrameCommand = Schema.TaggedStruct("RemoveFrame", {
  id: Schema.String
})
export type RemoveFrameCommand = typeof RemoveFrameCommand.Type

export const MoveFrameCommand = Schema.TaggedStruct("MoveFrame", {
  id: Schema.String,
  x: Schema.Finite,
  y: Schema.Finite
})
export type MoveFrameCommand = typeof MoveFrameCommand.Type

const PositiveDimension = Schema.Finite.check(Schema.isGreaterThan(0))

export const ResizeFrameCommand = Schema.TaggedStruct("ResizeFrame", {
  id: Schema.String,
  width: PositiveDimension,
  height: PositiveDimension
})
export type ResizeFrameCommand = typeof ResizeFrameCommand.Type

export const AddNoteCommand = Schema.TaggedStruct("AddNote", {
  id: Schema.String,
  text: Schema.String,
  x: Schema.Finite,
  y: Schema.Finite,
  width: PositiveDimension,
  height: PositiveDimension
})
export type AddNoteCommand = typeof AddNoteCommand.Type

export const UpdateNoteCommand = Schema.TaggedStruct("UpdateNote", {
  id: Schema.String,
  expectedText: Schema.String,
  text: Schema.String
})
export type UpdateNoteCommand = typeof UpdateNoteCommand.Type

export const MoveNoteCommand = Schema.TaggedStruct("MoveNote", {
  id: Schema.String,
  x: Schema.Finite,
  y: Schema.Finite
})
export type MoveNoteCommand = typeof MoveNoteCommand.Type

export const ResizeNoteCommand = Schema.TaggedStruct("ResizeNote", {
  id: Schema.String,
  width: PositiveDimension,
  height: PositiveDimension
})
export type ResizeNoteCommand = typeof ResizeNoteCommand.Type

export const AttachNoteCommand = Schema.TaggedStruct("AttachNote", {
  id: Schema.String,
  frameId: Schema.String
})
export type AttachNoteCommand = typeof AttachNoteCommand.Type

export const DetachNoteCommand = Schema.TaggedStruct("DetachNote", {
  id: Schema.String
})
export type DetachNoteCommand = typeof DetachNoteCommand.Type

export const RemoveNoteCommand = Schema.TaggedStruct("RemoveNote", {
  id: Schema.String
})
export type RemoveNoteCommand = typeof RemoveNoteCommand.Type

export type AddFrameInput = {
  readonly id: string
  readonly url: string
  readonly title: string
  readonly status?: FrameReviewStatus
  readonly provenance: FrameProvenance
}

const addFrame = (input: AddFrameInput): AddFrameCommand => ({
  _tag: "AddFrame",
  id: input.id,
  url: input.url,
  title: input.title,
  status: input.status ?? "in-progress",
  provenance: input.provenance
})

export type SetFrameStatusInput = {
  readonly id: string
  readonly status: FrameReviewStatus
}

export type AddSnapshotFrameInput = {
  readonly id: string
  readonly sourceFrameId: string
  readonly expectedSourceUrl: string
  readonly url: string
  readonly artifact: FrameSnapshot
}

const addSnapshotFrame = (
  input: AddSnapshotFrameInput
): AddSnapshotFrameCommand => ({
  _tag: "AddSnapshotFrame",
  ...input
})

const setFrameStatus = (input: SetFrameStatusInput): SetFrameStatusCommand => ({
  _tag: "SetFrameStatus",
  ...input
})

export type UpdateFrameInput = {
  readonly id: string
  readonly changes: {
    readonly url?: string
    readonly title?: string
    readonly status?: FrameReviewStatus
    readonly provenance?: FrameProvenance
    readonly display?: FrameDisplay
  }
}

const updateFrame = (input: UpdateFrameInput): UpdateFrameCommand => ({
  _tag: "UpdateFrame",
  ...input
})

export type RemoveFrameInput = {
  readonly id: string
}

const removeFrame = (input: RemoveFrameInput): RemoveFrameCommand => ({
  _tag: "RemoveFrame",
  ...input
})

export type MoveFrameInput = {
  readonly id: string
  readonly x: number
  readonly y: number
}

const moveFrame = (input: MoveFrameInput): MoveFrameCommand => ({
  _tag: "MoveFrame",
  ...input
})

export type ResizeFrameInput = {
  readonly id: string
  readonly width: number
  readonly height: number
}

const resizeFrame = (input: ResizeFrameInput): ResizeFrameCommand => ({
  _tag: "ResizeFrame",
  ...input
})

export type AddNoteInput = {
  readonly id: string
  readonly text: string
  readonly x: number
  readonly y: number
  readonly width?: number
  readonly height?: number
}

const addNote = (input: AddNoteInput): AddNoteCommand => ({
  _tag: "AddNote",
  id: input.id,
  text: input.text,
  x: input.x,
  y: input.y,
  width: input.width ?? 280,
  height: input.height ?? 160
})

export type UpdateNoteInput = {
  readonly id: string
  readonly expectedText: string
  readonly text: string
}

const updateNote = (input: UpdateNoteInput): UpdateNoteCommand => ({
  _tag: "UpdateNote",
  ...input
})

export type MoveNoteInput = {
  readonly id: string
  readonly x: number
  readonly y: number
}

const moveNote = (input: MoveNoteInput): MoveNoteCommand => ({
  _tag: "MoveNote",
  ...input
})

export type ResizeNoteInput = {
  readonly id: string
  readonly width: number
  readonly height: number
}

const resizeNote = (input: ResizeNoteInput): ResizeNoteCommand => ({
  _tag: "ResizeNote",
  ...input
})

export type AttachNoteInput = {
  readonly id: string
  readonly frameId: string
}

const attachNote = (input: AttachNoteInput): AttachNoteCommand => ({
  _tag: "AttachNote",
  ...input
})

export type DetachNoteInput = { readonly id: string }

const detachNote = (input: DetachNoteInput): DetachNoteCommand => ({
  _tag: "DetachNote",
  ...input
})

export type RemoveNoteInput = { readonly id: string }

const removeNote = (input: RemoveNoteInput): RemoveNoteCommand => ({
  _tag: "RemoveNote",
  ...input
})

export const CanvasCommandSchema = Schema.Union([
  AddFrameCommand,
  AddSnapshotFrameCommand,
  SetFrameStatusCommand,
  UpdateFrameCommand,
  RemoveFrameCommand,
  MoveFrameCommand,
  ResizeFrameCommand,
  AddNoteCommand,
  UpdateNoteCommand,
  MoveNoteCommand,
  ResizeNoteCommand,
  AttachNoteCommand,
  DetachNoteCommand,
  RemoveNoteCommand
])
export type CanvasCommand = typeof CanvasCommandSchema.Type

export const CanvasCommand = {
  AddFrame: AddFrameCommand,
  AddSnapshotFrame: AddSnapshotFrameCommand,
  SetFrameStatus: SetFrameStatusCommand,
  UpdateFrame: UpdateFrameCommand,
  RemoveFrame: RemoveFrameCommand,
  MoveFrame: MoveFrameCommand,
  ResizeFrame: ResizeFrameCommand,
  AddNote: AddNoteCommand,
  UpdateNote: UpdateNoteCommand,
  MoveNote: MoveNoteCommand,
  ResizeNote: ResizeNoteCommand,
  AttachNote: AttachNoteCommand,
  DetachNote: DetachNoteCommand,
  RemoveNote: RemoveNoteCommand,
  addFrame,
  addSnapshotFrame,
  setFrameStatus,
  updateFrame,
  removeFrame,
  moveFrame,
  resizeFrame,
  addNote,
  updateNote,
  moveNote,
  resizeNote,
  attachNote,
  detachNote,
  removeNote
} as const
