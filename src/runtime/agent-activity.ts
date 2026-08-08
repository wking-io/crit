import { Context, Effect, Schema } from "effect"

export const AgentActivityStatus = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  canvasId: Schema.String,
  active: Schema.Boolean,
  updatedAt: Schema.NullOr(Schema.String),
  activeUntil: Schema.NullOr(Schema.String),
  detail: Schema.NullOr(Schema.String)
})
export type AgentActivityStatus = typeof AgentActivityStatus.Type

export class AgentActivityFailed extends Schema.TaggedError<AgentActivityFailed>()(
  "AgentActivityFailed",
  {
    operation: Schema.String,
    canvasId: Schema.String,
    detail: Schema.String
  }
) {}

export type SignalAgentActivityInput = {
  readonly canvasId: string
  readonly activeForSeconds: number
  readonly detail?: string
}

export interface AgentActivityStoreShape {
  readonly read: (
    canvasId: string
  ) => Effect.Effect<AgentActivityStatus, AgentActivityFailed>
  readonly signal: (
    input: SignalAgentActivityInput
  ) => Effect.Effect<AgentActivityStatus, AgentActivityFailed>
  readonly clear: (
    canvasId: string
  ) => Effect.Effect<AgentActivityStatus, AgentActivityFailed>
}

export class AgentActivityStore extends Context.Service<
  AgentActivityStore,
  AgentActivityStoreShape
>()("@riff-refine/crit/AgentActivityStore") {}

