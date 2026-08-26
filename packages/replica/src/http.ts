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
  CanvasTitle,
  ExecutionId,
  InstallationId,
  PersonSnapshot,
  ReportedRuntime
} from "@crit/domain"
import { ReplicaChangedSchema } from "@crit/protocol"
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
  ReplicaChangedSchema
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

export const CanvasListing = Schema.Struct({
  canvasId: CanvasId,
  title: CanvasTitle
})
export type CanvasListing = typeof CanvasListing.Type

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
    HttpApiEndpoint.get("list", "/canvas", {
      success: Schema.Array(CanvasListing)
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

export class LocalCanvasApi extends HttpApi.make("crit-local").add(LocalCanvasApiGroup) {}

const DisplayName = PersonSnapshot.fields.displayName

export const AgentSessionDeclaration = Schema.Struct({
  displayName: DisplayName,
  reportedRuntime: Schema.optionalKey(ReportedRuntime)
})
export type AgentSessionDeclaration = typeof AgentSessionDeclaration.Type

const AgentSessionSecret = Schema.String.check(
  Schema.isMinLength(32),
  Schema.isMaxLength(256)
).pipe(Schema.brand("AgentSessionToken"))
export const AgentSessionToken = Schema.RedactedFromValue(AgentSessionSecret, {
  label: "Crit agent session"
})
export type AgentSessionToken = typeof AgentSessionToken.Type

export const AgentSessionGrant = Schema.Struct({
  token: AgentSessionToken,
  agent: AgentSnapshot,
  executionId: ExecutionId
})
export type AgentSessionGrant = typeof AgentSessionGrant.Type

export class AgentSessionRejected extends Schema.TaggedError<AgentSessionRejected>()(
  "AgentSessionRejected",
  {
    reason: Schema.Literals([
      "delegation-not-person",
      "session-limit"
    ])
  },
  { httpApiStatus: 403 }
) {}

export class LocalAgentApiGroup extends HttpApiGroup.make("agent", { topLevel: true })
  .add(
    HttpApiEndpoint.post("begin", "/agent/begin", {
      payload: AgentSessionDeclaration,
      success: AgentSessionGrant,
      error: AgentSessionRejected
    })
  )
  .middleware(LocalApiAuthorization)
  .prefix(localApiPathPrefix) {}

export class LocalAgentApi extends HttpApi.make("crit-local-agent").add(LocalAgentApiGroup) {}
