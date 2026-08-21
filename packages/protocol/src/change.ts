import {
  AcceptedAttribution,
  CanvasCommandBatch,
  CanvasId,
  ChangeId,
  IsoTimestamp
} from "@crit/domain"
import { Schema } from "effect"

import { CursorSchema, SequenceSchema } from "./value.js"

export const ProposedCanvasChangeSchema = Schema.Struct({
  changeId: ChangeId,
  canvasId: CanvasId,
  observedCursor: Schema.NullOr(CursorSchema),
  commands: CanvasCommandBatch
})
export type ProposedCanvasChange = typeof ProposedCanvasChangeSchema.Type

export const AcceptedCanvasChangeSchema = Schema.Struct({
  changeId: ChangeId,
  canvasId: CanvasId,
  observedCursor: Schema.NullOr(CursorSchema),
  commands: CanvasCommandBatch,
  sequence: SequenceSchema,
  cursor: CursorSchema,
  acceptedAt: IsoTimestamp,
  attribution: AcceptedAttribution
})
export type AcceptedCanvasChange = typeof AcceptedCanvasChangeSchema.Type

export const ChangePageSchema = Schema.Struct({
  canvasId: CanvasId,
  after: Schema.NullOr(CursorSchema),
  changes: Schema.Array(AcceptedCanvasChangeSchema),
  cursor: CursorSchema,
  hasMore: Schema.Boolean
})
export type ChangePage = typeof ChangePageSchema.Type

export const SubmitChangeReceiptSchema = Schema.Struct({
  disposition: Schema.Literals(["first-acceptance", "identical-retry"]),
  change: AcceptedCanvasChangeSchema
})
export type SubmitChangeReceipt = typeof SubmitChangeReceiptSchema.Type
