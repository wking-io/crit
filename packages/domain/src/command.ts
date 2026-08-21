import { Schema } from "effect"

const CanvasTitle = Schema.Trimmed.check(Schema.isNonEmpty())

export const RenameCanvasCommand = Schema.TaggedStruct("rename-canvas", {
  expectedTitle: CanvasTitle,
  title: CanvasTitle
})
export type RenameCanvasCommand = typeof RenameCanvasCommand.Type

export const CanvasCommand = Schema.Union([RenameCanvasCommand])
export type CanvasCommand = typeof CanvasCommand.Type

export const CanvasCommandBatch = Schema.NonEmptyArray(CanvasCommand)
export type CanvasCommandBatch = typeof CanvasCommandBatch.Type

export const decodeCanvasCommandBatch = (input: Schema.Json) =>
  Schema.decodeUnknownSync(
    CanvasCommandBatch,
    { onExcessProperty: "error" }
  )(input)
