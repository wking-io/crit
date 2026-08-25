import {
  CreateCanvas,
  type CanvasAlreadyExists,
  type CanvasNotFound,
  type ChangeRejected
} from "@crit/authority"
import type {
  CanvasId,
  PresenceRoster
} from "@crit/domain"
import {
  ArtifactRepresentation,
  type LiveRepresentation,
  type RepresentationRef
} from "@crit/domain"
import type {
  PresenceChanged,
  ReplicaChanged
} from "@crit/protocol"
import type {
  ReplicaChange,
  ReplicaChangeReceipt,
  ReplicaView,
  SyncResult
} from "@crit/replica"
import { ReplicaNotOpen } from "@crit/replica"
import {
  ArtifactBytesRenderPlan,
  LocalRepresentationCaptureFailure,
  LocalRepresentationCaptureRequest,
  LocalRepresentationJsonResponse,
  LocalRepresentationResolveFailure,
  LocalRepresentationResolveRequest,
  localRepresentationCapturePath,
  localRepresentationResolvePath,
  type RenderPlan
} from "@crit/representations"
import {
  LocalApiAuthorization,
  AnnouncePresence,
  DepartPresence,
  type LocalDaemonStatus,
  LocalApiOriginRejected,
  type LocalApiToken,
  LocalApiUnauthorized,
  LocalApiVersionUnsupported,
  LocalCanvasApi,
  LocalReplicaSocketHello,
  LocalReplicaSocketServerFrame,
  type PresenceClaimMismatch,
  type PresenceLeaseNotFound,
  type PresenceClaim,
  localApiVersion,
  localApiVersionHeader,
  localReplicaSocketCloseCode
} from "@crit/replica/http"
import { Clock, Context, Deferred, Duration, Effect, Exit, flow, Layer, Match, Queue, Redacted, Ref, Result, Schema, Scope, Stream, type Take } from "effect"
import { FetchHttpClient, HttpClient, HttpClientError, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { HttpApiClient, HttpApiMiddleware } from "effect/unstable/httpapi"
import * as Socket from "effect/unstable/socket/Socket"

export {
  LocalBrowserConnection,
  LocalBrowserConnectionDescriptor,
  LocalBrowserConnectionInvalid
} from "./browser-connection.js"

export type LocalClientOptions =
  | {
    readonly _tag: "bearer"
    readonly baseUrl: string
    readonly token: LocalApiToken
    readonly origin?: string
  }
  | {
    readonly _tag: "browser-session"
    readonly baseUrl: string
    readonly browserPath: `/${string}/`
  }

type TransportFailure =
  | LocalApiUnauthorized
  | LocalApiOriginRejected
  | LocalApiVersionUnsupported
  | HttpClientError.HttpClientError
  | Schema.SchemaError

export type CreateFailure = TransportFailure | CanvasAlreadyExists
export type StatusFailure = TransportFailure
export type OpenFailure = TransportFailure | CanvasNotFound
export type ChangeFailure = TransportFailure | CanvasNotFound | ChangeRejected
export type SyncFailure = TransportFailure | CanvasNotFound
export class LocalSubscriptionProtocolError extends Schema.TaggedError<LocalSubscriptionProtocolError>()(
  "LocalSubscriptionProtocolError",
  { message: Schema.String }
) {}

export type SubscriptionFailure =
  | Socket.SocketError
  | Schema.SchemaError
  | LocalApiUnauthorized
  | ReplicaNotOpen
  | LocalSubscriptionProtocolError

export type PresenceAttendFailure =
  | TransportFailure
  | SubscriptionFailure
  | PresenceClaimMismatch
  | PresenceLeaseNotFound

export type CreateCanvasInput = Omit<CreateCanvas, "_tag">

export interface LocalCanvasClientService {
  readonly status: () => Effect.Effect<LocalDaemonStatus, StatusFailure>
  readonly create: (input: CreateCanvasInput) => Effect.Effect<ReplicaView, CreateFailure>
  readonly open: (canvasId: CanvasId) => Effect.Effect<ReplicaView, OpenFailure>
  readonly change: (input: ReplicaChange) => Effect.Effect<ReplicaChangeReceipt, ChangeFailure>
  readonly sync: (canvasId: CanvasId) => Effect.Effect<SyncResult, SyncFailure>
  readonly subscribe: (canvasId: CanvasId) => Effect.Effect<
    Stream.Stream<ReplicaChanged, SubscriptionFailure>,
    SubscriptionFailure,
    Socket.WebSocketConstructor | Scope.Scope
  >
  readonly attendPresence: (
    canvasId: CanvasId,
    claim: PresenceClaim
  ) => Effect.Effect<
    Stream.Stream<PresenceRoster, SubscriptionFailure>,
    PresenceAttendFailure,
    Socket.WebSocketConstructor | Scope.Scope
  >
}

export type LocalRepresentationClientFailure =
  | LocalApiUnauthorized
  | LocalApiOriginRejected
  | LocalApiVersionUnsupported
  | LocalRepresentationResolveFailure
  | HttpClientError.HttpClientError
  | Schema.SchemaError

export type LocalRepresentationCaptureClientFailure =
  | LocalApiUnauthorized
  | LocalApiOriginRejected
  | LocalApiVersionUnsupported
  | LocalRepresentationCaptureFailure
  | HttpClientError.HttpClientError
  | Schema.SchemaError

export interface LocalRepresentationClientService {
  readonly capture: (
    representation: LiveRepresentation
  ) => Effect.Effect<ArtifactRepresentation, LocalRepresentationCaptureClientFailure>
  readonly resolve: (
    representation: RepresentationRef
  ) => Effect.Effect<RenderPlan, LocalRepresentationClientFailure>
}

const localPath = (options: LocalClientOptions, path: `/${string}`) => options._tag === "bearer"
  ? path
  : `${options.browserPath}${path.slice(1)}`

const localUrl = (options: LocalClientOptions, path: `/${string}`) =>
  `${options.baseUrl.replace(/\/$/, "")}${localPath(options, path)}`

const withBrowserCredentials = <A, E, R>(
  options: LocalClientOptions,
  effect: Effect.Effect<A, E, R>
) => options._tag === "browser-session"
  ? Effect.provideService(effect, FetchHttpClient.RequestInit, { credentials: "include" })
  : effect

const representationRequest = (
  options: LocalClientOptions,
  path: `/${string}`
) => {
  return HttpClientRequest.post(localUrl(options, path)).pipe(
    HttpClientRequest.setHeader(localApiVersionHeader, localApiVersion),
    options._tag === "bearer" ? HttpClientRequest.bearerToken(options.token) : (request) => request,
    options._tag === "bearer" && options.origin !== undefined
      ? HttpClientRequest.setHeader("origin", options.origin)
      : (request) => request
  )
}

const representationResolveRequest = (
  options: LocalClientOptions,
  representation: RepresentationRef
) => HttpClientRequest.bodyJsonUnsafe(
  representationRequest(options, localRepresentationResolvePath),
  LocalRepresentationResolveRequest.make({
    _tag: "resolve-representation",
    schemaVersion: 1,
    representation
  })
)

const representationCaptureRequest = (
  options: LocalClientOptions,
  representation: LiveRepresentation
) => HttpClientRequest.bodyJsonUnsafe(
  representationRequest(options, localRepresentationCapturePath),
  LocalRepresentationCaptureRequest.make({
    _tag: "capture-representation",
    schemaVersion: 1,
    representation
  })
)

const decodeRepresentationFailure = (
  response: HttpClientResponse.HttpClientResponse
): Effect.Effect<RenderPlan, LocalRepresentationClientFailure> => {
  switch (response.status) {
    case 401:
      return HttpClientResponse.schemaBodyJson(LocalApiUnauthorized)(response).pipe(Effect.flatMap(Effect.fail))
    case 403:
      return HttpClientResponse.schemaBodyJson(LocalApiOriginRejected)(response).pipe(Effect.flatMap(Effect.fail))
    case 426:
      return HttpClientResponse.schemaBodyJson(LocalApiVersionUnsupported)(response).pipe(Effect.flatMap(Effect.fail))
    case 500:
      return HttpClientResponse.schemaBodyJson(LocalRepresentationResolveFailure)(response).pipe(
        Effect.flatMap(Effect.fail)
      )
    default:
      return HttpClientResponse.filterStatusOk(response).pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(LocalRepresentationJsonResponse))
      )
  }
}

const decodeCaptureResponse = (
  response: HttpClientResponse.HttpClientResponse
): Effect.Effect<ArtifactRepresentation, LocalRepresentationCaptureClientFailure> => {
  switch (response.status) {
    case 401:
      return HttpClientResponse.schemaBodyJson(LocalApiUnauthorized)(response).pipe(Effect.flatMap(Effect.fail))
    case 403:
      return HttpClientResponse.schemaBodyJson(LocalApiOriginRejected)(response).pipe(Effect.flatMap(Effect.fail))
    case 426:
      return HttpClientResponse.schemaBodyJson(LocalApiVersionUnsupported)(response).pipe(Effect.flatMap(Effect.fail))
    case 500:
      return HttpClientResponse.schemaBodyJson(LocalRepresentationCaptureFailure)(response).pipe(
        Effect.flatMap(Effect.fail)
      )
    default:
      return HttpClientResponse.filterStatusOk(response).pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(ArtifactRepresentation))
      )
  }
}

export class LocalRepresentationClient extends Context.Service<
  LocalRepresentationClient,
  LocalRepresentationClientService
>()("@crit/client/LocalRepresentationClient") {
  static readonly layer = (options: LocalClientOptions) => Layer.effect(
    LocalRepresentationClient,
    Effect.gen(function*() {
      const http = yield* HttpClient.HttpClient
      const execute = (request: HttpClientRequest.HttpClientRequest) => withBrowserCredentials(
        options,
        http.execute(request)
      )
      const capture = (representation: LiveRepresentation) =>
        execute(representationCaptureRequest(options, representation)).pipe(
          Effect.flatMap(decodeCaptureResponse)
        )
      const resolve = (representation: RepresentationRef) =>
        execute(representationResolveRequest(options, representation)).pipe(
          Effect.flatMap((response) => {
            if (response.status === 200 && response.headers["content-type"]?.startsWith("application/octet-stream")) {
              return Schema.decodeUnknownEffect(ArtifactRepresentation)(representation).pipe(
                Effect.zipWith(response.arrayBuffer, (artifact, buffer): RenderPlan => ArtifactBytesRenderPlan.make({
                  representation: artifact,
                  bytes: new Uint8Array(buffer)
                }))
              )
            }
            if (response.status === 200) return HttpClientResponse.schemaBodyJson(LocalRepresentationJsonResponse)(response)
            return decodeRepresentationFailure(response)
          })
        )
      return LocalRepresentationClient.of({ capture, resolve })
    })
  )
}

const notificationUrl = (options: LocalClientOptions, canvasId: CanvasId) => {
  const httpUrl = localUrl(options, `/api/v${localApiVersion}/subscribe/${encodeURIComponent(canvasId)}`)
  return httpUrl.startsWith("https://")
    ? `wss://${httpUrl.slice("https://".length)}`
    : `ws://${httpUrl.slice("http://".length)}`
}

const mapSocketFailure = (canvasId: CanvasId, failure: Socket.SocketError) => {
  if (failure.reason._tag !== "SocketCloseError") return failure
  if (failure.reason.code === localReplicaSocketCloseCode.unauthorized) {
    return new LocalApiUnauthorized({ message: "Missing or invalid bearer token" })
  }
  if (failure.reason.code === localReplicaSocketCloseCode.replicaNotOpen) return new ReplicaNotOpen({ canvasId })
  return failure
}

type LocalNotification = ReplicaChanged | PresenceChanged

const subscribeNotifications = <A>(
  options: LocalClientOptions,
  canvasId: CanvasId,
  select: (notification: LocalNotification) => Result.Result<A, void>
): Effect.Effect<
  Stream.Stream<A, SubscriptionFailure>,
  SubscriptionFailure,
  Socket.WebSocketConstructor | Scope.Scope
> => Effect.gen(function*() {
  const socket = yield* Socket.makeWebSocket(notificationUrl(options, canvasId), {
    closeCodeIsError: (code) => code !== 1000
  })
  const opened = yield* Deferred.make<void, SubscriptionFailure>()
  const messages = yield* Queue.sliding<Take.Take<A, SubscriptionFailure>>(1)
  const ready = yield* Ref.make(false)
  const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(LocalReplicaSocketServerFrame))
  if (options._tag === "bearer") {
    const write = yield* socket.writer
    const hello = JSON.stringify(LocalReplicaSocketHello.make({
      kind: "authenticate",
      schemaVersion: 1,
      bearer: Redacted.value(options.token)
    }))
    yield* write(hello).pipe(Effect.forkScoped)
  }
  const receive = (notification: LocalNotification) => Effect.gen(function*() {
    if (!(yield* Ref.get(ready))) {
      return yield* new LocalSubscriptionProtocolError({
        message: "Notification arrived before subscription readiness"
      })
    }
    const selected = select(notification)
    if (selected._tag === "Success") {
      yield* Queue.offer(messages, [selected.success])
    }
  })
  yield* socket.runString<unknown, SubscriptionFailure>(
    (message) => decode(message).pipe(Effect.flatMap((frame) =>
      Match.value(frame).pipe(Match.discriminatorsExhaustive("kind")({
        "subscription-ready": (subscriptionReady) => Effect.gen(function*() {
          if (subscriptionReady.canvasId !== canvasId) {
            return yield* new LocalSubscriptionProtocolError({
              message: "Subscription ready frame named another Canvas"
            })
          }
          yield* Ref.set(ready, true)
          yield* Deferred.succeed(opened, undefined)
        }),
        "replica-changed": receive,
        "presence-changed": receive
      }))
    ))
  ).pipe(
    Effect.mapError((failure) => Socket.isSocketError(failure) ? mapSocketFailure(canvasId, failure) : failure),
    Effect.matchEffect({
      onFailure: (failure) => Deferred.fail(opened, failure).pipe(
        Effect.andThen(Queue.offer(messages, Exit.fail(failure)))
      ),
      onSuccess: () => Deferred.fail(opened, new LocalSubscriptionProtocolError({
        message: "Socket closed before subscription readiness"
      })).pipe(
        Effect.andThen(Queue.offer(messages, Exit.void))
      )
    }),
    Effect.forkScoped
  )
  yield* Deferred.await(opened)
  return Stream.fromQueue(messages).pipe(Stream.flattenTake)
})

const subscribe = (
  options: LocalClientOptions,
  canvasId: CanvasId
): Effect.Effect<
  Stream.Stream<ReplicaChanged, SubscriptionFailure>,
  SubscriptionFailure,
  Socket.WebSocketConstructor | Scope.Scope
> => subscribeNotifications(options, canvasId, (notification) =>
  Match.value(notification).pipe(Match.discriminatorsExhaustive("kind")({
    "replica-changed": (replicaChanged) => Result.succeed(replicaChanged),
    "presence-changed": () => Result.fail(undefined)
  }))
)

const subscribePresence = (
  options: LocalClientOptions,
  canvasId: CanvasId
): Effect.Effect<
  Stream.Stream<PresenceRoster, SubscriptionFailure>,
  SubscriptionFailure,
  Socket.WebSocketConstructor | Scope.Scope
> => subscribeNotifications(options, canvasId, (notification) =>
  Match.value(notification).pipe(Match.discriminatorsExhaustive("kind")({
    "replica-changed": () => Result.fail(undefined),
    "presence-changed": ({ roster }) => Result.succeed(roster)
  }))
)

export class LocalCanvasClient extends Context.Service<
  LocalCanvasClient,
  LocalCanvasClientService
>()("@crit/client/LocalCanvasClient") {
  static readonly layer = (options: LocalClientOptions) => {
    const origin = options._tag === "bearer" ? options.origin : undefined
    return Layer.effect(LocalCanvasClient, Effect.gen(function*() {
      const http = yield* HttpApiClient.make(LocalCanvasApi, {
        transformClient: HttpClient.mapRequest(flow(
          HttpClientRequest.prependUrl(localUrl(options, "/").replace(/\/$/, "")),
          (request) => HttpClientRequest.setHeader(request, localApiVersionHeader, localApiVersion),
          origin !== undefined
            ? (request) => HttpClientRequest.setHeader(request, "origin", origin)
            : (request) => request
        ))
      })
      const announce = (
        canvasId: CanvasId,
        claim: PresenceClaim,
        leaseId?: Parameters<typeof DepartPresence.make>[0]["leaseId"]
      ) => {
        const payload = leaseId === undefined
          ? AnnouncePresence.make({ canvasId, claim })
          : AnnouncePresence.make({ canvasId, claim, leaseId })
        return withBrowserCredentials(options, http.announce({ payload }))
      }
      const attendPresence: LocalCanvasClientService["attendPresence"] = (
        canvasId,
        claim
      ) => Effect.gen(function*() {
        const first = yield* announce(canvasId, claim)
        yield* Effect.addFinalizer(() => withBrowserCredentials(
          options,
          http.depart({
            payload: DepartPresence.make({
              canvasId,
              leaseId: first.leaseId
            })
          })
        ).pipe(Effect.ignore))
        const receipt = yield* Ref.make(first)
        yield* Effect.forever(Effect.gen(function*() {
          const current = yield* Ref.get(receipt)
          const now = yield* Clock.currentTimeMillis
          const halfRemaining = Math.max(
            1,
            (Date.parse(current.expiresAt) - now) / 2
          )
          yield* Effect.sleep(Duration.millis(halfRemaining))
          const refreshed = yield* announce(
            canvasId,
            claim,
            current.leaseId
          )
          yield* Ref.set(receipt, refreshed)
        })).pipe(Effect.forkScoped)
        return yield* subscribePresence(options, canvasId)
      })
      return LocalCanvasClient.of({
        status: () => withBrowserCredentials(options, http.status()),
        create: (input) => withBrowserCredentials(options, http.create({ payload: CreateCanvas.make(input) })),
        open: (canvasId) => withBrowserCredentials(options, http.open({ params: { canvasId } })),
        change: (input) => withBrowserCredentials(options, http.change({ payload: input })),
        sync: (canvasId) => withBrowserCredentials(options, http.sync({ params: { canvasId } })),
        subscribe: (canvasId) => subscribe(options, canvasId),
        attendPresence
      })
    })).pipe(
      Layer.provide(HttpApiMiddleware.layerClient(
        LocalApiAuthorization,
        ({ next, request }) => next(options._tag === "bearer"
          ? HttpClientRequest.bearerToken(request, options.token)
          : request)
      ))
    )
  }
}
