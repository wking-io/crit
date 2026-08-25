import {
  CanvasAlreadyExists,
  CanvasNotFound,
  ChangeRejected,
  CreateCanvas,
  VerifiedInvocation
} from "@crit/authority"
import {
  AgentSnapshot,
  CanvasId,
  ExecutionId,
  InstallationId,
  IsoTimestamp,
  ReportedRuntime
} from "@crit/domain"
import {
  PresenceChangedSchema,
  ReplicaChangedSchema
} from "@crit/protocol"
import { Context, Schema } from "effect"
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
  HttpApiSecurity
} from "effect/unstable/httpapi"

import { ReplicaChange, ReplicaChangeReceipt, ReplicaView, SyncResult } from "./model.js"

export const localApiVersion = "1"
export const localApiVersionHeader = "x-crit-api-version"
export const localApiPathPrefix = `/api/v${localApiVersion}`
export const localReplicaNotificationsPath = `${localApiPathPrefix}/subscribe/:canvasId`
export const localReplicaSocketCloseCode = {
  unauthorized: 4401,
  replicaNotOpen: 4404
}

export const LocalReplicaSocketHello = Schema.Struct({
  kind: Schema.Literal("authenticate"),
  schemaVersion: Schema.Literal(1),
  bearer: Schema.String.check(Schema.isMinLength(32), Schema.isMaxLength(256))
})
export type LocalReplicaSocketHello = typeof LocalReplicaSocketHello.Type

export const LocalReplicaSocketReady = Schema.Struct({
  kind: Schema.Literal("subscription-ready"),
  schemaVersion: Schema.Literal(1),
  canvasId: CanvasId
})
export type LocalReplicaSocketReady = typeof LocalReplicaSocketReady.Type

export const LocalReplicaSocketServerFrame = Schema.Union([
  LocalReplicaSocketReady,
  ReplicaChangedSchema,
  PresenceChangedSchema
])
export type LocalReplicaSocketServerFrame = typeof LocalReplicaSocketServerFrame.Type

export const LocalDaemonInstanceNonce = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{32}$/)
).pipe(Schema.brand("LocalDaemonInstanceNonce"))
export type LocalDaemonInstanceNonce = typeof LocalDaemonInstanceNonce.Type

export const LocalDaemonStatus = Schema.Struct({
  version: Schema.Literal(1),
  instance: LocalDaemonInstanceNonce,
  installationId: InstallationId,
  apiVersion: Schema.Literal(localApiVersion)
})
export type LocalDaemonStatus = typeof LocalDaemonStatus.Type

const SecretToken = Schema.String.check(
  Schema.isMinLength(32),
  Schema.isMaxLength(256)
).pipe(Schema.brand("LocalApiToken"))
export const LocalApiToken = Schema.RedactedFromValue(SecretToken, {
  label: "Crit daemon token",
  disallowEncode: true
})
export type LocalApiToken = typeof LocalApiToken.Type
export const localApiToken = Schema.decodeUnknownSync(LocalApiToken)

export class LocalApiUnauthorized extends Schema.TaggedError<LocalApiUnauthorized>()(
  "LocalApiUnauthorized",
  { message: Schema.String },
  { httpApiStatus: 401 }
) {}

export class LocalApiOriginRejected extends Schema.TaggedError<LocalApiOriginRejected>()(
  "LocalApiOriginRejected",
  { origin: Schema.String },
  { httpApiStatus: 403 }
) {}

export class LocalApiVersionUnsupported extends Schema.TaggedError<LocalApiVersionUnsupported>()(
  "LocalApiVersionUnsupported",
  {
    requestedVersion: Schema.NullOr(Schema.String),
    supportedVersion: Schema.Literal(localApiVersion)
  },
  { httpApiStatus: 426 }
) {}

export class AuthenticatedInvocation extends Context.Service<
  AuthenticatedInvocation,
  typeof VerifiedInvocation.Type
>()("@crit/replica/http/AuthenticatedInvocation") {}

export const PresenceLeaseId = Schema.String.check(
  Schema.isPattern(/^lease_[0-9a-f]{32}$/)
).pipe(Schema.brand("PresenceLeaseId"))
export type PresenceLeaseId = typeof PresenceLeaseId.Type

export const ConnectedPersonClaim = Schema.TaggedStruct("connected-person", {})
export type ConnectedPersonClaim = typeof ConnectedPersonClaim.Type

export const ActiveAgentExecutionClaim = Schema.TaggedStruct("active-agent-execution", {
  agent: AgentSnapshot,
  executionId: ExecutionId,
  reportedRuntime: Schema.optionalKey(ReportedRuntime)
})
export type ActiveAgentExecutionClaim = typeof ActiveAgentExecutionClaim.Type

export const PresenceClaim = Schema.Union([
  ConnectedPersonClaim,
  ActiveAgentExecutionClaim
])
export type PresenceClaim = typeof PresenceClaim.Type

export const AnnouncePresence = Schema.TaggedStruct("announce-presence", {
  canvasId: CanvasId,
  claim: PresenceClaim,
  leaseId: Schema.optionalKey(PresenceLeaseId)
})
export type AnnouncePresence = typeof AnnouncePresence.Type

export const DepartPresence = Schema.TaggedStruct("depart-presence", {
  canvasId: CanvasId,
  leaseId: PresenceLeaseId
})
export type DepartPresence = typeof DepartPresence.Type

export const PresenceLeaseReceipt = Schema.Struct({
  leaseId: PresenceLeaseId,
  expiresAt: IsoTimestamp
})
export type PresenceLeaseReceipt = typeof PresenceLeaseReceipt.Type

export class PresenceClaimMismatch extends Schema.TaggedError<PresenceClaimMismatch>()(
  "PresenceClaimMismatch",
  { message: Schema.String },
  { httpApiStatus: 409 }
) {}

export class PresenceLeaseNotFound extends Schema.TaggedError<PresenceLeaseNotFound>()(
  "PresenceLeaseNotFound",
  { leaseId: PresenceLeaseId },
  { httpApiStatus: 404 }
) {}

export class LocalApiAuthorization extends HttpApiMiddleware.Service<LocalApiAuthorization, {
  readonly provides: AuthenticatedInvocation
  readonly requires: never
}>()("@crit/replica/http/LocalApiAuthorization", {
  requiredForClient: true,
  security: { bearer: HttpApiSecurity.bearer },
  error: [LocalApiUnauthorized, LocalApiOriginRejected, LocalApiVersionUnsupported]
}) {}

export class LocalCanvasApiGroup extends HttpApiGroup.make("canvas", { topLevel: true })
  .add(
    HttpApiEndpoint.get("status", "/status", {
      success: LocalDaemonStatus
    }),
    HttpApiEndpoint.post("create", "/create", {
      payload: CreateCanvas,
      success: ReplicaView,
      error: CanvasAlreadyExists.pipe(HttpApiSchema.status(409))
    }),
    HttpApiEndpoint.get("open", "/open/:canvasId", {
      params: { canvasId: CanvasId },
      success: ReplicaView,
      error: CanvasNotFound.pipe(HttpApiSchema.status(404))
    }),
    HttpApiEndpoint.post("change", "/change", {
      payload: ReplicaChange,
      success: ReplicaChangeReceipt,
      error: [
        CanvasNotFound.pipe(HttpApiSchema.status(404)),
        ChangeRejected.pipe(HttpApiSchema.status(409))
      ]
    }),
    HttpApiEndpoint.post("sync", "/sync/:canvasId", {
      params: { canvasId: CanvasId },
      success: SyncResult,
      error: CanvasNotFound.pipe(HttpApiSchema.status(404))
    })
  )
  .middleware(LocalApiAuthorization)
  .prefix(localApiPathPrefix) {}

export class LocalPresenceApiGroup extends HttpApiGroup.make("presence", { topLevel: true })
  .add(
    HttpApiEndpoint.post("announce", "/presence/announce", {
      payload: AnnouncePresence,
      success: PresenceLeaseReceipt,
      error: [
        PresenceClaimMismatch.pipe(HttpApiSchema.status(409)),
        PresenceLeaseNotFound.pipe(HttpApiSchema.status(404))
      ]
    }),
    HttpApiEndpoint.post("depart", "/presence/depart", {
      payload: DepartPresence,
      success: Schema.Void
    })
  )
  .middleware(LocalApiAuthorization)
  .prefix(localApiPathPrefix) {}

export class LocalCanvasApi extends HttpApi.make("crit-local")
  .add(LocalCanvasApiGroup)
  .add(LocalPresenceApiGroup) {}
