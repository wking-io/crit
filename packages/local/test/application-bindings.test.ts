import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import {
  NodeCrypto,
  NodeFileSystem,
  NodeHttpServer,
  NodePath,
  NodeServices
} from "@effect/platform-node"
import {
  ApplicationRouteRepresentation,
  DomainValue,
  HttpUrl,
  Id
} from "@crit/domain"
import {
  ApplicationBaseUrl,
  ApplicationBindings,
  ArtifactStore,
  ArtifactStoreIoFailure,
  LiveContent,
  RepresentationRuntime,
  RepresentationRuntimeLive
} from "@crit/representations"
import { Context, Effect, FileSystem, Layer, Option, Predicate, Result, Schema } from "effect"
import {
  HttpClient,
  HttpRouter,
  HttpServer,
  HttpServerResponse
} from "effect/unstable/http"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  LocalProjectApplicationBindings,
  LocalProjectManifest
} from "../src/index.js"

let root = ""
const TcpAddress = Schema.Struct({ port: Schema.Number })

beforeEach(async() => {
  root = await mkdtemp(path.join(tmpdir(), "crit-application-bindings-"))
})

afterEach(async() => {
  await rm(root, { recursive: true, force: true })
})

const baseUrl = (value: string) => Schema.decodeUnknownSync(ApplicationBaseUrl)(value)

const initialize = () => Effect.gen(function*() {
  const manifest = yield* LocalProjectManifest
  return yield* manifest.initialize
}).pipe(
  Effect.provide(LocalProjectManifest.layer({ root })),
  Effect.provide(NodeServices.layer)
)

const bindings = (value: string) => LocalProjectApplicationBindings.layer({
  root,
  baseUrl: baseUrl(value)
}).pipe(Layer.provide(NodeServices.layer))

const inertArtifactStore = Layer.succeed(ArtifactStore, ArtifactStore.of({
  put: (input) => Effect.fail(new ArtifactStoreIoFailure({
    artifactId: input.artifactId,
    operation: "put",
    reason: "Application route touched the artifact store"
  })),
  read: (artifact) => Effect.fail(new ArtifactStoreIoFailure({
    artifactId: artifact.artifactId,
    operation: "read",
    reason: "Application route touched the artifact store"
  }))
}))

const inertLiveContent = Layer.succeed(LiveContent, LiveContent.of({
  get: () => Effect.die("Application resolve touched live content")
}))

const applicationServer = (requests: Array<string>) => HttpRouter.serve(
  HttpRouter.add("GET", "/*", (request) => {
    requests.push(request.url)
    return Effect.succeed(HttpServerResponse.text(`application response for ${request.url}`))
  }),
  { disableListenLog: true, disableLogger: true }
).pipe(Layer.provideMerge(NodeHttpServer.layerTest))

describe("LocalProjectApplicationBindings", () => {
  it("reads the project identity and binds only its exact application", async() => {
    const initialized = await Effect.runPromise(initialize())
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const context = yield* Layer.build(bindings("http://127.0.0.1:5173/"))
      const lookup = Context.get(context, ApplicationBindings)
      expect(Option.getOrUndefined(yield* lookup.get(initialized.manifest.applicationId)))
        .toBe("http://127.0.0.1:5173/")
      expect(Option.isNone(yield* lookup.get(Id.application("application_foreign"))))
        .toBe(true)
    })))
  })

  it("reads the manifest through exactly one opened file", async() => {
    await Effect.runPromise(initialize())
    let manifestOpens = 0
    const countingFileSystem = Layer.effect(FileSystem.FileSystem, Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      return FileSystem.make({
        ...fs,
        open: (target, options) => {
          if (target === path.join(root, "crit.manifest.json")) manifestOpens += 1
          return fs.open(target, options)
        }
      })
    })).pipe(Layer.provide(NodeFileSystem.layer))
    const platform = Layer.mergeAll(countingFileSystem, NodePath.layer, NodeCrypto.layer)
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const context = yield* Layer.build(LocalProjectApplicationBindings.layer({
        root,
        baseUrl: baseUrl("http://127.0.0.1:5173/")
      }).pipe(Layer.provide(platform)))
      const lookup = Context.get(context, ApplicationBindings)
      yield* lookup.get(Id.application("application_first"))
      yield* lookup.get(Id.application("application_second"))
      yield* lookup.get(Id.application("application_third"))
    })))
    expect(manifestOpens).toBe(1)
  })

  it("retains typed manifest failures while building the adapter layer", async() => {
    const missing = await Effect.runPromise(Effect.scoped(
      Layer.build(bindings("http://127.0.0.1:5173/")).pipe(Effect.result)
    ))
    expect(Result.isFailure(missing)).toBe(true)
    if (Result.isFailure(missing)) {
      expect(Predicate.isTagged(missing.failure, "ProjectManifestIoFailure")).toBe(true)
    }
    await writeFile(path.join(root, "crit.manifest.json"), JSON.stringify({
      schemaVersion: 2,
      applicationId: "application_invalid",
      excess: true
    }))
    const invalid = await Effect.runPromise(Effect.scoped(
      Layer.build(bindings("http://127.0.0.1:5173/")).pipe(Effect.result)
    ))
    expect(Result.isFailure(invalid)).toBe(true)
    if (Result.isFailure(invalid)) {
      expect(Predicate.isTagged(invalid.failure, "ProjectManifestInvalid")).toBe(true)
    }
  })

  it("resolves and fetches an application route from a real loopback server", async() => {
    const requests: Array<string> = []
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const initialized = yield* initialize()
      const scope = yield* Effect.scope
      const serverContext = yield* Layer.buildWithScope(applicationServer(requests), scope)
      const server = Context.get(serverContext, HttpServer.HttpServer)
      const client = Context.get(serverContext, HttpClient.HttpClient)
      const address = Schema.decodeUnknownSync(TcpAddress)(server.address)
      const origin = `http://127.0.0.1:${address.port}/`
      const representation = ApplicationRouteRepresentation.make({
        applicationId: initialized.manifest.applicationId,
        route: "/products/%E2%9C%93?view=grid",
        state: null
      })
      const plan = yield* Effect.gen(function*() {
        const runtime = yield* RepresentationRuntime
        return yield* runtime.resolve(representation)
      }).pipe(Effect.provide(RepresentationRuntimeLive.pipe(
        Layer.provideMerge(bindings(origin)),
        Layer.provideMerge(inertArtifactStore),
        Layer.provideMerge(inertLiveContent),
        Layer.provideMerge(NodeCrypto.layer)
      )))
      expect(Predicate.isTagged(plan, "iframe")).toBe(true)
      if (!Predicate.isTagged(plan, "iframe") || !("url" in plan)) return
      expect(plan.url).toBe(Schema.decodeUnknownSync(HttpUrl)(
        `${origin}products/%E2%9C%93?view=grid`
      ))
      const resolved = new URL(plan.url)
      const response = yield* client.get(`${resolved.pathname}${resolved.search}`)
      expect(response.status).toBe(200)
      expect(yield* response.text).toBe(
        "application response for /products/%E2%9C%93?view=grid"
      )
      expect(requests).toEqual(["/products/%E2%9C%93?view=grid"])
    })))
  })

  it("resolves the same representation through independent machine bindings", async() => {
    const initialized = await Effect.runPromise(initialize())
    const state = { selection: { product: "product_original" } }
    const input = ApplicationRouteRepresentation.make({
      applicationId: initialized.manifest.applicationId,
      route: "/products/%E2%9C%93?view=grid",
      state
    })
    const original = DomainValue.detach(input)
    const resolve = (origin: string) => Effect.gen(function*() {
      const runtime = yield* RepresentationRuntime
      return yield* runtime.resolve(input)
    }).pipe(Effect.provide(RepresentationRuntimeLive.pipe(
      Layer.provideMerge(bindings(origin)),
      Layer.provideMerge(inertArtifactStore),
      Layer.provideMerge(inertLiveContent),
      Layer.provideMerge(NodeCrypto.layer)
    )))
    const local = await Effect.runPromise(resolve("http://127.0.0.1:5173/"))
    const preview = await Effect.runPromise(resolve("https://preview.example/"))
    expect(Predicate.isTagged(local, "iframe")).toBe(true)
    expect(Predicate.isTagged(preview, "iframe")).toBe(true)
    if (
      Predicate.isTagged(local, "iframe") && "url" in local && "representation" in local &&
      Predicate.isTagged(preview, "iframe") && "url" in preview && "representation" in preview
    ) {
      expect(local.url).toBe(Schema.decodeUnknownSync(HttpUrl)(
        "http://127.0.0.1:5173/products/%E2%9C%93?view=grid"
      ))
      expect(preview.url).toBe("https://preview.example/products/%E2%9C%93?view=grid")
      expect(local.representation).toEqual(original)
      expect(preview.representation).toEqual(original)
      expect(local.representation).not.toBe(input)
      expect(preview.representation).not.toBe(input)
    }
    expect(input).toEqual(original)
    state.selection.product = "product_changed"
    expect(local.representation.state).toEqual(original.state)
    expect(preview.representation.state).toEqual(original.state)
  })

  it("returns an unavailable plan for another application", async() => {
    await Effect.runPromise(initialize())
    const representation = ApplicationRouteRepresentation.make({
      applicationId: Id.application("application_foreign"),
      route: "/foreign",
      state: null
    })
    const plan = await Effect.runPromise(Effect.gen(function*() {
      const runtime = yield* RepresentationRuntime
      return yield* runtime.resolve(representation)
    }).pipe(Effect.provide(RepresentationRuntimeLive.pipe(
      Layer.provideMerge(bindings("http://127.0.0.1:5173/")),
      Layer.provideMerge(inertArtifactStore),
      Layer.provideMerge(inertLiveContent),
      Layer.provideMerge(NodeCrypto.layer)
    ))))
    expect(plan).toMatchObject({
      _tag: "unavailable",
      reason: "application-unbound",
      representation
    })
  })
})
