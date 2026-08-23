import {
  AuthorityClockLive,
  AuthorityFailure,
  CanvasAuthority,
  type VerifiedInvocation
} from "@crit/authority"
import { Id, type InstallationId } from "@crit/domain"
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
  type LocalDaemonInstanceNonce,
  LocalDaemonStatus,
  LocalApiUnauthorized,
  LocalApiVersionUnsupported,
  LocalCanvasApi,
  localApiVersion,
  localApiVersionHeader
} from "@crit/replica/http"
import { NodeHttpServer } from "@effect/platform-node"
import { Crypto, Effect, FileSystem, Layer, Redacted, Schema } from "effect"
import {
  HttpMiddleware,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse
} from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { createServer } from "node:http"

import {
  BrowserCapability,
  BrowserSession,
  type BrowserSessionService
} from "./browser-session.js"
import { SqliteCanvasReplica } from "./sqlite-replica.js"
import { SqliteCanvasAuthority } from "./sqlite.js"

export interface LocalDaemonOptions {
  readonly databasePath: string
  readonly token: LocalApiToken
  readonly allowedOrigins: ReadonlySet<string>
  readonly invocation: VerifiedInvocation
  readonly instance: LocalDaemonInstanceNonce
  readonly installationId: InstallationId
  readonly port?: number
}

const handlers = (options: LocalDaemonOptions) => HttpApiBuilder.group(
  LocalCanvasApi,
  "canvas",
  Effect.fn(function*(group) {
    const authority = yield* CanvasAuthority
    const replica = yield* CanvasReplica
    return group.handleAll({
      status: () => Effect.succeed(LocalDaemonStatus.make({
        version: 1,
        instance: options.instance,
        installationId: options.installationId,
        apiVersion: localApiVersion
      })),
      create: Effect.fn("crit.authority.create")(function*({ payload }) {
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

const bearerAuthorizationLayer = (options: LocalDaemonOptions) => Layer.succeed(
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

const BrowserSessionRequest = Schema.Struct({ capability: BrowserCapability })

const browserCors = (origin: string) => HttpMiddleware.cors({
  allowedOrigins: [origin],
  allowedMethods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["content-type", localApiVersionHeader],
  credentials: true
})

const requestAuthority = (
  request: HttpServerRequest.HttpServerRequest,
  browser: BrowserSessionService,
  expectedOrigin: string,
  requireOrigin: boolean
) => {
  if (request.headers.host !== browser.host) return "host"
  const origin = request.headers.origin
  if (origin !== undefined && origin !== expectedOrigin) return "origin"
  if (requireOrigin && origin === undefined) return "origin"
  return undefined
}

const browserAuthorizationLayer = Layer.effect(
  LocalApiAuthorization,
  Effect.gen(function*() {
    const browser = yield* BrowserSession
    return LocalApiAuthorization.of({
      bearer: Effect.fn(function*(httpEffect) {
        const request = yield* HttpServerRequest.HttpServerRequest
        const authorityFailure = requestAuthority(
          request,
          browser,
          browser.browserOrigin,
          request.method !== "GET"
        )
        if (authorityFailure !== undefined) {
          return yield* new LocalApiOriginRejected({ origin: request.headers.origin ?? "missing" })
        }
        const requestedVersion = request.headers[localApiVersionHeader]
        if (requestedVersion !== localApiVersion) {
          return yield* new LocalApiVersionUnsupported({
            requestedVersion: requestedVersion ?? null,
            supportedVersion: localApiVersion
          })
        }
        const session = request.cookies[browser.cookieName]
        if (session === undefined || !(yield* browser.authorize(session))) {
          return yield* new LocalApiUnauthorized({ message: "Missing or invalid browser session" })
        }
        return yield* Effect.provideService(
          browserCors(browser.browserOrigin)(httpEffect),
          AuthenticatedInvocation,
          browser.invocation
        )
      })
    })
  })
)

const browserDocument = `<!doctype html>
<html><head><meta charset="utf-8"><title>Crit</title></head>
<body><main id="crit">Connecting to Crit…</main><script src="bootstrap.js"></script></body></html>`

const browserScript = `
const capability = location.hash.slice(1); history.replaceState(null, "", location.pathname);
fetch("session", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ capability }) })
  .then((response) => { if (!response.ok) throw new Error("Crit browser session rejected"); return response.json() })
  .then(({ redirectTo }) => location.replace(redirectTo))
  .catch(() => { document.querySelector("#crit").textContent = "Unable to connect to Crit" });
`

const browserBootstrapRoutes = HttpRouter.use(Effect.fn(function*(router) {
  const browser = yield* BrowserSession
  const sessionPath: `/${string}` = `${browser.path}session`
  const scriptPath: `/${string}` = `${browser.path}bootstrap.js`
  const browserApiPath: `/${string}` = `${browser.path}api/v1/*`
  yield* router.add("GET", browser.path, (request) =>
    request.headers.host === browser.host
      ? Effect.succeed(HttpServerResponse.text(browserDocument, {
        contentType: "text/html; charset=utf-8",
        headers: {
          "cache-control": "no-store",
          "content-security-policy": "default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
          "referrer-policy": "no-referrer"
        }
      }))
      : Effect.succeed(HttpServerResponse.empty({ status: 403 })))
  yield* router.add("GET", scriptPath, (request) =>
    request.headers.host === browser.host
      ? Effect.succeed(HttpServerResponse.text(browserScript, {
        contentType: "text/javascript; charset=utf-8",
        headers: { "cache-control": "no-store" }
      }))
      : Effect.succeed(HttpServerResponse.empty({ status: 403 })))
  yield* router.add("POST", sessionPath, (request) => Effect.gen(function*() {
    if (requestAuthority(request, browser, browser.daemonOrigin, true) !== undefined) {
      return HttpServerResponse.empty({ status: 403 })
    }
    const contentLength = Number(request.headers["content-length"] ?? "0")
    if (Number.isFinite(contentLength) && contentLength > 256) {
      return HttpServerResponse.empty({ status: 413 })
    }
    const body = yield* HttpServerRequest.schemaBodyJson(BrowserSessionRequest).pipe(
      Effect.provideService(HttpServerRequest.MaxBodySize, FileSystem.Size(256)),
      Effect.option
    )
    if (body._tag === "None") return HttpServerResponse.empty({ status: 400 })
    const exchange = yield* browser.exchange(body.value.capability)
    if (exchange.kind === "rejected") return HttpServerResponse.empty({ status: 401 })
    return yield* HttpServerResponse.setCookie(
      HttpServerResponse.jsonUnsafe({ redirectTo: browser.browserOrigin }),
      browser.cookieName,
      exchange.session,
      { httpOnly: true, sameSite: "strict", secure: false, path: browser.path }
    ).pipe(Effect.orDie)
  }))
  yield* router.add("OPTIONS", browserApiPath, (request) => {
    if (requestAuthority(request, browser, browser.browserOrigin, true) !== undefined) {
      return Effect.succeed(HttpServerResponse.empty({ status: 403 }))
    }
    return browserCors(browser.browserOrigin)(Effect.succeed(HttpServerResponse.empty({ status: 204 })))
  })
}))

const changeIds = Layer.effect(ReplicaChangeIds, Effect.gen(function*() {
  const crypto = yield* Crypto.Crypto
  return ReplicaChangeIds.of({
    next: crypto.randomUUIDv4.pipe(
      Effect.map((uuid) => Id.change(`change_${uuid.replaceAll("-", "")}`)),
      Effect.mapError((cause) => new ChangeIdGenerationFailure({ reason: cause.message }))
    )
  })
}))

const daemonLayer = (
  options: LocalDaemonOptions,
  browser: BrowserSessionService | undefined
) => {
    const authority = SqliteCanvasAuthority.layer({ path: options.databasePath }).pipe(
      Layer.provide(AuthorityClockLive)
    )
    const services = SqliteCanvasReplica.layer({ path: options.databasePath }).pipe(
      Layer.provide(changeIds),
      Layer.provideMerge(authority)
    )
    const bearerRoutes = HttpApiBuilder.layer(LocalCanvasApi).pipe(
      Layer.provide(handlers(options)),
      Layer.provide(bearerAuthorizationLayer(options))
    )
    const browserCanvasRoutes = HttpRouter.use(Effect.fn(function*(router) {
      const session = yield* BrowserSession
      yield* Layer.build(
        HttpApiBuilder.layer(LocalCanvasApi).pipe(
          Layer.provide(handlers(options)),
          Layer.provide(browserAuthorizationLayer),
          Layer.provide(Layer.succeed(HttpRouter.HttpRouter, router.prefixed(session.path)))
        )
      )
    }))
    const routeDefinitions = browser === undefined
      ? bearerRoutes
      : Layer.mergeAll(bearerRoutes, browserBootstrapRoutes, browserCanvasRoutes).pipe(
        Layer.provide(Layer.succeed(BrowserSession, browser))
      )
    const routes = routeDefinitions.pipe(Layer.provide(services))
    return HttpRouter.serve(routes).pipe(
      Layer.provideMerge(NodeHttpServer.layer(createServer, {
        host: "127.0.0.1",
        port: options.port ?? 0
      }))
    )
}

export const LocalDaemon = {
  layer: (options: LocalDaemonOptions) => daemonLayer(options, undefined)
}

export const localDaemonWithBrowser = daemonLayer
