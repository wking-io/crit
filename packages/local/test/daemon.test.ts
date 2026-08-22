import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  AuthorityClockLive,
  AuthorityFailure,
  AuthorityModel,
  CanvasAuthority,
  PersonInvocation
} from "@crit/authority"
import { LocalCanvasClient } from "@crit/client"
import { Id, decodeCanvasCommandBatch } from "@crit/domain"
import {
  LocalDaemonInstanceNonce,
  LocalApiOriginRejected,
  LocalApiUnauthorized,
  localApiToken
} from "@crit/replica/http"
import { ReplicaModel } from "@crit/replica"
import { Context, Effect, Layer, Schema } from "effect"
import { FetchHttpClient, HttpServer } from "effect/unstable/http"
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
  }), scope)
  const server = Context.get(serverContext, HttpServer.HttpServer)
  if (server.address._tag !== "TcpAddress") return yield* Effect.die("expected TCP daemon")
  const clientContext = yield* Layer.buildWithScope(
    LocalCanvasClient.layer({
      baseUrl: `http://127.0.0.1:${server.address.port}`,
      token: localApiToken(options.clientToken ?? options.token),
      origin: options.origin
    }).pipe(Layer.provide(FetchHttpClient.layer)),
    scope
  )
  return {
    client: Context.get(clientContext, LocalCanvasClient),
    baseUrl: `http://127.0.0.1:${server.address.port}`
  }
})

const rawHeaders = (token: string, version = "1") => ({
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
  "x-crit-api-version": version
})

describe("LocalDaemon", () => {
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
        const created = yield* client.create(AuthorityModel.createCanvas({ canvasId, title: "Original" }))
        expect(created.projection.title).toBe("Original")
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
        const synced = yield* client.sync(canvasId)
        expect(synced.view.projection.title).toBe("Changed")
        expect(synced.view.pending).toHaveLength(0)
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
    const { client } = yield* clientFor({
      databasePath,
      token: "correct-token-with-at-least-32-characters",
      clientToken: "wrong-token-with-at-least-32-characters"
    })
    const failure = yield* client.open(Id.canvas("canvas_auth")).pipe(Effect.flip)
    expect(failure).toEqual(new LocalApiUnauthorized({ message: "Missing or invalid bearer token" }))
    const statusFailure = yield* client.status().pipe(Effect.flip)
    expect(statusFailure).toEqual(new LocalApiUnauthorized({ message: "Missing or invalid bearer token" }))
  }))))

  it("rejects a present foreign Origin", () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const databasePath = yield* tempDatabasePath
    const { client } = yield* clientFor({
      databasePath,
      token: "correct-token-with-at-least-32-characters",
      origin: "http://neighbor.example"
    })
    const failure = yield* client.open(Id.canvas("canvas_origin")).pipe(Effect.flip)
    expect(failure).toEqual(new LocalApiOriginRejected({ origin: "http://neighbor.example" }))
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
