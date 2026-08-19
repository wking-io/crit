import { Schema } from "effect"

import {
  Author,
  CommentAnchor,
  CommentMessage
} from "./comment.js"
import {
  COMMENTS_UNAVAILABLE_DETAIL,
  type CritFeatures
} from "./features.js"

export const FrameReviewStatus = Schema.Union([
  Schema.Literal("in-progress"),
  Schema.Literal("ready-for-review"),
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

export const NoteColorFamily = Schema.Literals([
  "neutral",
  "red",
  "orange",
  "green",
  "blue",
  "purple"
])
export type NoteColorFamily = typeof NoteColorFamily.Type

export const RenameCanvasCommand = Schema.TaggedStruct("RenameCanvas", {
  title: Schema.String
})
export type RenameCanvasCommand = typeof RenameCanvasCommand.Type

export const AddFrameCommand = Schema.TaggedStruct("AddFrame", {
  id: Schema.String,
  url: Schema.String,
  title: Schema.String,
  status: FrameReviewStatus,
  provenance: FrameProvenance
})
export type AddFrameCommand = typeof AddFrameCommand.Type

export const SnapshotArtifact = Schema.Struct({
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
export type SnapshotArtifact = typeof SnapshotArtifact.Type

export const AddSnapshotFrameCommand = Schema.TaggedStruct(
  "AddSnapshotFrame",
  {
    id: Schema.String,
    sourceFrameId: Schema.String,
    expectedSourceUrl: Schema.String,
    url: Schema.String,
    artifact: SnapshotArtifact
  }
)
export type AddSnapshotFrameCommand = typeof AddSnapshotFrameCommand.Type

export const SetFrameStatusCommand = Schema.TaggedStruct("SetFrameStatus", {
  id: Schema.String,
  status: FrameReviewStatus
})
export type SetFrameStatusCommand = typeof SetFrameStatusCommand.Type

export const SetFrameSourceCommand = Schema.TaggedStruct("SetFrameSource", {
  id: Schema.String,
  url: Schema.String,
  provenance: FrameProvenance
})
export type SetFrameSourceCommand = typeof SetFrameSourceCommand.Type

export const SetFrameTitleCommand = Schema.TaggedStruct("SetFrameTitle", {
  id: Schema.String,
  title: Schema.String
})
export type SetFrameTitleCommand = typeof SetFrameTitleCommand.Type

export const SetFrameDisplayCommand = Schema.TaggedStruct("SetFrameDisplay", {
  id: Schema.String,
  display: FrameDisplay
})
export type SetFrameDisplayCommand = typeof SetFrameDisplayCommand.Type

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

export const PositiveDimension = Schema.Finite.check(Schema.isGreaterThan(0))

export const ResizeFrameCommand = Schema.TaggedStruct("ResizeFrame", {
  id: Schema.String,
  width: PositiveDimension,
  height: PositiveDimension
})
export type ResizeFrameCommand = typeof ResizeFrameCommand.Type

export const BringFrameToFrontCommand = Schema.TaggedStruct(
  "BringFrameToFront",
  { id: Schema.String }
)
export type BringFrameToFrontCommand = typeof BringFrameToFrontCommand.Type

export const SendFrameToBackCommand = Schema.TaggedStruct(
  "SendFrameToBack",
  { id: Schema.String }
)
export type SendFrameToBackCommand = typeof SendFrameToBackCommand.Type

export const AddNoteCommand = Schema.TaggedStruct("AddNote", {
  id: Schema.String,
  text: Schema.String,
  author: Author,
  x: Schema.Finite,
  y: Schema.Finite,
  width: PositiveDimension,
  height: PositiveDimension,
  color: NoteColorFamily
})
export type AddNoteCommand = typeof AddNoteCommand.Type

export const EditNoteCommand = Schema.TaggedStruct("EditNote", {
  id: Schema.String,
  actorId: Schema.String,
  expectedText: Schema.String,
  text: Schema.String
})
export type EditNoteCommand = typeof EditNoteCommand.Type

export const SetNoteColorCommand = Schema.TaggedStruct("SetNoteColor", {
  id: Schema.String,
  actorId: Schema.String,
  color: NoteColorFamily
})
export type SetNoteColorCommand = typeof SetNoteColorCommand.Type

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

export const BringNoteToFrontCommand = Schema.TaggedStruct(
  "BringNoteToFront",
  { id: Schema.String }
)
export type BringNoteToFrontCommand = typeof BringNoteToFrontCommand.Type

export const SendNoteToBackCommand = Schema.TaggedStruct(
  "SendNoteToBack",
  { id: Schema.String }
)
export type SendNoteToBackCommand = typeof SendNoteToBackCommand.Type

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
  id: Schema.String,
  actorId: Schema.String
})
export type RemoveNoteCommand = typeof RemoveNoteCommand.Type

export const AddCommentThreadCommand = Schema.TaggedStruct("AddCommentThread", {
  id: Schema.String,
  frameId: Schema.String,
  anchor: CommentAnchor,
  opening: CommentMessage
})
export type AddCommentThreadCommand = typeof AddCommentThreadCommand.Type

export const ReplyToCommentThreadCommand = Schema.TaggedStruct(
  "ReplyToCommentThread",
  {
    id: Schema.String,
    reply: CommentMessage
  }
)
export type ReplyToCommentThreadCommand = typeof ReplyToCommentThreadCommand.Type

export const EditCommentCommand = Schema.TaggedStruct("EditComment", {
  id: Schema.String,
  commentId: Schema.String,
  actorId: Schema.String,
  expectedBody: Schema.String,
  body: Schema.String,
  editedAt: Schema.String
})
export type EditCommentCommand = typeof EditCommentCommand.Type

export const SetCommentThreadResolvedCommand = Schema.TaggedStruct(
  "SetCommentThreadResolved",
  {
    id: Schema.String,
    actor: Author,
    resolved: Schema.Boolean,
    at: Schema.String
  }
)
export type SetCommentThreadResolvedCommand =
  typeof SetCommentThreadResolvedCommand.Type

export const UpdateCommentAnchorCommand = Schema.TaggedStruct(
  "UpdateCommentAnchor",
  {
    id: Schema.String,
    actorId: Schema.String,
    anchor: CommentAnchor
  }
)
export type UpdateCommentAnchorCommand = typeof UpdateCommentAnchorCommand.Type

export type AddFrameInput = {
  readonly id: string
  readonly url: string
  readonly title: string
  readonly status?: FrameReviewStatus
  readonly provenance: FrameProvenance
}

export type RenameCanvasInput = {
  readonly title: string
}

const renameCanvas = (input: RenameCanvasInput): RenameCanvasCommand => ({
  _tag: "RenameCanvas",
  ...input
})

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

export type SetFrameSourceInput = {
  readonly id: string
  readonly url: string
  readonly provenance: FrameProvenance
}

export type SetFrameTitleInput = {
  readonly id: string
  readonly title: string
}

export type SetFrameDisplayInput = {
  readonly id: string
  readonly display: FrameDisplay
}

export type AddSnapshotFrameInput = {
  readonly id: string
  readonly sourceFrameId: string
  readonly expectedSourceUrl: string
  readonly url: string
  readonly artifact: SnapshotArtifact
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

const setFrameSource = (input: SetFrameSourceInput): SetFrameSourceCommand => ({
  _tag: "SetFrameSource",
  ...input
})

const setFrameTitle = (input: SetFrameTitleInput): SetFrameTitleCommand => ({
  _tag: "SetFrameTitle",
  ...input
})

const setFrameDisplay = (
  input: SetFrameDisplayInput
): SetFrameDisplayCommand => ({
  _tag: "SetFrameDisplay",
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

export type OrderFrameInput = { readonly id: string }

const bringFrameToFront = (
  input: OrderFrameInput
): BringFrameToFrontCommand => ({ _tag: "BringFrameToFront", ...input })

const sendFrameToBack = (
  input: OrderFrameInput
): SendFrameToBackCommand => ({ _tag: "SendFrameToBack", ...input })

export type AddNoteInput = {
  readonly id: string
  readonly text: string
  readonly author: Author
  readonly x: number
  readonly y: number
  readonly width?: number
  readonly height?: number
  readonly color?: NoteColorFamily
}

const addNote = (input: AddNoteInput): AddNoteCommand => ({
  _tag: "AddNote",
  id: input.id,
  text: input.text,
  author: input.author,
  x: input.x,
  y: input.y,
  width: input.width ?? 332,
  height: input.height ?? 103,
  color: input.color ?? "blue"
})

export type EditNoteInput = {
  readonly id: string
  readonly actorId: string
  readonly expectedText: string
  readonly text: string
}

const editNote = (input: EditNoteInput): EditNoteCommand => ({
  _tag: "EditNote",
  ...input
})

export type SetNoteColorInput = {
  readonly id: string
  readonly actorId: string
  readonly color: NoteColorFamily
}

const setNoteColor = (input: SetNoteColorInput): SetNoteColorCommand => ({
  _tag: "SetNoteColor",
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

export type OrderNoteInput = { readonly id: string }

const bringNoteToFront = (
  input: OrderNoteInput
): BringNoteToFrontCommand => ({ _tag: "BringNoteToFront", ...input })

const sendNoteToBack = (
  input: OrderNoteInput
): SendNoteToBackCommand => ({ _tag: "SendNoteToBack", ...input })

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

export type RemoveNoteInput = {
  readonly id: string
  readonly actorId: string
}

const removeNote = (input: RemoveNoteInput): RemoveNoteCommand => ({
  _tag: "RemoveNote",
  ...input
})

export type AddCommentThreadInput = {
  readonly id: string
  readonly frameId: string
  readonly anchor: CommentAnchor
  readonly opening: CommentMessage
}

const addCommentThread = (
  input: AddCommentThreadInput
): AddCommentThreadCommand => ({ _tag: "AddCommentThread", ...input })

export type ReplyToCommentThreadInput = {
  readonly id: string
  readonly reply: CommentMessage
}

const replyToCommentThread = (
  input: ReplyToCommentThreadInput
): ReplyToCommentThreadCommand => ({ _tag: "ReplyToCommentThread", ...input })

export type EditCommentInput = {
  readonly id: string
  readonly commentId: string
  readonly actorId: string
  readonly expectedBody: string
  readonly body: string
  readonly editedAt: string
}

const editComment = (input: EditCommentInput): EditCommentCommand => ({
  _tag: "EditComment",
  ...input
})

export type SetCommentThreadResolvedInput = {
  readonly id: string
  readonly actor: Author
  readonly resolved: boolean
  readonly at: string
}

const setCommentThreadResolved = (
  input: SetCommentThreadResolvedInput
): SetCommentThreadResolvedCommand => ({
  _tag: "SetCommentThreadResolved",
  ...input
})

export type UpdateCommentAnchorInput = {
  readonly id: string
  readonly actorId: string
  readonly anchor: CommentAnchor
}

const updateCommentAnchor = (
  input: UpdateCommentAnchorInput
): UpdateCommentAnchorCommand => ({
  _tag: "UpdateCommentAnchor",
  ...input
})

export const CommentCommandSchema = Schema.Union([
  AddCommentThreadCommand,
  ReplyToCommentThreadCommand,
  EditCommentCommand,
  SetCommentThreadResolvedCommand,
  UpdateCommentAnchorCommand
])
export type CommentCommand = typeof CommentCommandSchema.Type

export const isCommentCommand = Schema.is(CommentCommandSchema)

export const CanvasCommandSchema = Schema.Union([
  RenameCanvasCommand,
  AddFrameCommand,
  AddSnapshotFrameCommand,
  SetFrameStatusCommand,
  SetFrameSourceCommand,
  SetFrameTitleCommand,
  SetFrameDisplayCommand,
  RemoveFrameCommand,
  MoveFrameCommand,
  ResizeFrameCommand,
  BringFrameToFrontCommand,
  SendFrameToBackCommand,
  AddNoteCommand,
  EditNoteCommand,
  SetNoteColorCommand,
  MoveNoteCommand,
  ResizeNoteCommand,
  BringNoteToFrontCommand,
  SendNoteToBackCommand,
  AttachNoteCommand,
  DetachNoteCommand,
  RemoveNoteCommand,
  AddCommentThreadCommand,
  ReplyToCommentThreadCommand,
  EditCommentCommand,
  SetCommentThreadResolvedCommand,
  UpdateCommentAnchorCommand
])
export type CanvasCommand = typeof CanvasCommandSchema.Type

export const unavailableCommentCommandDetail = (
  commands: ReadonlyArray<CanvasCommand>,
  features: CritFeatures
) =>
  features.comments || !commands.some(isCommentCommand)
    ? undefined
    : COMMENTS_UNAVAILABLE_DETAIL

export const CanvasCommand = {
  RenameCanvas: RenameCanvasCommand,
  AddFrame: AddFrameCommand,
  AddSnapshotFrame: AddSnapshotFrameCommand,
  SetFrameStatus: SetFrameStatusCommand,
  SetFrameSource: SetFrameSourceCommand,
  SetFrameTitle: SetFrameTitleCommand,
  SetFrameDisplay: SetFrameDisplayCommand,
  RemoveFrame: RemoveFrameCommand,
  MoveFrame: MoveFrameCommand,
  ResizeFrame: ResizeFrameCommand,
  BringFrameToFront: BringFrameToFrontCommand,
  SendFrameToBack: SendFrameToBackCommand,
  AddNote: AddNoteCommand,
  EditNote: EditNoteCommand,
  SetNoteColor: SetNoteColorCommand,
  MoveNote: MoveNoteCommand,
  ResizeNote: ResizeNoteCommand,
  BringNoteToFront: BringNoteToFrontCommand,
  SendNoteToBack: SendNoteToBackCommand,
  AttachNote: AttachNoteCommand,
  DetachNote: DetachNoteCommand,
  RemoveNote: RemoveNoteCommand,
  AddCommentThread: AddCommentThreadCommand,
  ReplyToCommentThread: ReplyToCommentThreadCommand,
  EditComment: EditCommentCommand,
  SetCommentThreadResolved: SetCommentThreadResolvedCommand,
  UpdateCommentAnchor: UpdateCommentAnchorCommand,
  renameCanvas,
  addFrame,
  addSnapshotFrame,
  setFrameStatus,
  setFrameSource,
  setFrameTitle,
  setFrameDisplay,
  removeFrame,
  moveFrame,
  resizeFrame,
  bringFrameToFront,
  sendFrameToBack,
  addNote,
  editNote,
  setNoteColor,
  moveNote,
  resizeNote,
  bringNoteToFront,
  sendNoteToBack,
  attachNote,
  detachNote,
  removeNote,
  addCommentThread,
  replyToCommentThread,
  editComment,
  setCommentThreadResolved,
  updateCommentAnchor
} as const
