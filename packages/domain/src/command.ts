import { Schema } from "effect"

import { CanvasTitle } from "./canvas.js"
import { CanvasId, ChangeId } from "./ids.js"

export const RenameCanvasCommand = Schema.TaggedStruct("rename-canvas", {
  expectedTitle: CanvasTitle,
  title: CanvasTitle
})
export type RenameCanvasCommand = typeof RenameCanvasCommand.Type

export const CanvasCommand = Schema.Union([RenameCanvasCommand])
export type CanvasCommand = typeof CanvasCommand.Type

export const CanvasCommandBatch = Schema.NonEmptyArray(CanvasCommand)
export type CanvasCommandBatch = typeof CanvasCommandBatch.Type

export const CanvasChange = Schema.Struct({
  canvasId: CanvasId,
  changeId: ChangeId,
  commands: CanvasCommandBatch
})
export type CanvasChange = typeof CanvasChange.Type

export const decodeCanvasCommandBatch = (input: Schema.Json) =>
  Schema.decodeUnknownSync(
    CanvasCommandBatch,
    { onExcessProperty: "error" }
  )(input)

export const decodeCanvasChange = (input: Schema.Json): CanvasChange =>
  Schema.decodeUnknownSync(
    CanvasChange,
    { onExcessProperty: "error" }
  )(input)
