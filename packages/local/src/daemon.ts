import {
  AuthorityClockLive,
  AuthorityFailure,
  CanvasAuthority,
  type VerifiedInvocation
} from "@crit/authority"
import { LocalBrowserConnection } from "@crit/client"
import { CanvasId, Id, type InstallationId } from "@crit/domain"
import {
  CanvasReplica,
  ChangeIdGenerationFailure,
  ReplicaChangeIds
} from "@crit/replica"
import {
  AgentSessionRejected,
  AuthenticatedInvocation,
  LocalAgentApi,
  LocalApiAuthorization,
  LocalApiOriginRejected,
  LocalApiToken,
  type LocalDaemonInstanceNonce,
  LocalDaemonStatus,
  LocalApiUnauthorized,
  LocalApiVersionUnsupported,
  LocalCanvasApi,
  LocalReplicaSocketHello,
  LocalReplicaSocketReady,
  localReplicaNotificationsPath,
  localReplicaSocketCloseCode,
  localApiVersion,
  localApiVersionHeader
} from "@crit/replica/http"
import {
  LocalRepresentationCaptureFailure,
  LocalRepresentationCaptureRequest,
  LocalRepresentationResolveFailure,
  LocalRepresentationResolveRequest,
  RepresentationRuntime,
  localRepresentationCapturePath,
  localRepresentationResolvePath
} from "@crit/representations"
import { NodeHttpServer } from "@effect/platform-node"
import { Crypto, Effect, Fiber, FileSystem, Layer, Match, Option, Pull, Queue, Redacted, Schema, Stream } from "effect"
import {
  HttpMiddleware,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse
} from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import * as Socket from "effect/unstable/socket/Socket"
import { createServer } from "node:http"

import { AgentSessions, type AgentSessionsService } from "./agent-sessions.js"
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

type LocalRequestAuthorizationFailure =
  | LocalApiUnauthorized
  | LocalApiOriginRejected
  | LocalApiVersionUnsupported

const resolveBearerInvocation = (
  request: HttpServerRequest.HttpServerRequest,
  options: LocalDaemonOptions,
  sessions: AgentSessionsService,
  credential: string | undefined
): Effect.Effect<VerifiedInvocation, LocalRequestAuthorizationFailure> =>
  Effect.gen(function*() {
    if (credential === undefined) {
      return yield* new LocalApiUnauthorized({ message: "Missing or invalid bearer token" })
    }
    const agent = yield* sessions.invocationFor(credential)
    const invocation = Option.isSome(agent)
      ? agent.value
      : credential === Redacted.value(options.token)
        ? options.invocation
        : undefined
    if (invocation === undefined) {
      return yield* new LocalApiUnauthorized({ message: "Missing or invalid bearer token" })
    }
    const origin = request.headers.origin
    if (origin !== undefined && !options.allowedOrigins.has(origin)) {
      return yield* new LocalApiOriginRejected({ origin })
    }
    return invocation
  })

const authorizeBearerRequest = (
  request: HttpServerRequest.HttpServerRequest,
  options: LocalDaemonOptions,
  sessions: AgentSessionsService,
  credential: string | undefined
): Effect.Effect<VerifiedInvocation, LocalRequestAuthorizationFailure> =>
  Effect.gen(function*() {
    const invocation = yield* resolveBearerInvocation(request, options, sessions, credential)
    const requestedVersion = request.headers[localApiVersionHeader]
    if (requestedVersion !== localApiVersion) {
      return yield* new LocalApiVersionUnsupported({
        requestedVersion: requestedVersion ?? null,
        supportedVersion: localApiVersion
      })
    }
    return invocation
  })

const bearerCredential = (request: HttpServerRequest.HttpServerRequest) =>
  request.headers.authorization?.startsWith("Bearer ")
    ? request.headers.authorization.slice("Bearer ".length)
    : undefined

const authorizationFailureResponse = (failure: LocalRequestAuthorizationFailure) => {
  switch (failure._tag) {
    case "LocalApiUnauthorized":
      return HttpServerResponse.jsonUnsafe(failure, { status: 401 })
    case "LocalApiOriginRejected":
      return HttpServerResponse.jsonUnsafe(failure, { status: 403 })
    case "LocalApiVersionUnsupported":
      return HttpServerResponse.jsonUnsafe(failure, { status: 426 })
  }
}

const bearerAuthorizationLayer = (options: LocalDaemonOptions) => Layer.effect(
  LocalApiAuthorization,
  Effect.gen(function*() {
    const sessions = yield* AgentSessions
    return LocalApiAuthorization.of({
      bearer: Effect.fn(function*(httpEffect, { credential }) {
        const request = yield* HttpServerRequest.HttpServerRequest
        const invocation = yield* authorizeBearerRequest(
          request,
          options,
          sessions,
          Redacted.value(credential)
        )
        return yield* Effect.provideService(
          httpEffect,
          AuthenticatedInvocation,
          invocation
        )
      })
    })
  })
)

const agentHandlers = HttpApiBuilder.group(
  LocalAgentApi,
  "agent",
  Effect.fn(function*(group) {
    const sessions = yield* AgentSessions
    return group.handleAll({
      begin: Effect.fn(function*({ payload }) {
        const invocation = yield* AuthenticatedInvocation
        if (invocation._tag !== "person") {
          return yield* new AgentSessionRejected({ reason: "delegation-not-person" })
        }
        const { grant } = yield* sessions.begin(payload, invocation.principal.person)
        return grant
      })
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

const browserRequestAuthority = (
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

const browserRequestAuthorizationFailure = (
  request: HttpServerRequest.HttpServerRequest,
  browser: BrowserSessionService,
  requireOrigin: boolean
): Effect.Effect<LocalRequestAuthorizationFailure | undefined> => Effect.gen(function*() {
  if (browserRequestAuthority(request, browser, browser.browserOrigin, requireOrigin) !== undefined) {
    return new LocalApiOriginRejected({ origin: request.headers.origin ?? "missing" })
  }
  return yield* browserSessionAuthorizationFailure(request, browser)
})

const browserSessionAuthorizationFailure = (
  request: HttpServerRequest.HttpServerRequest,
  browser: BrowserSessionService
): Effect.Effect<LocalRequestAuthorizationFailure | undefined> => Effect.gen(function*() {
  const requestedVersion = request.headers[localApiVersionHeader]
  if (requestedVersion !== localApiVersion) {
    return new LocalApiVersionUnsupported({
      requestedVersion: requestedVersion ?? null,
      supportedVersion: localApiVersion
    })
  }
  const session = request.cookies[browser.cookieName]
  if (session === undefined || !(yield* browser.authorize(session))) {
    return new LocalApiUnauthorized({ message: "Missing or invalid browser session" })
  }
  return undefined
})

const isWebSocketUpgrade = (request: HttpServerRequest.HttpServerRequest) =>
  request.headers.upgrade?.toLowerCase() === "websocket"

const notificationSocket = (
  replica: CanvasReplica["Service"],
  canvasId: CanvasId,
  bearerOptions: LocalDaemonOptions | undefined,
  sessions: AgentSessionsService | undefined
) => Effect.gen(function*() {
  const request = yield* HttpServerRequest.HttpServerRequest
  const upgraded = yield* Effect.result(request.upgrade)
  if (upgraded._tag === "Failure") return HttpServerResponse.empty({ status: 400 })
  const socket = upgraded.success
  const write = yield* socket.writer
  const firstFrame = yield* Queue.bounded<string>(1)
  let awaitingFirstFrame = true
  const socketFiber = yield* socket.runString((message) => {
    if (!awaitingFirstFrame) return undefined
    awaitingFirstFrame = false
    return Queue.offer(firstFrame, message)
  }).pipe(Effect.forkScoped)
  if (bearerOptions !== undefined) {
    const candidate = yield* Queue.take(firstFrame).pipe(Effect.timeoutOption("2 seconds"))
    if (candidate._tag === "None" || new TextEncoder().encode(candidate.value).byteLength > 512) {
      yield* write(new Socket.CloseEvent(localReplicaSocketCloseCode.unauthorized, "authentication required"))
      return HttpServerResponse.empty()
    }
    const hello = Schema.decodeUnknownOption(Schema.fromJsonString(LocalReplicaSocketHello))(candidate.value)
    const authorized = hello._tag === "None" || sessions === undefined
      ? undefined
      : yield* Effect.result(resolveBearerInvocation(
        request,
        bearerOptions,
        sessions,
        hello.value.bearer
      ))
    if (authorized === undefined || authorized._tag === "Failure") {
      yield* write(new Socket.CloseEvent(localReplicaSocketCloseCode.unauthorized, "authentication rejected"))
      return HttpServerResponse.empty()
    }
  }
  const subscribed = yield* Effect.result(replica.subscribe(canvasId))
  if (subscribed._tag === "Failure") {
    yield* write(new Socket.CloseEvent(localReplicaSocketCloseCode.replicaNotOpen, "canvas is not open"))
    return HttpServerResponse.empty()
  }
  const pull = yield* Stream.toPull(subscribed.success)
  yield* write(JSON.stringify(LocalReplicaSocketReady.make({
    kind: "subscription-ready",
    schemaVersion: 1,
    canvasId
  })))
  const send = Effect.forever(pull.pipe(
    Effect.flatMap((events) => Effect.forEach(events, (event) => write(JSON.stringify(event)), {
      discard: true
    }))
  )).pipe(Pull.catchDone(() => Effect.void))
  yield* Effect.raceFirst(
    Fiber.await(socketFiber),
    send
  ).pipe(Effect.catch(() => Effect.void))
  return HttpServerResponse.empty()
})

const bearerNotificationRoutes = (options: LocalDaemonOptions) => HttpRouter.use(Effect.fn(function*(router) {
  const replica = yield* CanvasReplica
  const sessions = yield* AgentSessions
  yield* router.add("GET", localReplicaNotificationsPath, (request) => Effect.gen(function*() {
    if (!isWebSocketUpgrade(request)) return HttpServerResponse.empty({ status: 400 })
    const origin = request.headers.origin
    if (origin !== undefined && !options.allowedOrigins.has(origin)) {
      return HttpServerResponse.empty({ status: 403 })
    }
    const route = yield* HttpRouter.RouteContext
    const decoded = Schema.decodeUnknownOption(CanvasId)(route.params.canvasId)
    if (decoded._tag === "None") return HttpServerResponse.empty({ status: 400 })
    return yield* notificationSocket(replica, decoded.value, options, sessions).pipe(
      Effect.catch(() => Effect.succeed(HttpServerResponse.empty()))
    )
  }))
}))

const browserNotificationRoutes = HttpRouter.use(Effect.fn(function*(router) {
  const browser = yield* BrowserSession
  const replica = yield* CanvasReplica
  const path: `/${string}` = `${browser.path}${localReplicaNotificationsPath.slice(1)}`
  yield* router.add("GET", path, (request) => Effect.gen(function*() {
    if (!isWebSocketUpgrade(request)) return HttpServerResponse.empty({ status: 400 })
    if (browserRequestAuthority(request, browser, browser.browserOrigin, true) !== undefined) {
      return HttpServerResponse.empty({ status: 403 })
    }
    const session = request.cookies[browser.cookieName]
    if (session === undefined || !(yield* browser.authorize(session))) {
      return HttpServerResponse.empty({ status: 401 })
    }
    const route = yield* HttpRouter.RouteContext
    const decoded = Schema.decodeUnknownOption(CanvasId)(route.params.canvasId)
    if (decoded._tag === "None") return HttpServerResponse.empty({ status: 400 })
    return yield* notificationSocket(replica, decoded.value, undefined, undefined).pipe(
      Effect.catch(() => Effect.succeed(HttpServerResponse.empty()))
    )
  }))
}))

const browserAuthorizationLayer = Layer.effect(
  LocalApiAuthorization,
  Effect.gen(function*() {
    const browser = yield* BrowserSession
    return LocalApiAuthorization.of({
      bearer: Effect.fn(function*(httpEffect) {
        const request = yield* HttpServerRequest.HttpServerRequest
        const failure = yield* browserRequestAuthorizationFailure(request, browser, request.method !== "GET")
        if (failure !== undefined) return yield* failure
        return yield* Effect.provideService(
          browserCors(browser.browserOrigin)(httpEffect),
          AuthenticatedInvocation,
          browser.invocation
        )
      })
    })
  })
)

const representationFailureResponse = (reason: "application-binding" | "artifact-store") =>
  HttpServerResponse.jsonUnsafe(new LocalRepresentationResolveFailure({
    schemaVersion: 1,
    reason
  }), { status: 500 })

const invalidRepresentationRequest = Schema.Literal("invalid").make("invalid")
const oversizedRepresentationRequest = Schema.Literal("too-large").make("too-large")

const representationRequestBody = <A, I>(
  request: HttpServerRequest.HttpServerRequest,
  schema: Schema.Codec<A, I>
) => Effect.gen(function*() {
  const limit = 16_384
  const body = yield* request.arrayBuffer.pipe(
    Effect.provideService(HttpServerRequest.MaxBodySize, FileSystem.Size(limit)),
    Effect.option
  )
  if (body._tag === "None") return oversizedRepresentationRequest
  return Schema.decodeUnknownOption(
    Schema.fromJsonString(schema),
    { onExcessProperty: "error" }
  )(new TextDecoder().decode(body.value)).pipe(
    Option.match({
      onNone: () => invalidRepresentationRequest,
      onSome: (value) => value
    })
  )
})

const resolveRepresentation = Effect.fn(function*() {
  const runtime = yield* RepresentationRuntime
  const request = yield* HttpServerRequest.HttpServerRequest
  const contentLengthHeader = request.headers["content-length"]
  if (contentLengthHeader === undefined) return HttpServerResponse.empty({ status: 411 })
  const contentLength = Number(contentLengthHeader)
  if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
    return HttpServerResponse.empty({ status: 400 })
  }
  if (contentLength > 16_384) {
    return HttpServerResponse.empty({ status: 413 })
  }
  const body = yield* representationRequestBody(
    request,
    LocalRepresentationResolveRequest
  )
  if (body === oversizedRepresentationRequest) {
    return HttpServerResponse.empty({ status: 413 })
  }
  if (body === invalidRepresentationRequest) {
    return HttpServerResponse.empty({ status: 400 })
  }
  return yield* runtime.resolve(body.representation).pipe(
    Effect.map(Match.valueTags({
      "artifact-bytes": (plan) => HttpServerResponse.uint8Array(plan.bytes, {
        contentType: "application/octet-stream"
      }),
      iframe: (plan) => HttpServerResponse.jsonUnsafe(plan),
      unavailable: (plan) => HttpServerResponse.jsonUnsafe(plan)
    })),
    Effect.catchTags({
      ApplicationBindingLookupFailure: () => Effect.succeed(representationFailureResponse("application-binding")),
      ArtifactStoreIoFailure: () => Effect.succeed(representationFailureResponse("artifact-store"))
    })
  )
})

const captureFailureResponse = (
  reason:
    | "source-unavailable"
    | "source-unreachable"
    | "application-binding"
    | "artifact-store"
) => HttpServerResponse.jsonUnsafe(new LocalRepresentationCaptureFailure({
  schemaVersion: 1,
  reason
}), { status: 500 })

const captureRepresentation = Effect.fn(function*() {
  const runtime = yield* RepresentationRuntime
  const request = yield* HttpServerRequest.HttpServerRequest
  const contentLengthHeader = request.headers["content-length"]
  if (contentLengthHeader === undefined) return HttpServerResponse.empty({ status: 411 })
  const contentLength = Number(contentLengthHeader)
  if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
    return HttpServerResponse.empty({ status: 400 })
  }
  if (contentLength > 16_384) {
    return HttpServerResponse.empty({ status: 413 })
  }
  const body = yield* representationRequestBody(
    request,
    LocalRepresentationCaptureRequest
  )
  if (body === oversizedRepresentationRequest) {
    return HttpServerResponse.empty({ status: 413 })
  }
  if (body === invalidRepresentationRequest) {
    return HttpServerResponse.empty({ status: 400 })
  }
  return yield* runtime.capture(body.representation).pipe(
    Effect.map(HttpServerResponse.jsonUnsafe),
    Effect.catchTags({
      ApplicationBindingLookupFailure: () =>
        Effect.succeed(captureFailureResponse("application-binding")),
      ArtifactStoreIoFailure: () =>
        Effect.succeed(captureFailureResponse("artifact-store")),
      CaptureSourceUnavailable: () =>
        Effect.succeed(captureFailureResponse("source-unavailable")),
      LiveContentUnreachable: () =>
        Effect.succeed(captureFailureResponse("source-unreachable"))
    })
  )
})

const bearerRepresentationRoutes = (options: LocalDaemonOptions) => HttpRouter.use(Effect.fn(function*(router) {
  const sessions = yield* AgentSessions
  yield* router.add("POST", localRepresentationResolvePath, (request) =>
    authorizeBearerRequest(request, options, sessions, bearerCredential(request)).pipe(
      Effect.matchEffect({
        onFailure: (failure) => Effect.succeed(authorizationFailureResponse(failure)),
        onSuccess: () => resolveRepresentation()
      })
    ))
  yield* router.add("POST", localRepresentationCapturePath, (request) =>
    authorizeBearerRequest(request, options, sessions, bearerCredential(request)).pipe(
      Effect.matchEffect({
        onFailure: (failure) => Effect.succeed(authorizationFailureResponse(failure)),
        onSuccess: () => captureRepresentation()
      })
    ))
}))

const browserRepresentationRoutes = HttpRouter.use(Effect.fn(function*(router) {
  const browser = yield* BrowserSession
  const resolvePath: `/${string}` = `${browser.path}${localRepresentationResolvePath.slice(1)}`
  yield* router.add("POST", resolvePath, (request) => Effect.gen(function*() {
    if (browserRequestAuthority(request, browser, browser.browserOrigin, true) !== undefined) {
      return authorizationFailureResponse(new LocalApiOriginRejected({
        origin: request.headers.origin ?? "missing"
      }))
    }
    const failure = yield* browserSessionAuthorizationFailure(request, browser)
    const response = failure === undefined
      ? resolveRepresentation()
      : Effect.succeed(authorizationFailureResponse(failure))
    return yield* browserCors(browser.browserOrigin)(response)
  }))
  const capturePath: `/${string}` = `${browser.path}${localRepresentationCapturePath.slice(1)}`
  yield* router.add("POST", capturePath, (request) => Effect.gen(function*() {
    if (browserRequestAuthority(request, browser, browser.browserOrigin, true) !== undefined) {
      return authorizationFailureResponse(new LocalApiOriginRejected({
        origin: request.headers.origin ?? "missing"
      }))
    }
    const failure = yield* browserSessionAuthorizationFailure(request, browser)
    const response = failure === undefined
      ? captureRepresentation()
      : Effect.succeed(authorizationFailureResponse(failure))
    return yield* browserCors(browser.browserOrigin)(response)
  }))
}))

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
    if (browserRequestAuthority(request, browser, browser.daemonOrigin, true) !== undefined) {
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
      HttpServerResponse.jsonUnsafe({
        redirectTo: `${browser.browserOrigin}${LocalBrowserConnection.encode(browser.connection)}`
      }),
      browser.cookieName,
      exchange.session,
      { httpOnly: true, sameSite: "strict", secure: false, path: browser.path }
    ).pipe(Effect.orDie)
  }))
  yield* router.add("OPTIONS", browserApiPath, (request) => {
    if (browserRequestAuthority(request, browser, browser.browserOrigin, true) !== undefined) {
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
    const sessions = AgentSessions.layer({ databasePath: options.databasePath })
    const bearerRoutes = HttpApiBuilder.layer(LocalCanvasApi).pipe(
      Layer.provide(handlers(options)),
      Layer.provide(bearerAuthorizationLayer(options))
    )
    const agentRoutes = HttpApiBuilder.layer(LocalAgentApi).pipe(
      Layer.provide(agentHandlers),
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
      ? Layer.mergeAll(bearerRoutes, agentRoutes, bearerNotificationRoutes(options), bearerRepresentationRoutes(options))
      : Layer.mergeAll(bearerRoutes, agentRoutes, bearerNotificationRoutes(options), bearerRepresentationRoutes(options), browserBootstrapRoutes, browserCanvasRoutes, browserNotificationRoutes, browserRepresentationRoutes).pipe(
        Layer.provide(Layer.succeed(BrowserSession, browser))
      )
    const routes = routeDefinitions.pipe(Layer.provide(services), Layer.provide(sessions))
    return HttpRouter.serve(routes).pipe(
      Layer.provideMerge(NodeHttpServer.layer(createServer, {
        host: "127.0.0.1",
        port: options.port ?? 0,
        websocket: { maxPayload: 512 }
      }))
    )
}

export const LocalDaemon = {
  layer: (options: LocalDaemonOptions) => daemonLayer(options, undefined)
}

export const localDaemonWithBrowser = daemonLayer
