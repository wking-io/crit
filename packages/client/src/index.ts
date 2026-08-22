import type {
  CanvasAlreadyExists,
  CanvasNotFound,
  ChangeRejected,
  CreateCanvas
} from "@crit/authority"
import type { CanvasId } from "@crit/domain"
import type {
  ReplicaChange,
  ReplicaChangeReceipt,
  ReplicaView,
  SyncResult
} from "@crit/replica"
import {
  LocalApiAuthorization,
  LocalApiOriginRejected,
  type LocalApiToken,
  LocalApiUnauthorized,
  LocalApiVersionUnsupported,
  LocalCanvasApi,
  localApiVersion,
  localApiVersionHeader
} from "@crit/replica/http"
import { Context, Effect, flow, Layer, type Schema } from "effect"
import { HttpClient, HttpClientError, HttpClientRequest } from "effect/unstable/http"
import { HttpApiClient, HttpApiMiddleware } from "effect/unstable/httpapi"

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
export type OpenFailure = TransportFailure | CanvasNotFound
export type ChangeFailure = TransportFailure | CanvasNotFound | ChangeRejected
export type SyncFailure = TransportFailure | CanvasNotFound

export interface LocalCanvasClientService {
  readonly create: (input: CreateCanvas) => Effect.Effect<ReplicaView, CreateFailure>
  readonly open: (canvasId: CanvasId) => Effect.Effect<ReplicaView, OpenFailure>
  readonly change: (input: ReplicaChange) => Effect.Effect<ReplicaChangeReceipt, ChangeFailure>
  readonly sync: (canvasId: CanvasId) => Effect.Effect<SyncResult, SyncFailure>
}

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
        create: (input) => http.create({ payload: input }),
        open: (canvasId) => http.open({ params: { canvasId } }),
        change: (input) => http.change({ payload: input }),
        sync: (canvasId) => http.sync({ params: { canvasId } })
      })
    })).pipe(
      Layer.provide(HttpApiMiddleware.layerClient(
        LocalApiAuthorization,
        ({ next, request }) => next(HttpClientRequest.bearerToken(request, options.token))
      ))
    )
  }
}
