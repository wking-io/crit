import {
  CreateCanvas,
  type CanvasAlreadyExists,
  type CanvasNotFound,
  type ChangeRejected
} from "@crit/authority"
import type { CanvasId } from "@crit/domain"
import {
  ArtifactRepresentation,
  type LiveRepresentation,
  type RepresentationRef
} from "@crit/domain"
import type { ReplicaChanged } from "@crit/protocol"
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
  AgentSessionRejected,
  LocalAgentApi,
  LocalApiAuthorization,
  type AgentSessionDeclaration,
  type AgentSessionGrant,
  type LocalDaemonStatus,
  LocalApiOriginRejected,
  type LocalApiToken,
  LocalApiUnauthorized,
  LocalApiVersionUnsupported,
  LocalCanvasApi,
  LocalReplicaSocketHello,
  LocalReplicaSocketServerFrame,
  localApiVersion,
  localApiVersionHeader,
  localReplicaSocketCloseCode
} from "@crit/replica/http"
import { Context, Data, Deferred, Effect, Exit, flow, Layer, Queue, Redacted, Ref, Schema, Scope, Stream, type Take } from "effect"
import { FetchHttpClient, HttpClient, HttpClientError, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { HttpApiClient, HttpApiMiddleware } from "effect/unstable/httpapi"
import * as Socket from "effect/unstable/socket/Socket"

export {
  LocalBrowserConnection,
  LocalBrowserConnectionDescriptor,
  LocalBrowserConnectionInvalid
} from "./browser-connection.js"

export type LocalClientOptions = Data.TaggedEnum<{
  readonly bearer: {
    readonly baseUrl: string
    readonly token: LocalApiToken
    readonly origin?: string
  }
  readonly browserSession: {
    readonly baseUrl: string
    readonly browserPath: `/${string}/`
  }
}>
export const LocalClientOptions = Data.taggedEnum<LocalClientOptions>()

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
export type AgentBeginFailure = TransportFailure | AgentSessionRejected
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

export type CreateCanvasInput = Omit<CreateCanvas, "_tag">

export interface LocalCanvasClientService {
  readonly status: () => Effect.Effect<LocalDaemonStatus, StatusFailure>
  readonly create: (input: CreateCanvasInput) => Effect.Effect<ReplicaView, CreateFailure>
  readonly open: (canvasId: CanvasId) => Effect.Effect<ReplicaView, OpenFailure>
  readonly change: (input: ReplicaChange) => Effect.Effect<ReplicaChangeReceipt, ChangeFailure>
  readonly sync: (canvasId: CanvasId) => Effect.Effect<SyncResult, SyncFailure>
  readonly agentBegin: (
    declaration: AgentSessionDeclaration
  ) => Effect.Effect<AgentSessionGrant, AgentBeginFailure>
  readonly subscribe: (canvasId: CanvasId) => Effect.Effect<
    Stream.Stream<ReplicaChanged, SubscriptionFailure>,
    SubscriptionFailure,
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
) => options._tag === "browserSession"
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
    _tag: "resolveRepresentation",
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
    _tag: "captureRepresentation",
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

const subscribe = (
  options: LocalClientOptions,
  canvasId: CanvasId
): Effect.Effect<
  Stream.Stream<ReplicaChanged, SubscriptionFailure>,
  SubscriptionFailure,
  Socket.WebSocketConstructor | Scope.Scope
> => Effect.gen(function*() {
  const socket = yield* Socket.makeWebSocket(notificationUrl(options, canvasId), {
    closeCodeIsError: (code) => code !== 1000
  })
  const opened = yield* Deferred.make<void, SubscriptionFailure>()
  const messages = yield* Queue.sliding<Take.Take<ReplicaChanged, SubscriptionFailure>>(1)
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
  yield* socket.runString<unknown, SubscriptionFailure>(
    (message) => decode(message).pipe(Effect.flatMap((frame) => Effect.gen(function*() {
      if (frame.kind === "subscription-ready") {
        if (frame.canvasId !== canvasId) {
          return yield* new LocalSubscriptionProtocolError({ message: "Subscription ready frame named another Canvas" })
        }
        yield* Ref.set(ready, true)
        yield* Deferred.succeed(opened, undefined)
        return
      }
      if (!(yield* Ref.get(ready))) {
        return yield* new LocalSubscriptionProtocolError({ message: "Replica change arrived before subscription readiness" })
      }
      yield* Queue.offer(messages, [frame])
    })))
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

export class LocalCanvasClient extends Context.Service<
  LocalCanvasClient,
  LocalCanvasClientService
>()("@crit/client/LocalCanvasClient") {
  static readonly layer = (options: LocalClientOptions) => {
    const origin = options._tag === "bearer" ? options.origin : undefined
    return Layer.effect(LocalCanvasClient, Effect.gen(function*() {
      const transformClient = HttpClient.mapRequest(flow(
        HttpClientRequest.prependUrl(localUrl(options, "/").replace(/\/$/, "")),
        (request) => HttpClientRequest.setHeader(request, localApiVersionHeader, localApiVersion),
        origin !== undefined
          ? (request) => HttpClientRequest.setHeader(request, "origin", origin)
          : (request) => request
      ))
      const http = yield* HttpApiClient.make(LocalCanvasApi, { transformClient })
      const agent = yield* HttpApiClient.make(LocalAgentApi, { transformClient })
      return LocalCanvasClient.of({
        status: () => withBrowserCredentials(options, http.status()),
        create: (input) => withBrowserCredentials(options, http.create({ payload: CreateCanvas.make(input) })),
        open: (canvasId) => withBrowserCredentials(options, http.open({ params: { canvasId } })),
        change: (input) => withBrowserCredentials(options, http.change({ payload: input })),
        sync: (canvasId) => withBrowserCredentials(options, http.sync({ params: { canvasId } })),
        agentBegin: (declaration) => withBrowserCredentials(options, agent.begin({ payload: declaration })),
        subscribe: (canvasId) => subscribe(options, canvasId)
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
