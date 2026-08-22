import {
  CanvasAlreadyExists,
  CanvasNotFound,
  ChangeRejected,
  CreateCanvas,
  VerifiedInvocation
} from "@crit/authority"
import { CanvasId, InstallationId } from "@crit/domain"
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

const SecretToken = Schema.String.check(Schema.isMinLength(32)).pipe(Schema.brand("LocalApiToken"))
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
