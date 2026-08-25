import { Match, Schema } from "effect"

import {
  AgentSnapshot,
  PersonSnapshot,
  ReportedRuntime
} from "./identity.js"
import { CanvasId, ExecutionId } from "./ids.js"

export const ConnectedPerson = Schema.TaggedStruct("connected-person", {
  person: PersonSnapshot
})
export type ConnectedPerson = typeof ConnectedPerson.Type

export const ActiveAgentExecution = Schema.TaggedStruct("active-agent-execution", {
  agent: AgentSnapshot,
  delegatedBy: PersonSnapshot,
  executionId: ExecutionId,
  reportedRuntime: Schema.optionalKey(ReportedRuntime)
})
export type ActiveAgentExecution = typeof ActiveAgentExecution.Type

export const PresenceParticipant = Schema.Union([
  ConnectedPerson,
  ActiveAgentExecution
])
export type PresenceParticipant = typeof PresenceParticipant.Type

export const PresenceKey = Schema.String.check(
  Schema.isPattern(/^(?:person|execution):[A-Za-z0-9_-]+$/)
).pipe(Schema.brand("PresenceKey"))
export type PresenceKey = typeof PresenceKey.Type

export const presenceKey = (participant: PresenceParticipant): PresenceKey =>
  Match.value(participant).pipe(Match.tagsExhaustive({
    "connected-person": ({ person }) =>
      Schema.decodeUnknownSync(PresenceKey)(`person:${person.personId}`),
    "active-agent-execution": ({ executionId }) =>
      Schema.decodeUnknownSync(PresenceKey)(`execution:${executionId}`)
  }))

const PresenceRosterFields = Schema.TaggedStruct("presence-roster", {
  canvasId: CanvasId,
  people: Schema.Array(ConnectedPerson),
  agentRuns: Schema.Array(ActiveAgentExecution)
})

const duplicatePresenceIdentity = (
  roster: typeof PresenceRosterFields.Type
): string | undefined => {
  const personIds = roster.people.map(({ person }) => person.personId)
  if (new Set(personIds).size !== personIds.length) {
    return "Expected unique personId values in people"
  }
  const executionIds = roster.agentRuns.map(({ executionId }) => executionId)
  return new Set(executionIds).size === executionIds.length
    ? undefined
    : "Expected unique executionId values in agentRuns"
}

export const PresenceRoster = PresenceRosterFields.check(
  Schema.makeFilter<typeof PresenceRosterFields.Type>(duplicatePresenceIdentity)
)
export type PresenceRoster = typeof PresenceRoster.Type

export const decodePresenceRoster = (input: Schema.Json): PresenceRoster =>
  Schema.decodeUnknownSync(
    PresenceRoster,
    { onExcessProperty: "error" }
  )(input)
