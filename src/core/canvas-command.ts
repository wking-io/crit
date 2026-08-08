import { Schema } from "effect"

export const FrameStatus = Schema.Union([
  Schema.Literal("in-progress"),
  Schema.Literal("approved"),
  Schema.Literal("changes-requested")
])
export type FrameStatus = typeof FrameStatus.Type

export const FrameProvenance = Schema.Struct({
  kind: Schema.Union([
    Schema.Literal("manual"),
    Schema.Literal("agent"),
    Schema.Literal("manifest"),
    Schema.Literal("discovery")
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
  status: FrameStatus,
  provenance: FrameProvenance
})
export type AddFrameCommand = typeof AddFrameCommand.Type

export const SetFrameStatusCommand = Schema.TaggedStruct("SetFrameStatus", {
  id: Schema.String,
  status: FrameStatus
})
export type SetFrameStatusCommand = typeof SetFrameStatusCommand.Type

export const UpdateFrameCommand = Schema.TaggedStruct("UpdateFrame", {
  id: Schema.String,
  changes: Schema.Struct({
    url: Schema.optional(Schema.String),
    title: Schema.optional(Schema.String),
    status: Schema.optional(FrameStatus),
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

export type AddFrameInput = {
  readonly id: string
  readonly url: string
  readonly title: string
  readonly status?: FrameStatus
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
  readonly status: FrameStatus
}

const setFrameStatus = (input: SetFrameStatusInput): SetFrameStatusCommand => ({
  _tag: "SetFrameStatus",
  ...input
})

export type UpdateFrameInput = {
  readonly id: string
  readonly changes: {
    readonly url?: string
    readonly title?: string
    readonly status?: FrameStatus
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

export const CanvasCommandSchema = Schema.Union([
  AddFrameCommand,
  SetFrameStatusCommand,
  UpdateFrameCommand,
  RemoveFrameCommand,
  MoveFrameCommand,
  ResizeFrameCommand
])
export type CanvasCommand = typeof CanvasCommandSchema.Type

export const CanvasCommand = {
  AddFrame: AddFrameCommand,
  SetFrameStatus: SetFrameStatusCommand,
  UpdateFrame: UpdateFrameCommand,
  RemoveFrame: RemoveFrameCommand,
  MoveFrame: MoveFrameCommand,
  ResizeFrame: ResizeFrameCommand,
  addFrame,
  setFrameStatus,
  updateFrame,
  removeFrame,
  moveFrame,
  resizeFrame
} as const
