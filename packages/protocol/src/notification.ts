import { CanvasId } from "@crit/domain"
import { Schema } from "effect"

export const ReplicaChangedSchema = Schema.Struct({
  kind: Schema.Literal("replica-changed"),
  schemaVersion: Schema.Literal(1),
  canvasId: CanvasId
})
export type ReplicaChanged = typeof ReplicaChangedSchema.Type
