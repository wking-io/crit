import { Schema } from "effect"

import {
  AgentId,
  AuthSubject,
  ExecutionId,
  PersonId
} from "./ids.js"
import { NonBlankString } from "./text.js"

const DisplayName = NonBlankString
const RuntimeName = NonBlankString
const RuntimeVersion = NonBlankString
const ExternalReference = NonBlankString

export const EmailAddress = Schema.Trimmed.check(
  Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
).pipe(Schema.brand("EmailAddress"))
export type EmailAddress = typeof EmailAddress.Type

export const UnspecifiedPersonEmail = Schema.TaggedStruct("unspecified", {})
export type UnspecifiedPersonEmail = typeof UnspecifiedPersonEmail.Type

export const ProvisionalPersonEmail = Schema.TaggedStruct("provisional", {
  address: EmailAddress
})
export type ProvisionalPersonEmail = typeof ProvisionalPersonEmail.Type

export const PersonEmail = Schema.Union([
  UnspecifiedPersonEmail,
  ProvisionalPersonEmail
])
export type PersonEmail = typeof PersonEmail.Type

export const PersonSnapshot = Schema.TaggedStruct("person", {
  personId: PersonId,
  displayName: DisplayName,
  email: PersonEmail
})
export type PersonSnapshot = typeof PersonSnapshot.Type

export const AgentSnapshot = Schema.TaggedStruct("agent", {
  agentId: AgentId,
  displayName: DisplayName
})
export type AgentSnapshot = typeof AgentSnapshot.Type

export const ActorSnapshot = Schema.Union([
  PersonSnapshot,
  AgentSnapshot
])
export type ActorSnapshot = typeof ActorSnapshot.Type

export const HarnessDescriptor = Schema.Struct({
  name: RuntimeName,
  version: Schema.optionalKey(RuntimeVersion)
})
export type HarnessDescriptor = typeof HarnessDescriptor.Type

export const ModelDescriptor = Schema.Struct({
  provider: Schema.optionalKey(RuntimeName),
  name: RuntimeName,
  version: Schema.optionalKey(RuntimeVersion)
})
export type ModelDescriptor = typeof ModelDescriptor.Type

export const ReportedRuntime = Schema.TaggedStruct("reported-runtime", {
  source: Schema.Literal("client-reported"),
  harness: HarnessDescriptor,
  model: Schema.optionalKey(ModelDescriptor),
  sessionId: Schema.optionalKey(ExternalReference),
  taskId: Schema.optionalKey(ExternalReference)
})
export type ReportedRuntime = typeof ReportedRuntime.Type

export const PersonPrincipal = Schema.TaggedStruct("person", {
  subject: AuthSubject,
  person: PersonSnapshot
})
export type PersonPrincipal = typeof PersonPrincipal.Type

export const AgentPrincipal = Schema.TaggedStruct("agent", {
  subject: AuthSubject,
  agent: AgentSnapshot,
  delegatedBy: PersonSnapshot
})
export type AgentPrincipal = typeof AgentPrincipal.Type

export const Principal = Schema.Union([
  PersonPrincipal,
  AgentPrincipal
])
export type Principal = typeof Principal.Type

export const PersonAttribution = Schema.TaggedStruct("person", {
  person: PersonSnapshot
})
export type PersonAttribution = typeof PersonAttribution.Type

export const AgentAttribution = Schema.TaggedStruct("agent", {
  agent: AgentSnapshot,
  delegatedBy: PersonSnapshot,
  executionId: ExecutionId,
  reportedRuntime: Schema.optionalKey(ReportedRuntime)
})
export type AgentAttribution = typeof AgentAttribution.Type

export const AcceptedAttribution = Schema.Union([
  PersonAttribution,
  AgentAttribution
])
export type AcceptedAttribution = typeof AcceptedAttribution.Type

export const decodeActorSnapshot = (input: Schema.Json) =>
  Schema.decodeUnknownSync(
    ActorSnapshot,
    { onExcessProperty: "error" }
  )(input)

export const decodePrincipal = (input: Schema.Json) =>
  Schema.decodeUnknownSync(
    Principal,
    { onExcessProperty: "error" }
  )(input)

export const decodeAcceptedAttribution = (input: Schema.Json) =>
  Schema.decodeUnknownSync(
    AcceptedAttribution,
    { onExcessProperty: "error" }
  )(input)

export const decodeReportedRuntime = (input: Schema.Json) =>
  Schema.decodeUnknownSync(
    ReportedRuntime,
    { onExcessProperty: "error" }
  )(input)

const isJsonRecord = (value: unknown): value is { readonly [key: string]: unknown } =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export const completeStoredPerson = (input: unknown): Schema.Json => {
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk)
    if (!isJsonRecord(value)) return value
    const nested = Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, walk(child)])
    )
    if (
      nested._tag === "person" &&
      typeof nested.personId === "string" &&
      typeof nested.displayName === "string" &&
      !Object.hasOwn(nested, "email")
    ) {
      return { ...nested, email: { _tag: "unspecified" } }
    }
    return nested
  }
  return Schema.decodeUnknownSync(Schema.Json)(walk(input))
}

export const actorFromAttribution = (attribution: AcceptedAttribution): ActorSnapshot =>
  attribution._tag === "person" ? attribution.person : attribution.agent

export const actorFromPrincipal = (principal: Principal): ActorSnapshot =>
  principal._tag === "person" ? principal.person : principal.agent
