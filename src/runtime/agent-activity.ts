import { Context, Effect, Schema } from "effect"

export const AGENT_ACTIVITY_LEASE_SECONDS = 60

export const AgentActivityReference = Schema.Struct({
  kind: Schema.String,
  id: Schema.String,
  uri: Schema.NullOr(
    Schema.String.check(
      Schema.isPattern(/^(?:https?|codex|claude):\/\//)
    )
  ).pipe(Schema.withDecodingDefaultKey(Effect.succeed(null)))
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

export class AgentActivityReadFailed extends Schema.TaggedError<AgentActivityReadFailed>()(
  "AgentActivityReadFailed",
  {
    canvasId: Schema.String,
    detail: Schema.String
  }
) {}

export class AgentActivitySignalFailed extends Schema.TaggedError<AgentActivitySignalFailed>()(
  "AgentActivitySignalFailed",
  {
    canvasId: Schema.String,
    activityId: Schema.String,
    detail: Schema.String
  }
) {}

export class AgentActivityClearFailed extends Schema.TaggedError<AgentActivityClearFailed>()(
  "AgentActivityClearFailed",
  {
    canvasId: Schema.String,
    activityId: Schema.String,
    detail: Schema.String
  }
) {}

export const AgentActivityErrorSchema = Schema.Union([
  AgentActivityReadFailed,
  AgentActivitySignalFailed,
  AgentActivityClearFailed
])
export type AgentActivityError = typeof AgentActivityErrorSchema.Type

export type SignalAgentActivityInput = {
  readonly canvasId: string
  readonly activityId: string
  readonly harness: string
  readonly model: string | null
  readonly detail: string | null
  readonly reference: AgentActivityReference | null
}

export class AgentActivityStore extends Context.Service<AgentActivityStore, {
  readonly read: (
    canvasId: string
  ) => Effect.Effect<AgentActivityCollection, AgentActivityReadFailed>
  readonly signal: (
    input: SignalAgentActivityInput
  ) => Effect.Effect<AgentActivity, AgentActivitySignalFailed>
  readonly clear: (
    canvasId: string,
    activityId: string
  ) => Effect.Effect<void, AgentActivityClearFailed>
}>()("@riff-refine/crit/AgentActivityStore") {}
