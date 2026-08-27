import type { ApplicationRouteRepresentation } from "@crit/domain"
import {
  decodeInstallationPersonWire,
  decodeCanvasDirectoryWire,
  decodeHostedApplicationResolveResponse,
  encodeHostedApplicationResolveRequest,
  hostedApplicationResolvePath,
  negotiateWire,
  type InstallationPersonWire,
  type ProtocolFailure
} from "@crit/protocol"
import { CanvasListing } from "@crit/replica/http"
import { RenderPlan } from "@crit/representations"
import { Context, Data, Effect, Layer, Option, Result, Schema } from "effect"
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  type HttpClientResponse
} from "effect/unstable/http"

import { failProtocolResponse } from "./protocol-error.js"

export class HostedAccessDenied extends Data.TaggedError("HostedAccessDenied")<{}> {}

export class HostedReviewUnreachable extends Data.TaggedError("HostedReviewUnreachable")<{
  readonly reason: string
}> {}

export type HostedReviewFailure =
  | HostedAccessDenied
  | HostedReviewUnreachable
  | ProtocolFailure

export interface HostedReviewClientService {
  readonly identity: () => Effect.Effect<InstallationPersonWire, HostedReviewFailure>
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

const negotiationFailure = (
  body: Schema.Json,
  expected: { readonly kind: string; readonly schemaVersion: number }
): Option.Option<ProtocolFailure> => {
  const negotiated = negotiateWire(body, expected)
  if (
    Result.isFailure(negotiated)
    && (
      negotiated.failure._tag === "unsupportedVersion"
      || negotiated.failure._tag === "messageKindMismatch"
    )
  ) {
    return Option.some(negotiated.failure)
  }
  return Option.none()
}

const responseJson = (
  response: HttpClientResponse.HttpClientResponse,
  operation: string
): Effect.Effect<Schema.Json, HostedReviewFailure> => {
  if (response.status === 401) return Effect.fail(new HostedAccessDenied())
  return response.text.pipe(
    Effect.mapError(() => unavailable(operation)),
    Effect.flatMap((contents) =>
      Effect.try({
        try: () => Schema.decodeUnknownSync(Schema.Json)(JSON.parse(contents)),
        catch: () => unavailable(operation)
      }).pipe(Effect.mapError((error): HostedReviewFailure => error))),
    Effect.flatMap((body): Effect.Effect<Schema.Json, HostedReviewFailure> => {
      const protocol = failProtocolResponse(response, body)
      if (protocol !== undefined) return protocol
      if (response.status !== 200) return Effect.fail(unavailable(operation))
      return Effect.succeed(body)
    })
  )
}

const negotiateInstallationPerson = (
  body: Schema.Json
): Option.Option<ProtocolFailure> => {
  const header = Schema.decodeUnknownOption(
    Schema.Struct({ kind: Schema.String, schemaVersion: Schema.Number })
  )(body)
  if (Option.isNone(header)) {
    return Option.none()
  }
  if (header.value.kind === "access-authenticated-person") {
    return negotiationFailure(body, {
      kind: "access-authenticated-person",
      schemaVersion: 1
    })
  }
  if (header.value.kind === "anonymous-person") {
    return negotiationFailure(body, {
      kind: "anonymous-person",
      schemaVersion: 1
    })
  }
  return negotiationFailure(body, {
    kind: header.value.kind,
    schemaVersion: 1
  })
}

const decodeHostedWire = <A>(
  body: Schema.Json,
  expected: { readonly kind: string; readonly schemaVersion: number },
  decode: (input: Schema.Json) => A,
  operation: string
): Effect.Effect<A, HostedReviewFailure> => {
  const failed = negotiationFailure(body, expected)
  if (Option.isSome(failed)) return Effect.fail(failed.value)
  return Effect.try({
    try: () => decode(body),
    catch: () => unavailable(operation)
  }).pipe(Effect.mapError((error): HostedReviewFailure => error))
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
          "identity"
        )),
        Effect.flatMap((body): Effect.Effect<InstallationPersonWire, HostedReviewFailure> => {
          const failed = negotiateInstallationPerson(body)
          if (Option.isSome(failed)) return Effect.fail(failed.value)
          return Effect.try({
            try: () => decodeInstallationPersonWire(body),
            catch: () => unavailable("identity")
          }).pipe(Effect.mapError((error): HostedReviewFailure => error))
        })
      )
      const directory = () => execute(
        HttpClientRequest.get(`${rootUrl(options.baseUrl)}/canvas`),
        "canvas directory"
      ).pipe(
        Effect.flatMap((response) => responseJson(
          response,
          "canvas directory"
        )),
        Effect.flatMap((body) => decodeHostedWire(
          body,
          { kind: "canvas-directory", schemaVersion: 1 },
          decodeCanvasDirectoryWire,
          "canvas directory"
        )),
        Effect.map((wire) => wire.canvases.map((entry) =>
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
          "application route"
        )),
        Effect.flatMap((body) => Effect.try({
          try: () => decodeHostedApplicationResolveResponse(body),
          catch: () => unavailable("application route")
        })),
        Effect.flatMap((wire) =>
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
