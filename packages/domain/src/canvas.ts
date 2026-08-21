import { Schema } from "effect"

import { CanvasId } from "./ids.js"

export const CanvasTitle = Schema.Trimmed.check(Schema.isNonEmpty())
export type CanvasTitle = typeof CanvasTitle.Type

export const CanvasProjection = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  canvasId: CanvasId,
  title: CanvasTitle
})
export type CanvasProjection = typeof CanvasProjection.Type

export const decodeCanvasProjection = (input: Schema.Json): CanvasProjection =>
  Schema.decodeUnknownSync(
    CanvasProjection,
    { onExcessProperty: "error" }
  )(input)
