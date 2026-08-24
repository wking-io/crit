import {
  ApplicationRouteRepresentation,
  ArtifactRepresentation,
  DomainValue,
  HttpUrl,
  WebUrlRepresentation,
  type ApplicationId,
  type RepresentationRef,
} from "@crit/domain"
import { Context, Data, Effect, Layer, Match, Option, Result, Schema } from "effect"

import {
  ArtifactStore,
  ArtifactStoreIoFailure,
  type ArtifactConflict,
  type PutArtifact
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

export const IframeRenderPlan = Schema.TaggedStruct("iframe", {
  representation: Schema.Union([
    ApplicationRouteRepresentation,
    WebUrlRepresentation
  ]),
  url: HttpUrl
})

export const ArtifactBytesRenderPlan = Schema.TaggedStruct("artifact-bytes", {
  representation: ArtifactRepresentation,
  bytes: Schema.Uint8Array
})

export const ApplicationUnavailableRenderPlan = Schema.TaggedStruct("unavailable", {
  reason: Schema.Literal("application-unbound"),
  representation: ApplicationRouteRepresentation
})

export const ArtifactUnavailableRenderPlan = Schema.TaggedStruct("unavailable", {
  reason: Schema.Literals(["artifact-not-found", "artifact-corrupt"]),
  representation: ArtifactRepresentation
})

export const RenderPlan = Schema.Union([
  IframeRenderPlan,
  ArtifactBytesRenderPlan,
  ApplicationUnavailableRenderPlan,
  ArtifactUnavailableRenderPlan
])
export type RenderPlan = typeof RenderPlan.Type

export type RepresentationRuntimeFailure =
  | ApplicationBindingLookupFailure
  | ArtifactStoreIoFailure

export interface RepresentationRuntimeService {
  readonly capture: (
    input: PutArtifact
  ) => Effect.Effect<ArtifactRepresentation, ArtifactConflict | ArtifactStoreIoFailure>
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

const makeRuntime = Effect.gen(function*() {
  const bindings = yield* ApplicationBindings
  const artifacts = yield* ArtifactStore

  const resolveApplication = (input: ApplicationRouteRepresentation) => {
    const representation = DomainValue.detach(input)
    return bindings.get(representation.applicationId).pipe(Effect.map(Option.match({
      onNone: (): RenderPlan => ApplicationUnavailableRenderPlan.make({
        reason: "application-unbound",
        representation
      }),
      onSome: (baseUrl): RenderPlan => IframeRenderPlan.make({
        representation,
        url: applicationUrl(baseUrl, representation)
      })
    })))
  }

  const resolveArtifact = (input: ArtifactRepresentation) => {
    const representation = ArtifactRepresentation.make({
      artifactId: input.artifactId,
      digest: input.digest
    })
    return artifacts.read(representation).pipe(
      Effect.map((bytes): RenderPlan => ArtifactBytesRenderPlan.make({
        representation,
        bytes
      })),
      Effect.catchTags({
        ArtifactNotFound: (): Effect.Effect<RenderPlan> => Effect.succeed(ArtifactUnavailableRenderPlan.make({
          reason: "artifact-not-found",
          representation
        })),
        ArtifactCorrupt: (): Effect.Effect<RenderPlan> => Effect.succeed(ArtifactUnavailableRenderPlan.make({
          reason: "artifact-corrupt",
          representation
        }))
      })
    )
  }

  const resolve = Match.type<RepresentationRef>().pipe(Match.tagsExhaustive({
    "application-route": resolveApplication,
    "web-url": (input): Effect.Effect<RenderPlan> => {
      const representation = WebUrlRepresentation.make({ url: input.url })
      return Effect.succeed(IframeRenderPlan.make({
        representation,
        url: representation.url
      }))
    },
    artifact: resolveArtifact
  }))

  return RepresentationRuntime.of({
    capture: artifacts.put,
    resolve
  })
})

export const RepresentationRuntimeLive: Layer.Layer<
  RepresentationRuntime,
  never,
  ApplicationBindings | ArtifactStore
> = Layer.effect(RepresentationRuntime, makeRuntime)
