import { Schema } from "effect"

import { CanvasTitle } from "./canvas.js"
import { AuthoredText, CanvasItemRef, ReviewStatus } from "./content.js"
import { Geometry } from "./geometry.js"
import { CanvasId, ChangeId, FrameId } from "./ids.js"
import { RepresentationRef } from "./representation.js"

export const RenameCanvasCommand = Schema.TaggedStruct("rename-canvas", { expectedTitle: CanvasTitle, title: CanvasTitle })
export const AddFrameCommand = Schema.TaggedStruct("add-frame", { frameId: FrameId, title: AuthoredText, representation: RepresentationRef, status: ReviewStatus, geometry: Geometry })
export const SetFrameTitleCommand = Schema.TaggedStruct("set-frame-title", { frameId: FrameId, expectedChangedByChangeId: ChangeId, title: AuthoredText })
export const SetFrameRepresentationCommand = Schema.TaggedStruct("set-frame-representation", { frameId: FrameId, expectedChangedByChangeId: ChangeId, representation: RepresentationRef })
export const SetFrameStatusCommand = Schema.TaggedStruct("set-frame-status", { frameId: FrameId, expectedChangedByChangeId: ChangeId, status: ReviewStatus })
export const SetFrameGeometryCommand = Schema.TaggedStruct("set-frame-geometry", { frameId: FrameId, expectedChangedByChangeId: ChangeId, geometry: Geometry })
export const RemoveFrameCommand = Schema.TaggedStruct("remove-frame", { frameId: FrameId, expectedUpdatedByChangeId: ChangeId })
export const PlaceCanvasItemCommand = Schema.TaggedStruct("place-canvas-item", { item: CanvasItemRef, after: Schema.NullOr(CanvasItemRef), expectedStackChangeId: Schema.NullOr(ChangeId) })

export const CanvasCommand = Schema.Union([
  RenameCanvasCommand, AddFrameCommand, SetFrameTitleCommand,
  SetFrameRepresentationCommand, SetFrameStatusCommand, SetFrameGeometryCommand,
  RemoveFrameCommand, PlaceCanvasItemCommand
])
export type CanvasCommand = typeof CanvasCommand.Type
export type RenameCanvasCommand = typeof RenameCanvasCommand.Type

export const CanvasCommandBatch = Schema.NonEmptyArray(CanvasCommand)
export type CanvasCommandBatch = typeof CanvasCommandBatch.Type

export const CanvasChange = Schema.Struct({ canvasId: CanvasId, changeId: ChangeId, commands: CanvasCommandBatch })
export type CanvasChange = typeof CanvasChange.Type

const exact = { onExcessProperty: "error" } as const
export const decodeCanvasCommandBatch = (input: Schema.Json) => Schema.decodeUnknownSync(CanvasCommandBatch, exact)(input)
export const decodeCanvasChange = (input: Schema.Json): CanvasChange => Schema.decodeUnknownSync(CanvasChange, exact)(input)
