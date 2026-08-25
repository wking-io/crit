import {
  AccessPersonEmail,
  CanvasId,
  CanvasTitle,
  PersonSnapshot
} from "@crit/domain"
import { Schema } from "effect"

const AccessPersonSnapshot = Schema.TaggedStruct("person", {
  personId: PersonSnapshot.fields.personId,
  displayName: PersonSnapshot.fields.displayName,
  email: AccessPersonEmail
})

export const ShareCanvasWire = Schema.Struct({
  kind: Schema.Literal("share-canvas"),
  schemaVersion: Schema.Literal(1),
  canvasId: CanvasId,
  title: CanvasTitle,
  person: AccessPersonSnapshot
})
export type ShareCanvasWire = typeof ShareCanvasWire.Type

export const CanvasSharedWire = Schema.Struct({
  kind: Schema.Literal("canvas-shared"),
  schemaVersion: Schema.Literal(1),
  canvasId: CanvasId,
  title: CanvasTitle
})
export type CanvasSharedWire = typeof CanvasSharedWire.Type

export const decodeShareCanvasWire = Schema.decodeUnknownSync(
  ShareCanvasWire,
  { onExcessProperty: "error" }
)

export const encodeShareCanvasWire = Schema.encodeSync(
  ShareCanvasWire,
  { onExcessProperty: "error" }
)

export const decodeCanvasSharedWire = Schema.decodeUnknownSync(
  CanvasSharedWire,
  { onExcessProperty: "error" }
)

export const encodeCanvasSharedWire = Schema.encodeSync(
  CanvasSharedWire,
  { onExcessProperty: "error" }
)
