import {
  ApplicationRouteRepresentation,
  ArtifactRepresentation,
  HttpUrl,
  Id,
  RootedRoute,
  Sha256Digest,
  WebUrlRepresentation
} from "@crit/domain"
import { Effect, Layer, Option, Result, Schema } from "effect"
import { describe, expect, it } from "vitest"

import {
  ApplicationBaseUrl,
  ApplicationBindingLookupFailure,
  ApplicationBindings,
  ArtifactCorrupt,
  ArtifactNotFound,
  ArtifactStore,
  ArtifactStoreIoFailure,
  RepresentationRuntime,
  RepresentationRuntimeLive
} from "../src/index.js"
import { runRepresentationRuntimeConformance } from "../src/testing.js"

const digest = Schema.decodeUnknownSync(Sha256Digest)(`sha256:${"1".repeat(64)}`)
const decodeBaseUrl = Schema.decodeUnknownSync(ApplicationBaseUrl)

const bindingsLayer = (
  applicationId: ReturnType<typeof Id.application>,
  baseUrl: ReturnType<typeof decodeBaseUrl>
) => Layer.succeed(ApplicationBindings, ApplicationBindings.of({
  get: (requestedId) => Effect.succeed(
    requestedId === applicationId ? Option.some(baseUrl) : Option.none()
  )
}))

const memoryArtifactStore = () => {
  const stored = new Map<string, { readonly artifact: ArtifactRepresentation; readonly bytes: Uint8Array }>()
  return Layer.succeed(ArtifactStore, ArtifactStore.of({
    put: ({ artifactId, bytes }) => {
      const artifact = ArtifactRepresentation.make({ artifactId, digest })
      stored.set(artifactId, { artifact, bytes: Uint8Array.from(bytes) })
      return Effect.succeed(artifact)
    },
    read: (artifact) => {
      const entry = stored.get(artifact.artifactId)
      if (entry === undefined) return Effect.fail(new ArtifactNotFound({ artifact }))
      if (entry.artifact.digest !== artifact.digest) {
        return Effect.fail(new ArtifactCorrupt({
          artifact,
          actualDigest: entry.artifact.digest
        }))
      }
      return Effect.succeed(Uint8Array.from(entry.bytes))
    }
  }))
}

describe("ApplicationBaseUrl", () => {
  const decode = Schema.decodeUnknownResult(ApplicationBaseUrl)

  it.each([
    "http://localhost:5173/",
    "https://review.example/",
    "https://127.0.0.1:8443/"
  ])("accepts the canonical authority root %s", (value) => {
    expect(Result.isSuccess(decode(value))).toBe(true)
  })

  it.each([
    "ftp://review.example/",
    "https://user@review.example/",
    "https://review.example/app/",
    "https://review.example/?mode=wide",
    "https://review.example/#canvas",
    "https://review.example:0/",
    "https://REVIEW.example/",
    "https://review.example:443/",
    "https://review.example"
  ])("rejects the non-canonical or non-root base %s", (value) => {
    expect(Result.isFailure(decode(value))).toBe(true)
  })
})

describe("RepresentationRuntime", () => {
  it("passes the adapter-neutral conformance suite", async() => {
    const applicationId = Id.application("application_conformance_bound")
    const baseUrl = decodeBaseUrl("https://conformance.example/")
    await Effect.runPromise(runRepresentationRuntimeConformance({
      artifactStoreLayer: memoryArtifactStore(),
      applicationBindingsLayer: bindingsLayer(applicationId, baseUrl),
      expected: {
        applicationId,
        baseUrl,
        renderedUrl: Schema.decodeUnknownSync(HttpUrl)(
          "https://conformance.example/products/%E2%9C%93?view=grid"
        )
      }
    }))
  })

  it("resolves one application route through independent local and preview bindings", async() => {
    const applicationId = Id.application("application_runtime_rebinding")
    const state = { selection: { frame: "frame_1" } }
    const representation = ApplicationRouteRepresentation.make({
      applicationId,
      route: Schema.decodeUnknownSync(RootedRoute)("/review?mode=wide"),
      state
    })
    const encoded = JSON.stringify(representation)
    const artifacts = memoryArtifactStore()
    const resolveWith = (baseUrl: ReturnType<typeof decodeBaseUrl>) => Effect.gen(function*() {
      const runtime = yield* RepresentationRuntime
      return yield* runtime.resolve(representation)
    }).pipe(Effect.provide(RepresentationRuntimeLive.pipe(
      Layer.provide(Layer.merge(artifacts, bindingsLayer(applicationId, baseUrl)))
    )))

    const local = await Effect.runPromise(resolveWith(decodeBaseUrl("http://localhost:5173/")))
    const preview = await Effect.runPromise(resolveWith(decodeBaseUrl("https://preview.example/")))
    expect(local._tag).toBe("iframe")
    expect(preview._tag).toBe("iframe")
    if (local._tag !== "iframe" || preview._tag !== "iframe") return
    expect(local.url).toBe("http://localhost:5173/review?mode=wide")
    expect(preview.url).toBe("https://preview.example/review?mode=wide")
    expect(local.url).not.toBe(preview.url)
    expect(local.representation).toEqual(representation)
    expect(preview.representation).toEqual(representation)
    expect(local.representation).not.toBe(representation)
    expect(preview.representation).not.toBe(representation)
    expect(JSON.stringify(representation)).toBe(encoded)
    state.selection.frame = "frame_2"
    expect(JSON.stringify(local.representation)).toBe(encoded)
    expect(JSON.stringify(preview.representation)).toBe(encoded)
  })

  it("resolves a web URL without consulting bindings or artifacts", async() => {
    let bindingReads = 0
    let artifactReads = 0
    const applicationId = Id.application("application_runtime_bypass")
    const artifactId = Id.artifact("artifact_runtime_bypass")
    const bindings = Layer.succeed(ApplicationBindings, ApplicationBindings.of({
      get: () => Effect.suspend(() => {
        bindingReads += 1
        return Effect.fail(new ApplicationBindingLookupFailure({
          applicationId,
          reason: "must not run"
        }))
      })
    }))
    const artifacts = Layer.succeed(ArtifactStore, ArtifactStore.of({
      put: () => Effect.fail(new ArtifactStoreIoFailure({
        artifactId,
        operation: "put",
        reason: "must not run"
      })),
      read: () => Effect.suspend(() => {
        artifactReads += 1
        return Effect.fail(new ArtifactStoreIoFailure({
          artifactId,
          operation: "read",
          reason: "must not run"
        }))
      })
    }))
    const representation = WebUrlRepresentation.make({
      url: Schema.decodeUnknownSync(HttpUrl)("https://web.example/review?mode=wide")
    })
    const plan = await Effect.runPromise(Effect.gen(function*() {
      const runtime = yield* RepresentationRuntime
      return yield* runtime.resolve(representation)
    }).pipe(Effect.provide(RepresentationRuntimeLive.pipe(
      Layer.provide(Layer.merge(bindings, artifacts))
    ))))
    expect(plan).toEqual({
      _tag: "iframe",
      representation,
      url: representation.url
    })
    expect(plan.representation).not.toBe(representation)
    expect(bindingReads).toBe(0)
    expect(artifactReads).toBe(0)
  })

  it("copies bytes even when an artifact adapter returns its own buffer", async() => {
    const shared = Uint8Array.from([5, 8, 13])
    const artifact = ArtifactRepresentation.make({
      artifactId: Id.artifact("artifact_runtime_shared"),
      digest
    })
    const artifacts = Layer.succeed(ArtifactStore, ArtifactStore.of({
      put: () => Effect.succeed(artifact),
      read: () => Effect.succeed(shared)
    }))
    const bindings = Layer.succeed(ApplicationBindings, ApplicationBindings.of({
      get: () => Effect.succeed(Option.none())
    }))
    const runtime = RepresentationRuntimeLive.pipe(
      Layer.provide(Layer.merge(artifacts, bindings))
    )
    const plan = await Effect.runPromise(Effect.gen(function*() {
      const service = yield* RepresentationRuntime
      return yield* service.resolve(artifact)
    }).pipe(Effect.provide(runtime)))
    expect(plan._tag).toBe("artifact-bytes")
    if (plan._tag !== "artifact-bytes") return
    plan.bytes[0] = 21
    expect([...shared]).toEqual([5, 8, 13])
  })

  it("keeps binding lookup and artifact I/O failures typed", async() => {
    const applicationId = Id.application("application_runtime_failure")
    const application = ApplicationRouteRepresentation.make({
      applicationId,
      route: Schema.decodeUnknownSync(RootedRoute)("/")
    })
    const lookupFailure = new ApplicationBindingLookupFailure({
      applicationId,
      reason: "registry unavailable"
    })
    const ioFailure = new ArtifactStoreIoFailure({
      artifactId: Id.artifact("artifact_runtime_io"),
      operation: "read",
      reason: "device unavailable"
    })
    const artifact = ArtifactRepresentation.make({
      artifactId: ioFailure.artifactId,
      digest
    })
    const bindings = Layer.succeed(ApplicationBindings, ApplicationBindings.of({
      get: () => Effect.fail(lookupFailure)
    }))
    const artifacts = Layer.succeed(ArtifactStore, ArtifactStore.of({
      put: () => Effect.fail(ioFailure),
      read: () => Effect.fail(ioFailure)
    }))
    const runtime = RepresentationRuntimeLive.pipe(
      Layer.provide(Layer.merge(bindings, artifacts))
    )
    const resolve = (representation: typeof application | typeof artifact) => Effect.gen(function*() {
      const service = yield* RepresentationRuntime
      return yield* service.resolve(representation).pipe(Effect.result)
    }).pipe(Effect.provide(runtime))

    const lookup = await Effect.runPromise(resolve(application))
    const read = await Effect.runPromise(resolve(artifact))
    expect(lookup).toEqual(Result.fail(lookupFailure))
    expect(read).toEqual(Result.fail(ioFailure))
  })
})
