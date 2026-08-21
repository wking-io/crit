import { Schema } from "effect"

import {
  AcceptedCanvasChangeSchema,
  ChangePageSchema,
  ProposedCanvasChangeSchema,
  SubmitChangeReceiptSchema
} from "./change.js"
import { ProtocolFailureSchema } from "./failure.js"

export const ProposedWire = Schema.Struct({
  kind: Schema.Literal("proposed-canvas-change"),
  schemaVersion: Schema.Literal(1),
  ...ProposedCanvasChangeSchema.fields
})

export const AcceptedWire = Schema.Struct({
  kind: Schema.Literal("accepted-canvas-change"),
  schemaVersion: Schema.Literal(1),
  ...AcceptedCanvasChangeSchema.fields
})

export const PageWire = Schema.Struct({
  kind: Schema.Literal("canvas-change-page"),
  schemaVersion: Schema.Literal(1),
  canvasId: ChangePageSchema.fields.canvasId,
  after: ChangePageSchema.fields.after,
  changes: Schema.Array(AcceptedWire),
  cursor: ChangePageSchema.fields.cursor,
  hasMore: ChangePageSchema.fields.hasMore
})

export const ReceiptWire = Schema.Struct({
  kind: Schema.Literal("submit-change-receipt"),
  schemaVersion: Schema.Literal(1),
  disposition: SubmitChangeReceiptSchema.fields.disposition,
  change: AcceptedWire
})

export const FailureWire = Schema.Struct({
  kind: Schema.Literal("protocol-failure"),
  schemaVersion: Schema.Literal(1),
  failure: ProtocolFailureSchema
})
