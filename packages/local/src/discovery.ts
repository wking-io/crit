import { LocalCanvasClient, type LocalCanvasClientService } from "@crit/client"
import {
  LocalApiUnauthorized,
  LocalApiVersionUnsupported,
  localApiToken
} from "@crit/replica/http"
import { Context, Duration, Effect, FileSystem, Layer, Option, Path, Predicate, Schema } from "effect"
import { FetchHttpClient } from "effect/unstable/http"

import { LocalDaemonDescriptor, LocalInstallation } from "./development.js"
import { decodeStored } from "./stored-json.js"

export const LocalDaemonStaleReason = Schema.Literals([
  "connection-failed",
  "probe-timed-out"
])
export type LocalDaemonStaleReason = typeof LocalDaemonStaleReason.Type

export class LocalDaemonStateMissing extends Schema.TaggedError<LocalDaemonStateMissing>()(
  "LocalDaemonStateMissing",
  { state: Schema.Literal("installation"), path: Schema.String }
) {}

export class LocalDaemonStateUnreadable extends Schema.TaggedError<LocalDaemonStateUnreadable>()(
  "LocalDaemonStateUnreadable",
  { state: Schema.Literals(["installation", "descriptor"]), path: Schema.String, reason: Schema.String }
) {}

export class LocalDaemonStateMalformed extends Schema.TaggedError<LocalDaemonStateMalformed>()(
  "LocalDaemonStateMalformed",
  { state: Schema.Literals(["installation", "descriptor"]), path: Schema.String, reason: Schema.String }
) {}

export class LocalDaemonIdentityMismatch extends Schema.TaggedError<LocalDaemonIdentityMismatch>()(
  "LocalDaemonIdentityMismatch",
  { source: Schema.Literals(["descriptor", "daemon"]), reason: Schema.String }
) {}

export class LocalDaemonProtocolFailure extends Schema.TaggedError<LocalDaemonProtocolFailure>()(
  "LocalDaemonProtocolFailure",
  { reason: Schema.String }
) {}

export type LocalDaemonInspection =
  | { readonly kind: "Running"; readonly descriptor: LocalDaemonDescriptor; readonly client: LocalCanvasClientService }
  | { readonly kind: "Stopped" }
  | { readonly kind: "StaleDescriptor"; readonly descriptor: LocalDaemonDescriptor; readonly reason: LocalDaemonStaleReason }

type ProbeResult =
  | { readonly kind: "responded"; readonly status: import("@crit/replica/http").LocalDaemonStatus }
  | { readonly kind: "stale"; readonly reason: LocalDaemonStaleReason }

const stopped = (): LocalDaemonInspection => ({ kind: "Stopped" })
const stale = (
  descriptor: LocalDaemonDescriptor,
  reason: LocalDaemonStaleReason
): LocalDaemonInspection => ({ kind: "StaleDescriptor", descriptor, reason })
const running = (
  descriptor: LocalDaemonDescriptor,
  client: LocalCanvasClientService
): LocalDaemonInspection => ({ kind: "Running", descriptor, client })

export interface LocalDaemonDiscoveryOptions {
  readonly dataRoot: string
  readonly probeTimeout?: Duration.Input
}

export const AGENT_SESSION_ENV = "CRIT_AGENT_SESSION"

export const inspectLocalDaemon = (options: LocalDaemonDiscoveryOptions) => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const installationPath = path.join(options.dataRoot, "installation.json")
  const descriptorPath = path.join(options.dataRoot, "daemon.json")

  if (!(yield* fs.exists(installationPath).pipe(
    Effect.mapError((cause) => new LocalDaemonStateUnreadable({
      state: "installation",
      path: installationPath,
      reason: String(cause)
    }))
  ))) {
    return yield* new LocalDaemonStateMissing({ state: "installation", path: installationPath })
  }

  const read = <S extends Schema.ConstraintDecoder<unknown>>(
    schema: S,
    state: "installation" | "descriptor",
    target: string
  ): Effect.Effect<S["Type"], LocalDaemonStateUnreadable | LocalDaemonStateMalformed> => fs.readFileString(target).pipe(
    Effect.mapError((cause) => new LocalDaemonStateUnreadable({ state, path: target, reason: String(cause) })),
    Effect.flatMap((contents) => Effect.try({
      try: () => decodeStored(schema, contents),
      catch: () => new LocalDaemonStateMalformed({
        state,
        path: target,
        reason: "Stored JSON does not match the required schema"
      })
    }))
  )

  const installation = yield* read(LocalInstallation, "installation", installationPath)
  if (!(yield* fs.exists(descriptorPath).pipe(
    Effect.mapError((cause) => new LocalDaemonStateUnreadable({
      state: "descriptor",
      path: descriptorPath,
      reason: String(cause)
    }))
  ))) return stopped()
  const descriptor = yield* read(LocalDaemonDescriptor, "descriptor", descriptorPath)
  if (descriptor.installationId !== installation.installationId) {
    return yield* new LocalDaemonIdentityMismatch({
      source: "descriptor",
      reason: "Descriptor installation does not match the local installation"
    })
  }

  const presentedSession = process.env[AGENT_SESSION_ENV]
  const bearerSecret = presentedSession !== undefined && presentedSession.length > 0
    ? presentedSession
    : installation.bearerSecret
  const token = yield* Effect.try({
    try: () => localApiToken(bearerSecret),
    catch: () => new LocalDaemonProtocolFailure({ reason: "Bearer credential is invalid" })
  })
  const clientContext = yield* Layer.buildWithScope(
    LocalCanvasClient.layer({
      _tag: "bearer",
      baseUrl: descriptor.baseUrl,
      token
    }).pipe(Layer.provide(FetchHttpClient.layer)),
    yield* Effect.scope
  )
  const client = Context.get(clientContext, LocalCanvasClient)
  const status = yield* client.status().pipe(
    Effect.map((status): ProbeResult => ({ kind: "responded", status })),
    Effect.timeoutOption(options.probeTimeout ?? "500 millis"),
    Effect.map(Option.getOrElse((): ProbeResult => ({ kind: "stale", reason: "probe-timed-out" }))),
    Effect.catchTag("HttpClientError", (failure) => Predicate.isTagged(failure.reason, "TransportError")
      ? Effect.succeed<ProbeResult>({ kind: "stale", reason: "connection-failed" })
      : Effect.fail(new LocalDaemonProtocolFailure({ reason: failure.reason._tag }))),
    Effect.mapError((failure) => {
      if (failure instanceof LocalApiUnauthorized || failure instanceof LocalApiVersionUnsupported) return failure
      return new LocalDaemonProtocolFailure({ reason: String(failure) })
    })
  )
  if (status.kind === "stale") {
    return stale(descriptor, status.reason)
  }
  if (
    status.status.installationId !== descriptor.installationId ||
    status.status.instance !== descriptor.instance ||
    status.status.apiVersion !== descriptor.apiVersion
  ) {
    return yield* new LocalDaemonIdentityMismatch({
      source: "daemon",
      reason: "Authenticated daemon identity does not match its descriptor"
    })
  }
  return running(descriptor, client)
})
