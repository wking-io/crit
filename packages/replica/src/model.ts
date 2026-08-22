import { CanvasAuthority, VerifiedInvocation } from "@crit/authority"
import { CanvasChangeFailureSchema, CanvasCommandBatch, CanvasId, CanvasProjection, ChangeId } from "@crit/domain"
import {
  AcceptedCanvasChangeSchema,
  CursorSchema,
  ProposedCanvasChangeSchema
} from "@crit/protocol"
import { Context, Data, type Effect, Schema } from "effect"

export const ReplicaChange = Schema.TaggedStruct("replica-change", {
  canvasId: CanvasId,
  commands: CanvasCommandBatch
})
export type ReplicaChange = typeof ReplicaChange.Type

export const Ready = Schema.TaggedStruct("ready", {})
export const AcceptedUnconfirmed = Schema.TaggedStruct("accepted-unconfirmed", {})
export const Conflicted = Schema.TaggedStruct("conflicted", { failure: CanvasChangeFailureSchema })
export const Blocked = Schema.TaggedStruct("blocked", { blockedBy: Schema.NonEmptyArray(ChangeId) })
export const PendingState = Schema.Union([Ready, AcceptedUnconfirmed, Conflicted, Blocked])
export type PendingState = typeof PendingState.Type

export const PendingChange = Schema.Struct({
  proposal: ProposedCanvasChangeSchema,
  dependencies: Schema.Array(ChangeId),
  state: PendingState
})
export type PendingChange = typeof PendingChange.Type

export const ReplicaView = Schema.TaggedStruct("replica-view", {
  canvasId: CanvasId,
  acknowledgedCursor: CursorSchema,
  projection: CanvasProjection,
  pending: Schema.Array(PendingChange)
})
export type ReplicaView = typeof ReplicaView.Type

export const ReplicaChangeReceipt = Schema.Struct({ changeId: ChangeId, view: ReplicaView })
export type ReplicaChangeReceipt = typeof ReplicaChangeReceipt.Type

export const SyncResult = Schema.Struct({
  canvasId: CanvasId,
  pulled: Schema.Int,
  acknowledged: Schema.Int,
  conflicted: Schema.Int,
  blocked: Schema.Int,
  view: ReplicaView
})
export type SyncResult = typeof SyncResult.Type

export class ReplicaNotOpen extends Data.TaggedError("ReplicaNotOpen")<{ readonly canvasId: typeof CanvasId.Type }> {}
export class ReplicaCanvasNotFound extends Data.TaggedError("ReplicaCanvasNotFound")<{ readonly canvasId: typeof CanvasId.Type }> {}
export class LocalChangeRejected extends Data.TaggedError("LocalChangeRejected")<{
  readonly canvasId: typeof CanvasId.Type
  readonly changeId: typeof ChangeId.Type
  readonly failure: typeof CanvasChangeFailureSchema.Type
}> {}
export class ChangeIdGenerationFailure extends Data.TaggedError("ChangeIdGenerationFailure")<{ readonly reason: string }> {}
export class ChangeIdAlreadyPresent extends Data.TaggedError("ChangeIdAlreadyPresent")<{
  readonly canvasId: typeof CanvasId.Type
  readonly changeId: typeof ChangeId.Type
}> {}
export class ReplicaDiverged extends Data.TaggedError("ReplicaDiverged")<{
  readonly canvasId: typeof CanvasId.Type
  readonly reason: string
}> {}
export class ReplicaInvariantFailure extends Data.TaggedError("ReplicaInvariantFailure")<{
  readonly canvasId: typeof CanvasId.Type
  readonly reason: string
}> {}

export type ReplicaOpenFailure = ReplicaCanvasNotFound | ReplicaInvariantFailure
export type ReplicaChangeFailure = ReplicaNotOpen | LocalChangeRejected | ChangeIdGenerationFailure | ChangeIdAlreadyPresent | ReplicaInvariantFailure
export type ReplicaSyncFailure = ReplicaNotOpen | ReplicaCanvasNotFound | ReplicaDiverged | ReplicaInvariantFailure
export type ReplicaFailure = ReplicaOpenFailure | ReplicaChangeFailure | ReplicaSyncFailure

export class ReplicaChangeIds extends Context.Service<ReplicaChangeIds, {
  readonly next: Effect.Effect<typeof ChangeId.Type, ChangeIdGenerationFailure>
}>()("@crit/replica/ReplicaChangeIds") {}

const PendingRecordSchema = Schema.Struct({
  proposal: ProposedCanvasChangeSchema,
  invocation: VerifiedInvocation,
  dependencies: Schema.Array(ChangeId),
  state: PendingState
})
export type PendingRecord = typeof PendingRecordSchema.Type

const ReplicaStateSchema = Schema.Struct({
  canvasId: CanvasId,
  genesisCursor: CursorSchema,
  genesisProjection: CanvasProjection,
  acceptedBaseSequence: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  acknowledgedCursor: CursorSchema,
  accepted: Schema.Array(AcceptedCanvasChangeSchema),
  pending: Schema.Array(PendingRecordSchema)
})
export type ReplicaState = typeof ReplicaStateSchema.Type

export const ReplicaModel = { change: ReplicaChange.make }
export type ReplicaAuthority = CanvasAuthority["Service"]
