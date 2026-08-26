import type { ApplicationRouteRepresentation, EmailAddress } from "@crit/domain"
import {
  decodeAccessAuthenticatedPersonWire,
  decodeCanvasDirectoryWire,
  decodeHostedApplicationResolveResponse,
  encodeHostedApplicationResolveRequest,
  hostedApplicationResolvePath,
  type CanvasDirectoryWire,
  type HostedApplicationResolveResponse
} from "@crit/protocol"
import { CanvasListing } from "@crit/replica/http"
import { RenderPlan } from "@crit/representations"
import { Context, Data, Effect, Layer, Schema } from "effect"
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  type HttpClientResponse
} from "effect/unstable/http"

export class HostedAccessDenied extends Data.TaggedError("HostedAccessDenied")<{}> {}

export class HostedReviewUnreachable extends Data.TaggedError("HostedReviewUnreachable")<{
  readonly reason: string
}> {}

export type HostedReviewFailure =
  | HostedAccessDenied
  | HostedReviewUnreachable

export interface HostedReviewClientService {
  readonly identity: () => Effect.Effect<EmailAddress, HostedReviewFailure>
  readonly directory: () => Effect.Effect<
    ReadonlyArray<CanvasListing>,
    HostedReviewFailure
  >
  readonly resolveApplicationRoute: (
    representation: ApplicationRouteRepresentation
  ) => Effect.Effect<RenderPlan, HostedReviewFailure>
}

const rootUrl = (baseUrl: string): string => baseUrl.replace(/\/$/, "")

const unavailable = (operation: string) => new HostedReviewUnreachable({
  reason: `The hosted ${operation} request failed.`
})

const responseJson = <A>(
  response: HttpClientResponse.HttpClientResponse,
  decode: (input: unknown) => A,
  operation: string
): Effect.Effect<A, HostedReviewFailure> => {
  if (response.status === 401) return Effect.fail(new HostedAccessDenied())
  if (response.status !== 200) return Effect.fail(unavailable(operation))
  return response.text.pipe(
    Effect.mapError(() => unavailable(operation)),
    Effect.flatMap((contents) => Effect.try({
      try: () => JSON.parse(contents),
      catch: () => unavailable(operation)
    })),
    Effect.flatMap((input) => Effect.try({
      try: () => decode(input),
      catch: () => unavailable(operation)
    }))
  )
}

export class HostedReviewClient extends Context.Service<
  HostedReviewClient,
  HostedReviewClientService
>()("@crit/client/HostedReviewClient") {
  static readonly layer = (
    options: { readonly baseUrl: string }
  ): Layer.Layer<HostedReviewClient> => Layer.effect(
    HostedReviewClient,
    Effect.gen(function*() {
      const http = yield* HttpClient.HttpClient
      const execute = (
        request: HttpClientRequest.HttpClientRequest,
        operation: string
      ) => http.execute(request).pipe(
        Effect.mapError(() => unavailable(operation))
      )
      const identity = () => execute(
        HttpClientRequest.get(`${rootUrl(options.baseUrl)}/identity`),
        "identity"
      ).pipe(
        Effect.flatMap((response) => responseJson(
          response,
          decodeAccessAuthenticatedPersonWire,
          "identity"
        )),
        Effect.map((wire) => wire.address)
      )
      const directory = () => execute(
        HttpClientRequest.get(`${rootUrl(options.baseUrl)}/canvas`),
        "canvas directory"
      ).pipe(
        Effect.flatMap((response) => responseJson(
          response,
          decodeCanvasDirectoryWire,
          "canvas directory"
        )),
        Effect.map((wire: CanvasDirectoryWire) => wire.canvases.map((entry) =>
          CanvasListing.make({
            canvasId: entry.canvasId,
            title: entry.title
          })
        ))
      )
      const resolveApplicationRoute = (
        representation: ApplicationRouteRepresentation
      ) => execute(
        HttpClientRequest.bodyJsonUnsafe(
          HttpClientRequest.post(
            `${rootUrl(options.baseUrl)}${hostedApplicationResolvePath}`
          ),
          encodeHostedApplicationResolveRequest({
            kind: "resolveApplicationRoute",
            schemaVersion: 1,
            representation
          })
        ),
        "application route"
      ).pipe(
        Effect.flatMap((response) => responseJson(
          response,
          decodeHostedApplicationResolveResponse,
          "application route"
        )),
        Effect.flatMap((wire: HostedApplicationResolveResponse) =>
          Schema.decodeUnknownEffect(RenderPlan)(wire).pipe(
            Effect.mapError(() => unavailable("application route"))
          ))
      )
      return HostedReviewClient.of({
        identity,
        directory,
        resolveApplicationRoute
      })
    })
  ).pipe(Layer.provide(FetchHttpClient.layer))
}
