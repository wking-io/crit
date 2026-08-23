import {
  CreateCanvas,
  type CanvasAlreadyExists,
  type CanvasNotFound,
  type ChangeRejected
} from "@crit/authority"
import type { CanvasId } from "@crit/domain"
import { ArtifactRepresentation, type RepresentationRef } from "@crit/domain"
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
  LocalRepresentationJsonResponse,
  LocalRepresentationResolveFailure,
  LocalRepresentationResolveRequest,
  localRepresentationResolvePath,
  type RenderPlan
} from "@crit/representations"
import {
  LocalApiAuthorization,
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
import { Context, Deferred, Effect, Exit, flow, Layer, Queue, Redacted, Ref, Schema, Scope, Stream, type Take } from "effect"
import { FetchHttpClient, HttpClient, HttpClientError, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { HttpApiClient, HttpApiMiddleware } from "effect/unstable/httpapi"
import * as Socket from "effect/unstable/socket/Socket"

export interface LocalCanvasClientOptions {
  readonly baseUrl: string
  readonly token: LocalApiToken
  readonly origin?: string
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
}

export type LocalRepresentationClientFailure =
  | LocalApiUnauthorized
  | LocalApiOriginRejected
  | LocalApiVersionUnsupported
  | LocalRepresentationResolveFailure
  | HttpClientError.HttpClientError
  | Schema.SchemaError

export interface LocalRepresentationClientService {
  readonly resolve: (
    representation: RepresentationRef
  ) => Effect.Effect<RenderPlan, LocalRepresentationClientFailure>
}

export type LocalRepresentationClientOptions = {
  readonly baseUrl: string
} & (
  | {
    readonly _tag: "bearer"
    readonly token: LocalApiToken
    readonly origin?: string
  }
  | {
    readonly _tag: "browser-session"
    readonly browserPath: `/${string}/`
    readonly origin: string
  }
)

const representationRequest = (
  options: LocalRepresentationClientOptions,
  representation: RepresentationRef
) => {
  const path = options._tag === "bearer"
    ? localRepresentationResolvePath
    : `${options.browserPath}${localRepresentationResolvePath.slice(1)}`
  const request = HttpClientRequest.post(`${options.baseUrl.replace(/\/$/, "")}${path}`).pipe(
    HttpClientRequest.setHeader(localApiVersionHeader, localApiVersion),
    options._tag === "bearer" ? HttpClientRequest.bearerToken(options.token) : (request) => request,
    options.origin === undefined
      ? (request) => request
      : HttpClientRequest.setHeader("origin", options.origin)
  )
  return HttpClientRequest.bodyJsonUnsafe(request, LocalRepresentationResolveRequest.make({
    _tag: "resolve-representation",
    schemaVersion: 1,
    representation
  }))
}

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

export class LocalRepresentationClient extends Context.Service<
  LocalRepresentationClient,
  LocalRepresentationClientService
>()("@crit/client/LocalRepresentationClient") {
  static readonly layer = (options: LocalRepresentationClientOptions) => Layer.effect(
    LocalRepresentationClient,
    Effect.gen(function*() {
      const http = yield* HttpClient.HttpClient
      const execute = (representation: RepresentationRef) => http.execute(
        representationRequest(options, representation)
      ).pipe(options._tag === "browser-session"
        ? Effect.provideService(FetchHttpClient.RequestInit, { credentials: "include" })
        : (effect) => effect)
      const resolve = (representation: RepresentationRef) => execute(representation).pipe(
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
      return LocalRepresentationClient.of({ resolve })
    })
  )
}

const notificationUrl = (baseUrl: string, canvasId: CanvasId) => {
  const socketBase = baseUrl.startsWith("https://")
    ? `wss://${baseUrl.slice("https://".length)}`
    : `ws://${baseUrl.slice("http://".length)}`
  return `${socketBase.replace(/\/$/, "")}/api/v${localApiVersion}/subscribe/${encodeURIComponent(canvasId)}`
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
  options: LocalCanvasClientOptions,
  canvasId: CanvasId
): Effect.Effect<
  Stream.Stream<ReplicaChanged, SubscriptionFailure>,
  SubscriptionFailure,
  Socket.WebSocketConstructor | Scope.Scope
> => Effect.gen(function*() {
  const socket = yield* Socket.makeWebSocket(notificationUrl(options.baseUrl, canvasId), {
    closeCodeIsError: (code) => code !== 1000
  })
  const write = yield* socket.writer
  const opened = yield* Deferred.make<void, SubscriptionFailure>()
  const messages = yield* Queue.sliding<Take.Take<ReplicaChanged, SubscriptionFailure>>(1)
  const ready = yield* Ref.make(false)
  const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(LocalReplicaSocketServerFrame))
  const hello = JSON.stringify(LocalReplicaSocketHello.make({
    kind: "authenticate",
    schemaVersion: 1,
    bearer: Redacted.value(options.token)
  }))
  yield* write(hello).pipe(Effect.forkScoped)
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
  static readonly layer = (options: LocalCanvasClientOptions) => {
    const origin = options.origin
    return Layer.effect(LocalCanvasClient, Effect.gen(function*() {
      const http = yield* HttpApiClient.make(LocalCanvasApi, {
        transformClient: HttpClient.mapRequest(flow(
          HttpClientRequest.prependUrl(options.baseUrl),
          (request) => HttpClientRequest.setHeader(request, localApiVersionHeader, localApiVersion),
          origin === undefined
            ? (request) => request
            : (request) => HttpClientRequest.setHeader(request, "origin", origin)
        ))
      })
      return LocalCanvasClient.of({
        status: () => http.status(),
        create: (input) => http.create({ payload: CreateCanvas.make(input) }),
        open: (canvasId) => http.open({ params: { canvasId } }),
        change: (input) => http.change({ payload: input }),
        sync: (canvasId) => http.sync({ params: { canvasId } }),
        subscribe: (canvasId) => subscribe(options, canvasId)
      })
    })).pipe(
      Layer.provide(HttpApiMiddleware.layerClient(
        LocalApiAuthorization,
        ({ next, request }) => next(HttpClientRequest.bearerToken(request, options.token))
      ))
    )
  }
}
