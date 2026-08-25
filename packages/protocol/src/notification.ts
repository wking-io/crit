import { CanvasId, PresenceRoster } from "@crit/domain"
import { Schema } from "effect"

export const ReplicaChangedSchema = Schema.Struct({
  kind: Schema.Literal("replica-changed"),
  schemaVersion: Schema.Literal(1),
  canvasId: CanvasId
})
export type ReplicaChanged = typeof ReplicaChangedSchema.Type

export const PresenceChangedSchema = Schema.Struct({
  kind: Schema.Literal("presence-changed"),
  schemaVersion: Schema.Literal(1),
  roster: PresenceRoster
})
export type PresenceChanged = typeof PresenceChangedSchema.Type
