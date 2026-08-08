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

export const CanvasCommandSchema = Schema.Union([
  AddFrameCommand,
  SetFrameStatusCommand
])
export type CanvasCommand = typeof CanvasCommandSchema.Type

export const CanvasCommand = {
  AddFrame: AddFrameCommand,
  SetFrameStatus: SetFrameStatusCommand,
  addFrame,
  setFrameStatus
} as const
