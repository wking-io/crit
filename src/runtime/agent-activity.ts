import { Context, Effect, Schema } from "effect"

export const AGENT_ACTIVITY_LEASE_SECONDS = 60

export const AgentActivityReference = Schema.Struct({
  kind: Schema.String,
  id: Schema.String,
  uri: Schema.optionalKey(
    Schema.String.check(
      Schema.isPattern(/^(?:https?|codex|claude):\/\//)
    )
  )
})
export type AgentActivityReference = typeof AgentActivityReference.Type

export const AgentActivity = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  canvasId: Schema.String,
  activityId: Schema.String,
  harness: Schema.String,
  model: Schema.NullOr(Schema.String),
  detail: Schema.NullOr(Schema.String),
  reference: Schema.NullOr(AgentActivityReference),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  activeUntil: Schema.String
})
export type AgentActivity = typeof AgentActivity.Type

export const AgentActivityCollection = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  canvasId: Schema.String,
  activities: Schema.Array(AgentActivity)
})
export type AgentActivityCollection = typeof AgentActivityCollection.Type

export class AgentActivityFailed extends Schema.TaggedError<AgentActivityFailed>()(
  "AgentActivityFailed",
  {
    operation: Schema.String,
    canvasId: Schema.String,
    activityId: Schema.optional(Schema.String),
    detail: Schema.String
  }
) {}

export type SignalAgentActivityInput = {
  readonly canvasId: string
  readonly activityId: string
  readonly harness: string
  readonly model?: string
  readonly detail?: string
  readonly reference?: AgentActivityReference
}

export interface AgentActivityStoreShape {
  readonly read: (
    canvasId: string
  ) => Effect.Effect<AgentActivityCollection, AgentActivityFailed>
  readonly signal: (
    input: SignalAgentActivityInput
  ) => Effect.Effect<AgentActivity, AgentActivityFailed>
  readonly clear: (
    canvasId: string,
    activityId: string
  ) => Effect.Effect<void, AgentActivityFailed>
}

export class AgentActivityStore extends Context.Service<
  AgentActivityStore,
  AgentActivityStoreShape
>()("@riff-refine/crit/AgentActivityStore") {}

