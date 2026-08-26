import {
  ApplicationRouteRepresentation,
  ArtifactRepresentation,
  HttpUrl,
  Id,
  RootedRoute,
  Sha256Digest,
  WebUrlRepresentation,
  type ApplicationId
} from "@crit/domain"
import { Crypto, Data, Effect, Layer, Option, Schema } from "effect"

import {
  ApplicationBaseUrl,
  ApplicationBindings,
  LiveContent,
  RepresentationRuntime,
  RepresentationRuntimeLive
} from "./runtime.js"
import { ArtifactStore } from "./store.js"

export class ArtifactStoreConformanceFailure extends Data.TaggedError("ArtifactStoreConformanceFailure")<{
  readonly message: string
}> {}

const requireFact = (condition: boolean, message: string) => condition
  ? Effect.void
  : Effect.fail(new ArtifactStoreConformanceFailure({ message }))

const bytes = (...values: ReadonlyArray<number>) => Uint8Array.from(values)

export interface ArtifactStoreConformanceScenario {
  readonly name: string
  readonly run: Effect.Effect<void, unknown, ArtifactStore>
}

export const artifactStoreConformanceScenarios = (): readonly ArtifactStoreConformanceScenario[] => [{
  name: "stores owned bytes and returns detached reads",
  run: Effect.gen(function*() {
    const store = yield* ArtifactStore
    const artifactId = Id.artifact("artifact_conformance_owned")
    const input = bytes(1, 2, 3)
    const stored = yield* store.put({ artifactId, bytes: input })
    input[0] = 9
    const first = yield* store.read(stored)
    yield* requireFact(first[0] === 1, "put retained caller-owned bytes")
    first[0] = 8
    const second = yield* store.read(stored)
    yield* requireFact(second[0] === 1, "read exposed store-owned bytes")
  })
}, {
  name: "converges identical puts and rejects conflicting bytes",
  run: Effect.gen(function*() {
    const store = yield* ArtifactStore
    const artifactId = Id.artifact("artifact_conformance_immutable")
    const first = yield* store.put({ artifactId, bytes: bytes(4, 5, 6) })
    const repeated = yield* store.put({ artifactId, bytes: bytes(4, 5, 6) })
    yield* requireFact(first.digest === repeated.digest, "identical put changed its representation")
    const conflict = yield* store.put({ artifactId, bytes: bytes(6, 5, 4) }).pipe(Effect.result)
    yield* requireFact(conflict._tag === "Failure" && conflict.failure._tag === "ArtifactConflict", "conflicting put replaced immutable content")
    const retained = yield* store.read(first)
    yield* requireFact(retained[0] === 4, "conflicting put changed stored bytes")
  })
}, {
  name: "requires the authoritative digest for reads",
  run: Effect.gen(function*() {
    const store = yield* ArtifactStore
    const artifactId = Id.artifact("artifact_conformance_digest")
    yield* store.put({ artifactId, bytes: bytes(7, 8, 9) })
    const wrong = ArtifactRepresentation.make({
      artifactId,
      digest: Schema.decodeUnknownSync(Sha256Digest)(`sha256:${"0".repeat(64)}`)
    })
    const corruptRead = yield* store.read(wrong).pipe(Effect.result)
    yield* requireFact(corruptRead._tag === "Failure" && corruptRead.failure._tag === "ArtifactCorrupt", "read accepted a mismatched digest")
  })
}]

export const runArtifactStoreConformance = <E, R>(
  layer: Layer.Layer<ArtifactStore, E, R>
): Effect.Effect<void, unknown | E, R> => Effect.forEach(
  artifactStoreConformanceScenarios(),
  (scenario) => scenario.run.pipe(Effect.provide(layer)),
  { discard: true }
)

const unboundApplicationId = Id.application("application_conformance_unbound")
const inertLiveContent = Layer.succeed(LiveContent, LiveContent.of({
  get: () => Effect.die("Representation resolve and inspect must not read live content")
}))
const inertCrypto = Layer.succeed(Crypto.Crypto, Crypto.make({
  randomBytes: (size) => new Uint8Array(size),
  digest: (_algorithm, data) => Effect.succeed(data)
}))

export interface RepresentationRuntimeConformanceExpectation {
  readonly applicationId: ApplicationId
  readonly baseUrl: ApplicationBaseUrl
  readonly renderedUrl: HttpUrl
}

export class RepresentationRuntimeConformanceFailure extends Data.TaggedError("RepresentationRuntimeConformanceFailure")<{
  readonly message: string
}> {}

const requireRuntimeFact = (condition: boolean, message: string) => condition
  ? Effect.void
  : Effect.fail(new RepresentationRuntimeConformanceFailure({ message }))

export interface RepresentationRuntimeConformanceScenario {
  readonly name: string
  readonly run: Effect.Effect<
    void,
    unknown,
    ApplicationBindings | ArtifactStore | RepresentationRuntime
  >
}

export const representationRuntimeConformanceScenarios = (
  expected: RepresentationRuntimeConformanceExpectation
): readonly RepresentationRuntimeConformanceScenario[] => [{
  name: "composes bound application routes without changing their state or query",
  run: Effect.gen(function*() {
    const bindings = yield* ApplicationBindings
    const runtime = yield* RepresentationRuntime
    const bound = yield* bindings.get(expected.applicationId)
    yield* requireRuntimeFact(
      Option.isSome(bound) && bound.value === expected.baseUrl,
      "the binding adapter did not return the expected base URL"
    )
    const state = { selection: { artifact: "artifact_1" } }
    const representation = ApplicationRouteRepresentation.make({
      applicationId: expected.applicationId,
      route: Schema.decodeUnknownSync(RootedRoute)("/products/%E2%9C%93?view=grid"),
      state
    })
    const encoded = JSON.stringify(representation)
    const plan = yield* runtime.resolve(representation)
    yield* requireRuntimeFact(plan._tag === "iframe", "a bound application route did not produce an iframe")
    if (plan._tag !== "iframe") return
    yield* requireRuntimeFact(
      plan.url === expected.renderedUrl,
      "application route composition changed the rooted route"
    )
    yield* requireRuntimeFact(
      plan.representation !== representation && JSON.stringify(plan.representation) === encoded,
      "application iframe did not detach an equal representation"
    )
    state.selection.artifact = "artifact_changed"
    yield* requireRuntimeFact(
      JSON.stringify(plan.representation) === encoded,
      "application iframe retained caller-owned state"
    )
  })
}, {
  name: "inspects bound application routes without changing their state or query",
  run: Effect.gen(function*() {
    const runtime = yield* RepresentationRuntime
    const state = { selection: { artifact: "artifact_1" } }
    const representation = ApplicationRouteRepresentation.make({
      applicationId: expected.applicationId,
      route: Schema.decodeUnknownSync(RootedRoute)("/products/%E2%9C%93?view=grid"),
      state
    })
    const encoded = JSON.stringify(representation)
    const inspection = yield* runtime.inspect(representation)
    yield* requireRuntimeFact(
      inspection._tag === "application-route" && inspection.binding._tag === "bound",
      "a bound application route did not report its binding"
    )
    if (inspection._tag !== "application-route" || inspection.binding._tag !== "bound") return
    yield* requireRuntimeFact(
      inspection.binding.url === expected.renderedUrl,
      "application route inspection changed the rooted route"
    )
    yield* requireRuntimeFact(
      inspection.representation !== representation &&
        JSON.stringify(inspection.representation) === encoded,
      "application route inspection did not detach an equal representation"
    )
    state.selection.artifact = "artifact_changed"
    yield* requireRuntimeFact(
      JSON.stringify(inspection.representation) === encoded,
      "application route inspection retained caller-owned state"
    )
  })
}, {
  name: "preserves web URL representations exactly",
  run: Effect.gen(function*() {
    const runtime = yield* RepresentationRuntime
    const representation = WebUrlRepresentation.make({
      url: Schema.decodeUnknownSync(HttpUrl)("https://web.example/review?mode=wide")
    })
    const plan = yield* runtime.resolve(representation)
    yield* requireRuntimeFact(plan._tag === "iframe", "a web URL did not produce an iframe")
    if (plan._tag !== "iframe") return
    yield* requireRuntimeFact(plan.url === representation.url, "web iframe changed its URL")
    yield* requireRuntimeFact(
      plan.representation !== representation &&
        JSON.stringify(plan.representation) === JSON.stringify(representation),
      "web iframe did not detach an equal representation"
    )
  })
}, {
  name: "returns detached verified artifact bytes",
  run: Effect.gen(function*() {
    const store = yield* ArtifactStore
    const runtime = yield* RepresentationRuntime
    const artifact = yield* store.put({
      artifactId: Id.artifact("artifact_runtime_conformance"),
      bytes: bytes(2, 7, 1)
    })
    const plan = yield* runtime.resolve(artifact)
    yield* requireRuntimeFact(plan._tag === "artifact-bytes", "a stored artifact did not produce bytes")
    if (plan._tag !== "artifact-bytes") return
    yield* requireRuntimeFact(
      plan.representation !== artifact &&
        JSON.stringify(plan.representation) === JSON.stringify(artifact),
      "artifact plan did not detach an equal representation"
    )
    plan.bytes[0] = 9
    const retained = yield* store.read(artifact)
    yield* requireRuntimeFact(retained[0] === 2, "artifact plan exposed store-owned bytes")
  })
}, {
  name: "makes an unbound application unavailable",
  run: Effect.gen(function*() {
    const runtime = yield* RepresentationRuntime
    const representation = ApplicationRouteRepresentation.make({
      applicationId: unboundApplicationId,
      route: Schema.decodeUnknownSync(RootedRoute)("/")
    })
    const plan = yield* runtime.resolve(representation)
    yield* requireRuntimeFact(
      plan._tag === "unavailable" &&
        plan.reason === "application-unbound" &&
        plan.representation !== representation &&
        JSON.stringify(plan.representation) === JSON.stringify(representation),
      "an unbound application did not retain its legal unavailable representation"
    )
  })
}, {
  name: "distinguishes missing and corrupt artifacts",
  run: Effect.gen(function*() {
    const store = yield* ArtifactStore
    const runtime = yield* RepresentationRuntime
    const missing = ArtifactRepresentation.make({
      artifactId: Id.artifact("artifact_runtime_missing"),
      digest: Schema.decodeUnknownSync(Sha256Digest)(`sha256:${"0".repeat(64)}`)
    })
    const missingPlan = yield* runtime.resolve(missing)
    yield* requireRuntimeFact(
      missingPlan._tag === "unavailable" &&
        missingPlan.reason === "artifact-not-found" &&
        missingPlan.representation !== missing &&
        JSON.stringify(missingPlan.representation) === JSON.stringify(missing),
      "a missing artifact did not retain its legal unavailable representation"
    )

    const stored = yield* store.put({
      artifactId: Id.artifact("artifact_runtime_corrupt"),
      bytes: bytes(3, 1, 4)
    })
    const corrupt = ArtifactRepresentation.make({
      artifactId: stored.artifactId,
      digest: Schema.decodeUnknownSync(Sha256Digest)(`sha256:${"f".repeat(64)}`)
    })
    const corruptPlan = yield* runtime.resolve(corrupt)
    yield* requireRuntimeFact(
      corruptPlan._tag === "unavailable" &&
        corruptPlan.reason === "artifact-corrupt" &&
        corruptPlan.representation !== corrupt &&
        JSON.stringify(corruptPlan.representation) === JSON.stringify(corrupt),
      "a corrupt artifact did not retain its legal unavailable representation"
    )
  })
}]

export const runRepresentationRuntimeConformance = <ArtifactE, ArtifactR, BindingE, BindingR>(
  options: {
    readonly artifactStoreLayer: Layer.Layer<ArtifactStore, ArtifactE, ArtifactR>
    readonly applicationBindingsLayer: Layer.Layer<ApplicationBindings, BindingE, BindingR>
    readonly expected: RepresentationRuntimeConformanceExpectation
  }
): Effect.Effect<void, unknown | ArtifactE | BindingE, ArtifactR | BindingR> => {
  const dependencies = Layer.mergeAll(
    options.artifactStoreLayer,
    options.applicationBindingsLayer,
    inertLiveContent,
    inertCrypto
  )
  const runtime = RepresentationRuntimeLive.pipe(Layer.provide(dependencies))
  const environment = Layer.merge(dependencies, runtime)
  return Effect.forEach(
    representationRuntimeConformanceScenarios(options.expected),
    (scenario) => scenario.run.pipe(Effect.provide(environment)),
    { discard: true }
  )
}
