import {
  ApplicationRouteRepresentation,
  ArtifactRepresentation,
  DomainValue,
  HttpUrl,
  Id,
  LiveRepresentation,
  Sha256Digest,
  WebUrlRepresentation,
  type ApplicationId,
  type RepresentationRef
} from "@crit/domain"
import { Context, Crypto, Data, Effect, Layer, Match, Option, Result, Schema } from "effect"

import { ArtifactContentKind, artifactContentKind } from "./artifact-content.js"
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

export class CaptureSourceUnavailable extends Data.TaggedError("CaptureSourceUnavailable")<{
  readonly representation: ApplicationRouteRepresentation
}> {}

export class LiveContentUnreachable extends Data.TaggedError("LiveContentUnreachable")<{
  readonly url: HttpUrl
  readonly reason: string
}> {}

export class LiveContent extends Context.Service<LiveContent, {
  readonly get: (
    url: HttpUrl
  ) => Effect.Effect<Uint8Array, LiveContentUnreachable>
}>()("@crit/representations/LiveContent") {}

export const IframeRenderPlan = Schema.TaggedStruct("iframe", {
  representation: LiveRepresentation,
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

const BoundApplicationRouteBinding = Schema.TaggedStruct("bound", {
  url: HttpUrl
})
const UnboundApplicationRouteBinding = Schema.TaggedStruct("unbound", {})

export const ApplicationRouteBinding = Schema.Union([
  BoundApplicationRouteBinding,
  UnboundApplicationRouteBinding
])
export type ApplicationRouteBinding = typeof ApplicationRouteBinding.Type

export const ApplicationRouteInspection = Schema.TaggedStruct("application-route", {
  representation: ApplicationRouteRepresentation,
  binding: ApplicationRouteBinding
})
export type ApplicationRouteInspection = typeof ApplicationRouteInspection.Type

export const WebUrlInspection = Schema.TaggedStruct("web-url", {
  representation: WebUrlRepresentation
})
export type WebUrlInspection = typeof WebUrlInspection.Type

const VerifiedArtifactIntegrity = Schema.TaggedStruct("verified", {
  sizeBytes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  contentKind: ArtifactContentKind
})
const ArtifactNotFoundIntegrity = Schema.TaggedStruct("not-found", {})
const CorruptArtifactIntegrity = Schema.TaggedStruct("corrupt", {
  actualDigest: Sha256Digest
})

export const ArtifactIntegrity = Schema.Union([
  VerifiedArtifactIntegrity,
  ArtifactNotFoundIntegrity,
  CorruptArtifactIntegrity
])
export type ArtifactIntegrity = typeof ArtifactIntegrity.Type

export const ArtifactInspection = Schema.TaggedStruct("artifact", {
  representation: ArtifactRepresentation,
  integrity: ArtifactIntegrity
})
export type ArtifactInspection = typeof ArtifactInspection.Type

export const Inspection = Schema.Union([
  ApplicationRouteInspection,
  WebUrlInspection,
  ArtifactInspection
])
export type Inspection = typeof Inspection.Type

export type RepresentationRuntimeFailure =
  | ApplicationBindingLookupFailure
  | ArtifactStoreIoFailure

export type CaptureFailure =
  | ApplicationBindingLookupFailure
  | ArtifactStoreIoFailure
  | CaptureSourceUnavailable
  | LiveContentUnreachable

export interface RepresentationRuntimeService {
  readonly capture: (
    representation: LiveRepresentation
  ) => Effect.Effect<ArtifactRepresentation, CaptureFailure>
  readonly inspect: (
    representation: RepresentationRef
  ) => Effect.Effect<Inspection, RepresentationRuntimeFailure>
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
  const liveContent = yield* LiveContent
  const crypto = yield* Crypto.Crypto

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

  const inspectApplication = (input: ApplicationRouteRepresentation) => {
    const representation = DomainValue.detach(input)
    return bindings.get(representation.applicationId).pipe(Effect.map(Option.match({
      onNone: (): Inspection => ApplicationRouteInspection.make({
        representation,
        binding: UnboundApplicationRouteBinding.make({})
      }),
      onSome: (baseUrl): Inspection => ApplicationRouteInspection.make({
        representation,
        binding: BoundApplicationRouteBinding.make({
          url: applicationUrl(baseUrl, representation)
        })
      })
    })))
  }

  const inspectArtifact = (input: ArtifactRepresentation) => {
    const representation = ArtifactRepresentation.make({
      artifactId: input.artifactId,
      digest: input.digest
    })
    return artifacts.read(representation).pipe(
      Effect.map((bytes): Inspection => ArtifactInspection.make({
        representation,
        integrity: VerifiedArtifactIntegrity.make({
          sizeBytes: bytes.byteLength,
          contentKind: artifactContentKind(bytes)
        })
      })),
      Effect.catchTags({
        ArtifactNotFound: (): Effect.Effect<Inspection> => Effect.succeed(ArtifactInspection.make({
          representation,
          integrity: ArtifactNotFoundIntegrity.make({})
        })),
        ArtifactCorrupt: (failure): Effect.Effect<Inspection> => Effect.succeed(ArtifactInspection.make({
          representation,
          integrity: CorruptArtifactIntegrity.make({
            actualDigest: failure.actualDigest
          })
        }))
      })
    )
  }

  const inspect = Match.type<RepresentationRef>().pipe(Match.tagsExhaustive({
    "application-route": inspectApplication,
    "web-url": (input): Effect.Effect<Inspection> => {
      const representation = WebUrlRepresentation.make({ url: input.url })
      return Effect.succeed(WebUrlInspection.make({ representation }))
    },
    artifact: inspectArtifact
  }))

  const captureUrl = Match.type<LiveRepresentation>().pipe(Match.tagsExhaustive({
    "application-route": (representation) =>
      bindings.get(representation.applicationId).pipe(
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(new CaptureSourceUnavailable({
            representation: DomainValue.detach(representation)
          })),
          onSome: (baseUrl) => Effect.succeed(applicationUrl(baseUrl, representation))
        }))
      ),
    "web-url": (representation) => Effect.succeed(representation.url)
  }))

  const capture = (representation: LiveRepresentation) => Effect.gen(function*() {
    const url = yield* captureUrl(representation)
    const bytes = yield* liveContent.get(url)
    const artifactId = yield* crypto.randomUUIDv4.pipe(
      Effect.map((uuid) => Id.artifact(`artifact_${uuid.replaceAll("-", "")}`)),
      Effect.orDie
    )
    return yield* artifacts.put({ artifactId, bytes }).pipe(
      Effect.catchTag("ArtifactConflict", Effect.die)
    )
  })

  return RepresentationRuntime.of({
    capture,
    inspect,
    resolve
  })
})

export const RepresentationRuntimeLive: Layer.Layer<
  RepresentationRuntime,
  never,
  ApplicationBindings | ArtifactStore | Crypto.Crypto | LiveContent
> = Layer.effect(RepresentationRuntime, makeRuntime)
