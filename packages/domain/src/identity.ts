import { Effect, Schema } from "effect"

import {
  AgentId,
  AuthSubject,
  ExecutionId,
  Id,
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

export const AccessPersonEmail = Schema.TaggedStruct("access", {
  address: EmailAddress
})
export type AccessPersonEmail = typeof AccessPersonEmail.Type

export const PersonEmail = Schema.Union([
  UnspecifiedPersonEmail,
  AccessPersonEmail
])
export type PersonEmail = typeof PersonEmail.Type

export const PersonSnapshot = Schema.TaggedStruct("person", {
  personId: PersonId,
  displayName: DisplayName,
  email: PersonEmail
})
export type PersonSnapshot = typeof PersonSnapshot.Type

const PersonSnapshotFromStored = Schema.TaggedStruct("person", {
  personId: PersonId,
  displayName: DisplayName,
  email: PersonEmail.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(UnspecifiedPersonEmail.make({})))
  )
})

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

export const ReportedRuntime = Schema.TaggedStruct("reportedRuntime", {
  source: Schema.Literal("client-reported"),
  harness: HarnessDescriptor,
  model: Schema.optionalKey(ModelDescriptor),
  sessionId: Schema.optionalKey(ExternalReference),
  taskId: Schema.optionalKey(ExternalReference)
})
export type ReportedRuntime = typeof ReportedRuntime.Type

export const PersonPrincipal = Schema.TaggedStruct("person", {
  subject: AuthSubject,
  person: PersonSnapshotFromStored
})
export type PersonPrincipal = typeof PersonPrincipal.Type

export const AgentPrincipal = Schema.TaggedStruct("agent", {
  subject: AuthSubject,
  agent: AgentSnapshot,
  delegatedBy: PersonSnapshotFromStored
})
export type AgentPrincipal = typeof AgentPrincipal.Type

export const Principal = Schema.Union([
  PersonPrincipal,
  AgentPrincipal
])
export type Principal = typeof Principal.Type

export const PersonAttribution = Schema.TaggedStruct("person", {
  person: PersonSnapshotFromStored
})
export type PersonAttribution = typeof PersonAttribution.Type

export const AgentAttribution = Schema.TaggedStruct("agent", {
  agent: AgentSnapshot,
  delegatedBy: PersonSnapshotFromStored,
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

export const actorFromAttribution = (attribution: AcceptedAttribution): ActorSnapshot =>
  attribution._tag === "person" ? attribution.person : attribution.agent

export const actorFromPrincipal = (principal: Principal): ActorSnapshot =>
  principal._tag === "person" ? principal.person : principal.agent

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")

export const accessPersonId = (
  address: EmailAddress
): Effect.Effect<PersonId> =>
  Effect.promise(async() => {
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(address))
    )
    return Id.person(`person_${hex(digest).slice(0, 32)}`)
  })

export const accessPersonSnapshot = (
  address: EmailAddress
): Effect.Effect<PersonSnapshot> =>
  accessPersonId(address).pipe(
    Effect.map((personId) => PersonSnapshot.make({
      personId,
      displayName: address.slice(0, address.indexOf("@")),
      email: AccessPersonEmail.make({ address })
    }))
  )
