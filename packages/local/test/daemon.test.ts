import { mkdtempSync, rmSync } from "node:fs"
import { request as nodeRequest } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  AuthorityClockLive,
  AuthorityFailure,
  AuthorityModel,
  CanvasAuthority,
  PersonInvocation
} from "@crit/authority"
import { LocalCanvasClient, LocalRepresentationClient } from "@crit/client"
import {
  ApplicationRouteRepresentation,
  ArtifactRepresentation,
  Id,
  WebUrlRepresentation,
  decodeCanvasCommandBatch
} from "@crit/domain"
import {
  LocalDaemonInstanceNonce,
  LocalApiOriginRejected,
  LocalApiUnauthorized,
  LocalApiVersionUnsupported,
  localApiToken
} from "@crit/replica/http"
import { ReplicaModel } from "@crit/replica"
import {
  ApplicationBaseUrl,
  ApplicationBindingLookupFailure,
  ApplicationBindings,
  ArtifactStore,
  LocalRepresentationResolveFailure,
  RepresentationRuntimeLive
} from "@crit/representations"
import { Context, Effect, Fiber, Layer, Option, Schema, Stream, Tracer } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpServer } from "effect/unstable/http"
import * as Socket from "effect/unstable/socket/Socket"
import { describe, expect, it } from "vitest"

import { LocalDaemon, SqliteCanvasAuthority } from "../src/index.js"

const invocation = Schema.decodeUnknownSync(PersonInvocation)({
  _tag: "person",
  principal: {
    _tag: "person",
    subject: "local|daemon-test",
    person: {
      _tag: "person",
      personId: "person_daemon_test",
      displayName: "Daemon Test"
    }
  }
})
const instance = Schema.decodeUnknownSync(LocalDaemonInstanceNonce)("0123456789abcdef0123456789abcdef")
const installationId = Id.installation("installation_daemon_test")
const applicationId = Id.application("application_daemon_test")
const artifactBytes = new TextEncoder().encode("artifact transport bytes")

const representationRuntime = RepresentationRuntimeLive.pipe(
  Layer.provide(Layer.succeed(ApplicationBindings, ApplicationBindings.of({
    get: (requested) => Effect.succeed(requested === applicationId
      ? Option.some(Schema.decodeUnknownSync(ApplicationBaseUrl)("http://127.0.0.1:4173/"))
      : Option.none())
  }))),
  Layer.provide(Layer.succeed(ArtifactStore, ArtifactStore.of({
    put: (input) => Effect.succeed(ArtifactRepresentation.make({
      artifactId: input.artifactId,
      digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    })),
    read: () => Effect.succeed(artifactBytes)
  })))
)

const tempDatabasePath = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), "crit-local-daemon-"))),
  (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true }))
).pipe(Effect.map((directory) => join(directory, "local.sqlite")))

const clientFor = (options: {
  readonly databasePath: string
  readonly token: string
  readonly clientToken?: string
  readonly origin?: string
}) => Effect.gen(function*() {
  const scope = yield* Effect.scope
  const serverContext = yield* Layer.buildWithScope(LocalDaemon.layer({
    databasePath: options.databasePath,
    token: localApiToken(options.token),
    allowedOrigins: new Set(["http://127.0.0.1:5173"]),
    invocation,
    instance,
    installationId
  }).pipe(Layer.provide(representationRuntime)), scope)
  const server = Context.get(serverContext, HttpServer.HttpServer)
  if (server.address._tag !== "TcpAddress") return yield* Effect.die("expected TCP daemon")
  const clientContext = yield* Layer.buildWithScope(
    Layer.merge(
      LocalCanvasClient.layer({
      baseUrl: `http://127.0.0.1:${server.address.port}`,
      token: localApiToken(options.clientToken ?? options.token),
      origin: options.origin
      }),
      LocalRepresentationClient.layer({
        _tag: "bearer",
        baseUrl: `http://127.0.0.1:${server.address.port}`,
        token: localApiToken(options.clientToken ?? options.token),
        origin: options.origin
      })
    ).pipe(Layer.provide(FetchHttpClient.layer)),
    scope
  )
  return {
    client: Context.get(clientContext, LocalCanvasClient),
    representations: Context.get(clientContext, LocalRepresentationClient),
    baseUrl: `http://127.0.0.1:${server.address.port}`
  }
})

const rawHeaders = (token: string, version = "1") => ({
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
  "x-crit-api-version": version
})

describe("LocalDaemon", () => {
  it("resolves application, web, unavailable, and artifact representations over bearer HTTP", () => {
    const token = "private-token-canary-with-at-least-32-characters"
    return Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const databasePath = yield* tempDatabasePath
      const { representations } = yield* clientFor({ databasePath, token })
      const application = yield* representations.resolve(ApplicationRouteRepresentation.make({
        applicationId,
        route: "/preview?mode=local"
      }))
      expect(application).toMatchObject({
        _tag: "iframe",
        url: "http://127.0.0.1:4173/preview?mode=local"
      })
      const web = yield* representations.resolve(WebUrlRepresentation.make({
        url: "https://example.com/preview"
      }))
      expect(web).toMatchObject({ _tag: "iframe", url: "https://example.com/preview" })
      const unavailable = yield* representations.resolve(ApplicationRouteRepresentation.make({
        applicationId: Id.application("application_unbound"),
        route: "/"
      }))
      expect(unavailable).toMatchObject({ _tag: "unavailable", reason: "application-unbound" })
      const artifact = ArtifactRepresentation.make({
        artifactId: Id.artifact("artifact_transport"),
        digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      })
      const rendered = yield* representations.resolve(artifact)
      expect(rendered).toMatchObject({ _tag: "artifact-bytes", representation: artifact })
      if (rendered._tag === "artifact-bytes") expect(rendered.bytes).toEqual(artifactBytes)
    })))
  })

  it("bounds and strictly decodes representation requests", () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const databasePath = yield* tempDatabasePath
    const token = "request-bounds-token-with-at-least-32-characters"
    const { baseUrl } = yield* clientFor({ databasePath, token })
    const endpoint = `${baseUrl}/api/v1/representations/resolve`
    const request = (body: string) => Effect.promise(() => fetch(endpoint, {
      method: "POST",
      headers: rawHeaders(token),
      body
    }))
    expect((yield* request("not-json")).status).toBe(400)
    expect((yield* request(JSON.stringify({
      _tag: "resolve-representation",
      schemaVersion: 1,
      representation: {
        _tag: "web-url",
        url: "https://example.com/",
        excess: true
      }
    }))).status).toBe(400)
    expect((yield* request(JSON.stringify({
      _tag: "resolve-representation",
      schemaVersion: 1,
      representation: {
        _tag: "web-url",
        url: `https://example.com/${"x".repeat(17_000)}`
      }
    }))).status).toBe(413)
    const chunkedStatus = yield* Effect.promise(() => new Promise<number>((resolve, reject) => {
      const outgoing = nodeRequest(endpoint, {
        method: "POST",
        headers: rawHeaders(token)
      }, (response) => {
        resolve(response.statusCode ?? 0)
        response.destroy()
      })
      outgoing.once("error", reject)
      outgoing.write(JSON.stringify({
        _tag: "resolve-representation",
        schemaVersion: 1,
        representation: { _tag: "web-url", url: "https://example.com/" }
      }))
      outgoing.end()
    }))
    expect(chunkedStatus).toBe(411)
  }))))

  it("returns a stable representation runtime failure without leaking its reason", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const databasePath = yield* tempDatabasePath
      const token = "runtime-failure-token-with-at-least-32-characters"
      const scope = yield* Effect.scope
      const secret = "private binding failure canary"
      const failingRuntime = RepresentationRuntimeLive.pipe(
        Layer.provide(Layer.succeed(ApplicationBindings, ApplicationBindings.of({
          get: (requestedApplicationId) => Effect.fail(new ApplicationBindingLookupFailure({
            applicationId: requestedApplicationId,
            reason: secret
          }))
        }))),
        Layer.provide(Layer.succeed(ArtifactStore, ArtifactStore.of({
          put: (input) => Effect.succeed(ArtifactRepresentation.make({
            artifactId: input.artifactId,
            digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
          })),
          read: () => Effect.succeed(artifactBytes)
        })))
      )
      const serverContext = yield* Layer.buildWithScope(LocalDaemon.layer({
        databasePath,
        token: localApiToken(token),
        allowedOrigins: new Set(),
        invocation,
        instance,
        installationId
      }).pipe(Layer.provide(failingRuntime)), scope)
      const server = Context.get(serverContext, HttpServer.HttpServer)
      if (server.address._tag !== "TcpAddress") return yield* Effect.die("expected TCP daemon")
      const baseUrl = `http://127.0.0.1:${server.address.port}`
      const clientContext = yield* Layer.buildWithScope(
        LocalRepresentationClient.layer({ _tag: "bearer", baseUrl, token: localApiToken(token) }).pipe(
          Layer.provide(FetchHttpClient.layer)
        ),
        scope
      )
      const clientFailure = yield* Context.get(clientContext, LocalRepresentationClient).resolve(
        ApplicationRouteRepresentation.make({ applicationId, route: "/" })
      ).pipe(Effect.flip)
      expect(clientFailure).toEqual(new LocalRepresentationResolveFailure({
        schemaVersion: 1,
        reason: "application-binding"
      }))
      const response = yield* Effect.promise(() => fetch(
        `${baseUrl}/api/v1/representations/resolve`,
        {
          method: "POST",
          headers: rawHeaders(token),
          body: JSON.stringify({
            _tag: "resolve-representation",
            schemaVersion: 1,
            representation: {
              _tag: "application-route",
              applicationId,
              route: "/"
            }
          })
        }
      ))
      expect(response.status).toBe(500)
      const body = yield* Effect.promise(() => response.text())
      expect(JSON.parse(body)).toEqual({
        _tag: "LocalRepresentationResolveFailure",
        schemaVersion: 1,
        reason: "application-binding"
      })
      expect(body).not.toContain(secret)
    }))))

  it("propagates Effect HTTP context into domain and SQL spans", () => {
    const spans: Array<Tracer.NativeSpan> = []
    const tracer = Tracer.make({
      span(options) {
        const span = new Tracer.NativeSpan(options)
        spans.push(span)
        return span
      }
    })
    const token = "private-token-canary-with-at-least-32-characters"
    const canvasId = Id.canvas("canvas_private_canary")
    const program = Effect.scoped(Effect.gen(function*() {
      const databasePath = yield* tempDatabasePath
      const { client } = yield* clientFor({ databasePath, token })
      yield* client.create(AuthorityModel.createCanvas({ canvasId, title: "Private title canary" }))
    })).pipe(Effect.provideService(Tracer.Tracer, tracer))

    return Effect.runPromise(program).then(() => {
      const clientSpan = spans.find((span) => span.name === "http.client POST")
      const serverSpan = spans.find((span) => span.name === "http.server POST")
      const authoritySpan = spans.find((span) => span.name === "crit.authority.create")
      const replicaSpan = spans.find((span) => span.name === "crit.replica.open")
      expect(clientSpan?.kind).toBe("client")
      expect(serverSpan?.kind).toBe("server")
      expect(serverSpan?.traceId).toBe(clientSpan?.traceId)
      expect(Option.getOrUndefined(serverSpan?.parent ?? Option.none())?.spanId).toBe(clientSpan?.spanId)
      expect(authoritySpan?.traceId).toBe(clientSpan?.traceId)
      expect(replicaSpan?.traceId).toBe(clientSpan?.traceId)
      expect(spans.some((span) => span.name === "sql.execute")).toBe(true)
      const serialized = JSON.stringify(spans.map((span) => ({
        name: span.name,
        attributes: [...span.attributes],
        traceId: span.traceId,
        spanId: span.spanId
      })))
      expect(serialized).not.toContain(token)
      expect(serialized).not.toContain("Private title canary")
    })
  })

  it("accepts Effect's standard B3 context", () => {
    const spans: Array<Tracer.NativeSpan> = []
    const tracer = Tracer.make({
      span(options) {
        const span = new Tracer.NativeSpan(options)
        spans.push(span)
        return span
      }
    })
    const token = "b3-token-canary-with-at-least-32-characters"
    const program = Effect.scoped(Effect.gen(function*() {
      const databasePath = yield* tempDatabasePath
      const { baseUrl } = yield* clientFor({ databasePath, token })
      const response = yield* Effect.promise(() => fetch(`${baseUrl}/api/v1/status`, {
        headers: {
          ...rawHeaders(token),
          b3: "463ac35c9f6413ad48485a3953bb6124-a2fb4a1d1a96d312-1"
        }
      }))
      expect(response.status).toBe(200)
    })).pipe(Effect.provideService(Tracer.Tracer, tracer))

    return Effect.runPromise(program).then(() => {
      const serverSpan = spans.find((span) => span.name === "http.server GET")
      expect(serverSpan?.traceId).toBe("463ac35c9f6413ad48485a3953bb6124")
      expect(Option.getOrUndefined(serverSpan?.parent ?? Option.none())?.spanId).toBe("a2fb4a1d1a96d312")
    })
  })

  it("persists create, change, and sync through a real loopback server", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const databasePath = yield* tempDatabasePath
      const canvasId = Id.canvas("canvas_daemon_roundtrip")
      yield* Effect.scoped(Effect.gen(function*() {
        const token = "daemon-token-with-at-least-32-characters"
        const { baseUrl, client } = yield* clientFor({ databasePath, token })
        expect(yield* client.status()).toEqual({
          version: 1,
          instance,
          installationId,
          apiVersion: "1"
        })
        const rawMissing = yield* Effect.promise(() => fetch(
          `${baseUrl}/api/v1/open/canvas_daemon_raw_missing`,
          { headers: rawHeaders(token) }
        ))
        expect(rawMissing.status).toBe(404)
        const missing = yield* client.open(Id.canvas("canvas_daemon_missing")).pipe(Effect.flip)
        expect(missing).toEqual(AuthorityFailure.canvasNotFound({
          canvasId: Id.canvas("canvas_daemon_missing")
        }))
        const missingSubscription = yield* client.subscribe(Id.canvas("canvas_daemon_missing")).pipe(
          Effect.provide(Socket.layerWebSocketConstructorGlobal),
          Effect.result
        )
        expect(missingSubscription).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "ReplicaNotOpen", canvasId: "canvas_daemon_missing" }
        })
        const created = yield* client.create(AuthorityModel.createCanvas({ canvasId, title: "Original" }))
        expect(created.projection.title).toBe("Original")
        yield* Effect.scoped(Effect.gen(function*() {
          const notifications = yield* client.subscribe(canvasId).pipe(
            Effect.provide(Socket.layerWebSocketConstructorGlobal)
          )
          const notification = yield* notifications.pipe(Stream.runHead, Effect.forkChild)
          const duplicate = yield* Effect.promise(() => fetch(`${baseUrl}/api/v1/create`, {
            method: "POST",
            headers: rawHeaders(token),
            body: JSON.stringify({ _tag: "create-canvas", canvasId, title: "Original" })
          }))
          expect(duplicate.status).toBe(409)
          const rejectedChange = yield* Effect.promise(() => fetch(`${baseUrl}/api/v1/change`, {
            method: "POST",
            headers: rawHeaders(token),
            body: JSON.stringify({
              _tag: "replica-change",
              canvasId,
              commands: [{
                _tag: "rename-canvas",
                expectedTitle: "Wrong",
                title: "Rejected"
              }]
            })
          }))
          expect(rejectedChange.status).toBe(409)
          const changed = yield* client.change(ReplicaModel.change({
            canvasId,
            commands: decodeCanvasCommandBatch([{
              _tag: "rename-canvas",
              expectedTitle: "Original",
              title: "Changed"
            }])
          }))
          expect(changed.view.projection.title).toBe("Changed")
          expect(changed.view.pending).toHaveLength(1)
          expect(yield* Fiber.join(notification)).toEqual(Option.some({
            kind: "replica-changed",
            schemaVersion: 1,
            canvasId
          }))
        }))
        const synced = yield* client.sync(canvasId)
        expect(synced.view.projection.title).toBe("Changed")
        expect(synced.view.pending).toHaveLength(0)
        expect((yield* client.open(canvasId)).projection.title).toBe("Changed")
      }))
      yield* Effect.scoped(Effect.gen(function*() {
        const { client: restarted } = yield* clientFor({
          databasePath,
          token: "daemon-token-with-at-least-32-characters"
        })
        const opened = yield* restarted.open(canvasId)
        expect(opened.projection.title).toBe("Changed")
        expect(opened.pending).toHaveLength(0)
      }))
    }))))

  it("rejects invalid bearer credentials", () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const databasePath = yield* tempDatabasePath
    const { baseUrl, client, representations } = yield* clientFor({
      databasePath,
      token: "correct-token-with-at-least-32-characters",
      clientToken: "wrong-token-with-at-least-32-characters"
    })
    const failure = yield* client.open(Id.canvas("canvas_auth")).pipe(Effect.flip)
    expect(failure).toEqual(new LocalApiUnauthorized({ message: "Missing or invalid bearer token" }))
    const statusFailure = yield* client.status().pipe(Effect.flip)
    expect(statusFailure).toEqual(new LocalApiUnauthorized({ message: "Missing or invalid bearer token" }))
    const representationFailure = yield* representations.resolve(WebUrlRepresentation.make({
      url: "https://example.com/"
    })).pipe(Effect.flip)
    expect(representationFailure).toEqual(new LocalApiUnauthorized({ message: "Missing or invalid bearer token" }))
    const socketFailure = yield* client.subscribe(Id.canvas("canvas_auth")).pipe(
      Effect.provide(Socket.layerWebSocketConstructorGlobal),
      Effect.flip
    )
    expect(socketFailure).toEqual(new LocalApiUnauthorized({ message: "Missing or invalid bearer token" }))
    const rejectedSocket = yield* Effect.promise(() => fetch(
      `${baseUrl}/api/v1/subscribe/canvas_auth`
    ))
    expect(rejectedSocket.status).toBe(400)
  }))))

  it("rejects a present foreign Origin", () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const databasePath = yield* tempDatabasePath
    const { client, representations } = yield* clientFor({
      databasePath,
      token: "correct-token-with-at-least-32-characters",
      origin: "http://neighbor.example"
    })
    const failure = yield* client.open(Id.canvas("canvas_origin")).pipe(Effect.flip)
    expect(failure).toEqual(new LocalApiOriginRejected({ origin: "http://neighbor.example" }))
    const representationFailure = yield* representations.resolve(WebUrlRepresentation.make({
      url: "https://example.com/"
    })).pipe(Effect.flip)
    expect(representationFailure).toEqual(new LocalApiOriginRejected({ origin: "http://neighbor.example" }))
  }))))

  it("rejects unsupported versions and ignores untrusted identity fields", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const databasePath = yield* tempDatabasePath
      const token = "version-token-with-at-least-32-characters"
      const { baseUrl, client } = yield* clientFor({ databasePath, token })
      const versionFailure = yield* Effect.promise(() => fetch(
        `${baseUrl}/api/v1/open/canvas_version_failure`,
        { headers: rawHeaders(token, "2") }
      ))
      expect(versionFailure.status).toBe(426)
      expect(yield* Effect.promise(() => versionFailure.json())).toEqual({
        _tag: "LocalApiVersionUnsupported",
        requestedVersion: "2",
        supportedVersion: "1"
      })
      const versionedHttp = Layer.effect(HttpClient.HttpClient, Effect.gen(function*() {
        const http = yield* HttpClient.HttpClient
        return HttpClient.mapRequest(http, HttpClientRequest.setHeader("x-crit-api-version", "2"))
      })).pipe(Layer.provide(FetchHttpClient.layer))
      const versionedContext = yield* Layer.buildWithScope(
        LocalRepresentationClient.layer({ _tag: "bearer", baseUrl, token: localApiToken(token) }).pipe(
          Layer.provide(versionedHttp)
        ),
        yield* Effect.scope
      )
      const representationVersionFailure = yield* Context.get(
        versionedContext,
        LocalRepresentationClient
      ).resolve(
        WebUrlRepresentation.make({ url: "https://example.com/" })
      ).pipe(Effect.flip)
      expect(representationVersionFailure).toEqual(new LocalApiVersionUnsupported({
        requestedVersion: "2",
        supportedVersion: "1"
      }))

      const canvasId = Id.canvas("canvas_untrusted_identity")
      const malicious = yield* Effect.promise(() => fetch(`${baseUrl}/api/v1/create`, {
        method: "POST",
        headers: rawHeaders(token),
        body: JSON.stringify({
          _tag: "create-canvas",
          canvasId,
          title: "Trusted boundary",
          actor: { _tag: "person", personId: "person_attacker", displayName: "Attacker" },
          acceptedAt: "2020-01-01T00:00:00.000Z",
          changeId: "change_attacker",
          invocation: {
            _tag: "person",
            principal: {
              _tag: "person",
              subject: "local|attacker",
              person: { _tag: "person", personId: "person_attacker", displayName: "Attacker" }
            }
          }
        })
      }))
      expect(malicious.status).toBe(200)
      yield* client.open(canvasId)

      const scope = yield* Effect.scope
      const authorityContext = yield* Layer.buildWithScope(
        SqliteCanvasAuthority.layer({ path: databasePath }).pipe(Layer.provide(AuthorityClockLive)),
        scope
      )
      const stored = yield* Context.get(authorityContext, CanvasAuthority).open(canvasId)
      expect(stored.createdBy).toEqual({ _tag: "person", person: invocation.principal.person })
      expect(stored.createdAt).not.toBe("2020-01-01T00:00:00.000Z")
    }))))
})
