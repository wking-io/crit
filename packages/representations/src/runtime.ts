import {
  ApplicationRouteRepresentation,
  ArtifactRepresentation,
  HttpUrl,
  WebUrlRepresentation,
  type ApplicationId,
  type RepresentationRef,
} from "@crit/domain"
import { Context, Data, Effect, Layer, Match, Option, Result, Schema } from "effect"

import {
  ArtifactStore,
  ArtifactStoreIoFailure
} from "./store.js"

const applicationBaseUrlFailure = (value: string) => {
  const parsed = Schema.decodeUnknownResult(Schema.URLFromString)(value)
  if (Result.isFailure(parsed)) {
    return "Expected an HTTP or HTTPS application base URL"
  }
  const url = parsed.success
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "Expected an HTTP or HTTPS application base URL"
  }
  if (url.username.length > 0 || url.password.length > 0) {
    return "An application base URL cannot contain credentials"
  }
  if (url.port === "0") {
    return "An application base URL port must be greater than zero"
  }
  if (url.pathname !== "/") {
    return "An application base URL must identify the authority root"
  }
  if (url.search.length > 0) {
    return "An application base URL cannot contain a query"
  }
  if (url.hash.length > 0) {
    return "An application base URL cannot contain a fragment"
  }
  return url.href === value
    ? undefined
    : "An application base URL must use its canonical form"
}

export const ApplicationBaseUrl = Schema.String.check(
  Schema.makeFilter<string>(applicationBaseUrlFailure)
).pipe(Schema.brand("ApplicationBaseUrl"))
export type ApplicationBaseUrl = typeof ApplicationBaseUrl.Type

export class ApplicationBindingLookupFailure extends Data.TaggedError("ApplicationBindingLookupFailure")<{
  readonly applicationId: ApplicationId
  readonly reason: string
}> {}

export class ApplicationBindings extends Context.Service<ApplicationBindings, {
  readonly get: (
    applicationId: ApplicationId
  ) => Effect.Effect<Option.Option<ApplicationBaseUrl>, ApplicationBindingLookupFailure>
}>()("@crit/representations/ApplicationBindings") {}

export type RenderPlan =
  | {
    readonly _tag: "iframe"
    readonly representation: ApplicationRouteRepresentation | WebUrlRepresentation
    readonly url: HttpUrl
  }
  | {
    readonly _tag: "artifact-bytes"
    readonly representation: ArtifactRepresentation
    readonly bytes: Uint8Array
  }
  | {
    readonly _tag: "unavailable"
    readonly reason: "application-unbound"
    readonly representation: ApplicationRouteRepresentation
  }
  | {
    readonly _tag: "unavailable"
    readonly reason: "artifact-not-found" | "artifact-corrupt"
    readonly representation: ArtifactRepresentation
  }

export type RepresentationRuntimeFailure =
  | ApplicationBindingLookupFailure
  | ArtifactStoreIoFailure

export interface RepresentationRuntimeService {
  readonly resolve: (
    representation: RepresentationRef
  ) => Effect.Effect<RenderPlan, RepresentationRuntimeFailure>
}

export class RepresentationRuntime extends Context.Service<
  RepresentationRuntime,
  RepresentationRuntimeService
>()("@crit/representations/RepresentationRuntime") {}

const applicationUrl = (
  baseUrl: ApplicationBaseUrl,
  representation: ApplicationRouteRepresentation
): HttpUrl => Schema.decodeUnknownSync(HttpUrl)(
  `${baseUrl}${representation.route.slice(1)}`
)

const ApplicationRouteJson = Schema.fromJsonString(ApplicationRouteRepresentation)
const WebUrlJson = Schema.fromJsonString(WebUrlRepresentation)
const ArtifactJson = Schema.fromJsonString(ArtifactRepresentation)

const detachApplicationRoute = (representation: ApplicationRouteRepresentation) =>
  Schema.decodeUnknownSync(ApplicationRouteJson)(
    Schema.encodeSync(ApplicationRouteJson)(representation)
  )
const detachWebUrl = (representation: WebUrlRepresentation) =>
  Schema.decodeUnknownSync(WebUrlJson)(Schema.encodeSync(WebUrlJson)(representation))
const detachArtifact = (representation: ArtifactRepresentation) =>
  Schema.decodeUnknownSync(ArtifactJson)(Schema.encodeSync(ArtifactJson)(representation))

const makeRuntime = Effect.gen(function*() {
  const bindings = yield* ApplicationBindings
  const artifacts = yield* ArtifactStore

  const resolveApplication = (input: ApplicationRouteRepresentation) => {
    const representation = detachApplicationRoute(input)
    return bindings.get(representation.applicationId).pipe(Effect.map(Option.match({
      onNone: (): RenderPlan => ({
        _tag: "unavailable",
        reason: "application-unbound",
        representation
      }),
      onSome: (baseUrl): RenderPlan => ({
        _tag: "iframe",
        representation,
        url: applicationUrl(baseUrl, representation)
      })
    })))
  }

  const resolveArtifact = (input: ArtifactRepresentation) => {
    const representation = detachArtifact(input)
    return artifacts.read(representation).pipe(
      Effect.map((bytes): RenderPlan => ({
        _tag: "artifact-bytes",
        representation,
        bytes: Uint8Array.from(bytes)
      })),
      Effect.catchTags({
        ArtifactNotFound: (): Effect.Effect<RenderPlan> => Effect.succeed({
          _tag: "unavailable",
          reason: "artifact-not-found",
          representation
        }),
        ArtifactCorrupt: (): Effect.Effect<RenderPlan> => Effect.succeed({
          _tag: "unavailable",
          reason: "artifact-corrupt",
          representation
        })
      })
    )
  }

  const resolve = Match.type<RepresentationRef>().pipe(Match.tagsExhaustive({
    "application-route": resolveApplication,
    "web-url": (input): Effect.Effect<RenderPlan> => {
      const representation = detachWebUrl(input)
      return Effect.succeed({
        _tag: "iframe",
        representation,
        url: representation.url
      })
    },
    artifact: resolveArtifact
  }))

  return RepresentationRuntime.of({ resolve })
})

export const RepresentationRuntimeLive: Layer.Layer<
  RepresentationRuntime,
  never,
  ApplicationBindings | ArtifactStore
> = Layer.effect(RepresentationRuntime, makeRuntime)
