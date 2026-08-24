import { Schema } from "effect"

const semanticId = <Prefix extends string, Brand extends string>(
  prefix: Prefix,
  brand: Brand
) => Schema.String.check(
  Schema.isPattern(
    new RegExp(`^${prefix}[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`)
  )
).pipe(Schema.brand(brand))

export const InstallationId = semanticId("installation_", "InstallationId")
export type InstallationId = typeof InstallationId.Type

export const WorkspaceId = semanticId("workspace_", "WorkspaceId")
export type WorkspaceId = typeof WorkspaceId.Type

export const CanvasId = semanticId("canvas_", "CanvasId")
export type CanvasId = typeof CanvasId.Type

export const FrameId = semanticId("frame_", "FrameId")
export type FrameId = typeof FrameId.Type

export const PersonId = semanticId("person_", "PersonId")
export type PersonId = typeof PersonId.Type

export const AgentId = semanticId("agent_", "AgentId")
export type AgentId = typeof AgentId.Type

export const ApplicationId = semanticId("application_", "ApplicationId")
export type ApplicationId = typeof ApplicationId.Type

export const ArtifactId = semanticId("artifact_", "ArtifactId")
export type ArtifactId = typeof ArtifactId.Type

export const ChangeId = semanticId("change_", "ChangeId")
export type ChangeId = typeof ChangeId.Type

export const ExecutionId = semanticId("execution_", "ExecutionId")
export type ExecutionId = typeof ExecutionId.Type

export const OAuthClientId = semanticId("oauth_client_", "OAuthClientId")
export type OAuthClientId = typeof OAuthClientId.Type

export const GrantId = semanticId("grant_", "GrantId")
export type GrantId = typeof GrantId.Type

export const HttpUrl = Schema.String.check(
  Schema.isPattern(/^https?:\/\/[^/?#\s]+(?:[/?#][^\s]*)?$/)
).pipe(Schema.brand("HttpUrl"))
export type HttpUrl = typeof HttpUrl.Type

export const Sha256Digest = Schema.String.check(
  Schema.isPattern(/^sha256:[0-9a-f]{64}$/)
).pipe(Schema.brand("Sha256Digest"))
export type Sha256Digest = typeof Sha256Digest.Type

const isoTimestampFilter = Schema.makeFilter<string>((value) => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return "Expected a UTC ISO 8601 timestamp with millisecond precision"
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value
    ? "Expected a real UTC calendar timestamp"
    : undefined
})

export const IsoTimestamp = Schema.String.check(isoTimestampFilter).pipe(
  Schema.brand("IsoTimestamp")
)
export type IsoTimestamp = typeof IsoTimestamp.Type

export const AuthSubject = Schema.String.check(
  Schema.isPattern(/^\S{1,512}$/)
).pipe(Schema.brand("AuthSubject"))
export type AuthSubject = typeof AuthSubject.Type

export const Id = {
  installation: Schema.decodeUnknownSync(InstallationId),
  workspace: Schema.decodeUnknownSync(WorkspaceId),
  canvas: Schema.decodeUnknownSync(CanvasId),
  frame: Schema.decodeUnknownSync(FrameId),
  person: Schema.decodeUnknownSync(PersonId),
  agent: Schema.decodeUnknownSync(AgentId),
  application: Schema.decodeUnknownSync(ApplicationId),
  artifact: Schema.decodeUnknownSync(ArtifactId),
  change: Schema.decodeUnknownSync(ChangeId),
  execution: Schema.decodeUnknownSync(ExecutionId),
  oauthClient: Schema.decodeUnknownSync(OAuthClientId),
  grant: Schema.decodeUnknownSync(GrantId)
}
