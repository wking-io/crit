import {
  AuthorityClockLive,
  AuthorityFailure,
  CanvasAuthority,
  type VerifiedInvocation
} from "@crit/authority"
import { Id } from "@crit/domain"
import {
  CanvasReplica,
  ChangeIdGenerationFailure,
  ReplicaChangeIds
} from "@crit/replica"
import {
  AuthenticatedInvocation,
  LocalApiAuthorization,
  LocalApiOriginRejected,
  LocalApiToken,
  LocalApiUnauthorized,
  LocalApiVersionUnsupported,
  LocalCanvasApi,
  localApiVersion,
  localApiVersionHeader
} from "@crit/replica/http"
import { NodeHttpServer } from "@effect/platform-node"
import { Crypto, Effect, Layer, Redacted } from "effect"
import { HttpRouter, HttpServerRequest } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { createServer } from "node:http"

import { SqliteCanvasReplica } from "./sqlite-replica.js"
import { SqliteCanvasAuthority } from "./sqlite.js"

export interface LocalDaemonOptions {
  readonly databasePath: string
  readonly token: LocalApiToken
  readonly allowedOrigins: ReadonlySet<string>
  readonly invocation: VerifiedInvocation
  readonly port?: number
}

const handlers = HttpApiBuilder.group(
  LocalCanvasApi,
  "canvas",
  Effect.fn(function*(group) {
    const authority = yield* CanvasAuthority
    const replica = yield* CanvasReplica
    return group.handleAll({
      create: Effect.fn(function*({ payload }) {
        const invocation = yield* AuthenticatedInvocation
        yield* authority.create(payload, invocation)
        return yield* replica.open(payload.canvasId).pipe(Effect.orDie)
      }),
      open: ({ params }) => replica.open(params.canvasId).pipe(
        Effect.mapError((failure) => failure._tag === "ReplicaCanvasNotFound"
          ? AuthorityFailure.canvasNotFound({ canvasId: failure.canvasId })
          : failure),
        Effect.catchTag("ReplicaInvariantFailure", Effect.die)
      ),
      change: Effect.fn(function*({ payload }) {
        const invocation = yield* AuthenticatedInvocation
        return yield* replica.change(payload, invocation).pipe(
          Effect.mapError((failure) => {
            switch (failure._tag) {
              case "ReplicaNotOpen":
                return AuthorityFailure.canvasNotFound({ canvasId: failure.canvasId })
              case "LocalChangeRejected":
                return AuthorityFailure.changeRejected({
                  canvasId: failure.canvasId,
                  changeId: failure.changeId,
                  failure: failure.failure
                })
              default:
                return failure
            }
          }),
          Effect.catchTags({
            ChangeIdGenerationFailure: Effect.die,
            ChangeIdAlreadyPresent: Effect.die,
            ReplicaInvariantFailure: Effect.die
          })
        )
      }),
      sync: ({ params }) => replica.sync(params.canvasId).pipe(
        Effect.mapError((failure) => failure._tag === "ReplicaNotOpen" || failure._tag === "ReplicaCanvasNotFound"
          ? AuthorityFailure.canvasNotFound({ canvasId: failure.canvasId })
          : failure),
        Effect.catchTags({
          ReplicaDiverged: Effect.die,
          ReplicaInvariantFailure: Effect.die
        })
      )
    })
  })
)

const authorizationLayer = (options: LocalDaemonOptions) => Layer.succeed(
  LocalApiAuthorization,
  LocalApiAuthorization.of({
    bearer: Effect.fn(function*(httpEffect, { credential }) {
      if (Redacted.value(credential) !== Redacted.value(options.token)) {
        return yield* new LocalApiUnauthorized({ message: "Missing or invalid bearer token" })
      }
      const request = yield* HttpServerRequest.HttpServerRequest
      const requestedVersion = request.headers[localApiVersionHeader]
      if (requestedVersion !== localApiVersion) {
        return yield* new LocalApiVersionUnsupported({
          requestedVersion: requestedVersion ?? null,
          supportedVersion: localApiVersion
        })
      }
      const origin = request.headers.origin
      if (origin !== undefined && !options.allowedOrigins.has(origin)) {
        return yield* new LocalApiOriginRejected({ origin })
      }
      return yield* Effect.provideService(
        httpEffect,
        AuthenticatedInvocation,
        options.invocation
      )
    })
  })
)

const changeIds = Layer.effect(ReplicaChangeIds, Effect.gen(function*() {
  const crypto = yield* Crypto.Crypto
  return ReplicaChangeIds.of({
    next: crypto.randomUUIDv4.pipe(
      Effect.map((uuid) => Id.change(`change_${uuid.replaceAll("-", "")}`)),
      Effect.mapError((cause) => new ChangeIdGenerationFailure({ reason: cause.message }))
    )
  })
}))

export const LocalDaemon = {
  layer: (options: LocalDaemonOptions) => {
    const authority = SqliteCanvasAuthority.layer({ path: options.databasePath }).pipe(
      Layer.provide(AuthorityClockLive)
    )
    const services = SqliteCanvasReplica.layer({ path: options.databasePath }).pipe(
      Layer.provide(changeIds),
      Layer.provideMerge(authority)
    )
    const routes = HttpApiBuilder.layer(LocalCanvasApi).pipe(
      Layer.provide(handlers),
      Layer.provide(authorizationLayer(options)),
      Layer.provide(services)
    )
    return HttpRouter.serve(routes).pipe(
      Layer.provideMerge(NodeHttpServer.layer(createServer, {
        host: "127.0.0.1",
        port: options.port ?? 0
      }))
    )
  }
}
