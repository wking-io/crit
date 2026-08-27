import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createServer as createHttpServer } from "node:http"
import { createServer } from "node:net"

import { NodeServices } from "@effect/platform-node"
import { AuthorityModel } from "@crit/authority"
import { LocalCanvasClient } from "@crit/client"
import { Id } from "@crit/domain"
import { localApiToken, type LocalApiToken } from "@crit/replica/http"
import { Context, Effect, Exit, Layer, Option, Predicate, Result, Scope } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { describe, expect, it } from "vitest"

import { inspectLocalDaemon, LocalDevelopment } from "../src/index.js"
import { LocalInstallation, type LocalDevelopmentOptions } from "../src/development.js"
import { decodeStored } from "../src/stored-json.js"

const temporaryRoot = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), "crit-development-"))),
  (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true }))
)

const buildWith = (
  dataRoot: string,
  scope: Scope.Scope,
  extras: Omit<LocalDevelopmentOptions, "dataRoot"> = {}
) => Layer.buildWithScope(
  LocalDevelopment.layer({ dataRoot, ...extras }).pipe(Layer.provide(NodeServices.layer)),
  scope
)

const build = (dataRoot: string, scope: Scope.Scope) => buildWith(dataRoot, scope)

const personFrom = (dataRoot: string) =>
  decodeStored(LocalInstallation, readFileSync(join(dataRoot, "installation.json"), "utf8")).principal.person

const clientFor = (
  development: Context.Tag.Service<LocalDevelopment>,
  token: LocalApiToken,
  scope: Scope.Scope
) => Layer.buildWithScope(
  LocalCanvasClient.layer({
    _tag: "bearer",
    baseUrl: development.descriptor.baseUrl,
    token
  }).pipe(Layer.provide(FetchHttpClient.layer)),
  scope
).pipe(Effect.map((context) => Context.get(context, LocalCanvasClient)))

const tokenFor = (dataRoot: string) => localApiToken(
  decodeStored(LocalInstallation, readFileSync(join(dataRoot, "installation.json"), "utf8")).bearerSecret
)

const malformedStatusServer = (port: number) => Effect.acquireRelease(
  Effect.promise(() => new Promise<ReturnType<typeof createHttpServer>>((resolve, reject) => {
    const server = createHttpServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" })
      response.end("{}")
    })
    server.once("error", reject)
    server.listen(port, "127.0.0.1", () => resolve(server))
  })),
  (server) => Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve())))
)

describe("LocalDevelopment", () => {
  it("discovers a running daemon through its authenticated status and then observes shutdown", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const directory = yield* temporaryRoot
      const dataRoot = join(directory, ".crit", "v1")
      yield* Effect.scoped(Effect.gen(function*() {
        yield* build(dataRoot, yield* Effect.scope)
        const inspection = yield* inspectLocalDaemon({ dataRoot }).pipe(
          Effect.provide(FetchHttpClient.layer)
        )
        expect(inspection.kind).toBe("Running")
      }))
      const inspection = yield* inspectLocalDaemon({ dataRoot }).pipe(
        Effect.provide(FetchHttpClient.layer)
      )
      expect(inspection).toEqual({ kind: "Stopped" })
    })).pipe(Effect.provide(NodeServices.layer))))

  it("classifies a valid leftover descriptor as stale without repairing it", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const directory = yield* temporaryRoot
      const dataRoot = join(directory, ".crit", "v1")
      let descriptor = ""
      yield* Effect.scoped(Effect.gen(function*() {
        yield* build(dataRoot, yield* Effect.scope)
        descriptor = readFileSync(join(dataRoot, "daemon.json"), "utf8")
      }))
      writeFileSync(join(dataRoot, "daemon.json"), descriptor)
      const inspection = yield* inspectLocalDaemon({ dataRoot, probeTimeout: "100 millis" })
      expect(inspection.kind).toBe("StaleDescriptor")
      expect(readFileSync(join(dataRoot, "daemon.json"), "utf8")).toBe(descriptor)
    })).pipe(Effect.provide(NodeServices.layer))))

  it("rejects an authenticated daemon whose identity differs from the descriptor", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const directory = yield* temporaryRoot
      const dataRoot = join(directory, ".crit", "v1")
      yield* build(dataRoot, yield* Effect.scope)
      const descriptorPath = join(dataRoot, "daemon.json")
      const descriptor = JSON.parse(readFileSync(descriptorPath, "utf8"))
      writeFileSync(descriptorPath, JSON.stringify({
        ...descriptor,
        instance: "ffffffffffffffffffffffffffffffff"
      }))
      const failure = yield* inspectLocalDaemon({ dataRoot }).pipe(Effect.flip)
      expect(Predicate.isTagged(failure, "LocalDaemonIdentityMismatch")).toBe(true)
      if (Predicate.isTagged(failure, "LocalDaemonIdentityMismatch") && "source" in failure) {
        expect(failure.source).toBe("daemon")
      }
    })).pipe(Effect.provide(NodeServices.layer))))

  it("reports an HTTP responder with an invalid status body as a protocol failure", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const directory = yield* temporaryRoot
      const dataRoot = join(directory, ".crit", "v1")
      let descriptor = ""
      let port = 0
      yield* Effect.scoped(Effect.gen(function*() {
        const development = Context.get(yield* build(dataRoot, yield* Effect.scope), LocalDevelopment)
        descriptor = readFileSync(join(dataRoot, "daemon.json"), "utf8")
        port = Number(new URL(development.descriptor.baseUrl).port)
      }))
      yield* malformedStatusServer(port)
      writeFileSync(join(dataRoot, "daemon.json"), descriptor)
      const failure = yield* inspectLocalDaemon({ dataRoot }).pipe(Effect.flip)
      expect(Predicate.isTagged(failure, "LocalDaemonProtocolFailure")).toBe(true)
    })).pipe(Effect.provide(NodeServices.layer))))

  it("reports malformed installation state without exposing its contents", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const directory = yield* temporaryRoot
      const dataRoot = join(directory, ".crit", "v1")
      mkdirSync(dataRoot, { recursive: true })
      writeFileSync(join(dataRoot, "installation.json"), '{"bearerSecret":"do-not-report"}')
      const failure = yield* inspectLocalDaemon({ dataRoot }).pipe(Effect.flip)
      expect(Predicate.isTagged(failure, "LocalDaemonStateMalformed")).toBe(true)
      expect(String(failure)).not.toContain("do-not-report")
    })).pipe(Effect.provide(NodeServices.layer))))

  it("persists Canvas state across daemon restarts", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const directory = yield* temporaryRoot
      const dataRoot = join(directory, ".crit", "v1")
      const canvasId = Id.canvas("canvas_development_restart")
      yield* Effect.scoped(Effect.gen(function*() {
        const scope = yield* Effect.scope
        const development = Context.get(yield* build(dataRoot, scope), LocalDevelopment)
        const client = yield* clientFor(development, tokenFor(dataRoot), scope)
        yield* client.create(AuthorityModel.createCanvas({ canvasId, title: "Persistent" }))
        yield* client.sync(canvasId)
      }))
      yield* Effect.scoped(Effect.gen(function*() {
        const scope = yield* Effect.scope
        const development = Context.get(yield* build(dataRoot, scope), LocalDevelopment)
        const client = yield* clientFor(development, tokenFor(dataRoot), scope)
        const opened = yield* client.open(canvasId)
        expect(opened.projection.title).toBe("Persistent")
      }))
    }))))

  it("keeps installation secrets out of the daemon descriptor and cleans up its own descriptor", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const directory = yield* temporaryRoot
      const dataRoot = join(directory, ".crit", "v1")
      let installationId = ""
      yield* Effect.scoped(Effect.gen(function*() {
        const context = yield* build(dataRoot, yield* Effect.scope)
        const development = Context.get(context, LocalDevelopment)
        expect(Option.isNone(development.browserBootstrapUrl)).toBe(true)
        installationId = development.installationId
        const descriptor = readFileSync(join(dataRoot, "daemon.json"), "utf8")
        expect(descriptor).not.toContain("bearerSecret")
        expect(descriptor).not.toContain("principal")
        expect(descriptor).not.toContain("local.sqlite")
        expect(JSON.parse(descriptor)).toEqual(development.descriptor)
        expect(statSync(join(dataRoot, "installation.json")).mode & 0o777).toBe(0o600)
        expect(statSync(dataRoot).mode & 0o777).toBe(0o700)
      }))
      expect(() => readFileSync(join(dataRoot, "daemon.json"), "utf8")).toThrow()
      chmodSync(join(dataRoot, "installation.json"), 0o644)
      const restarted = yield* build(dataRoot, yield* Effect.scope)
      expect(Context.get(restarted, LocalDevelopment).installationId).toBe(installationId)
      expect(statSync(join(dataRoot, "installation.json")).mode & 0o777).toBe(0o600)
    }))))

  it("allows exactly one simultaneous first owner", () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const directory = yield* temporaryRoot
    const dataRoot = join(directory, ".crit", "v1")
    const scope = yield* Effect.scope
    const results = yield* Effect.all([
      Effect.result(build(dataRoot, scope)),
      Effect.result(build(dataRoot, scope))
    ], { concurrency: "unbounded" })
    const successes = results.filter(Result.isSuccess)
    const failures = results.filter(Result.isFailure)
    expect(successes).toHaveLength(1)
    expect(failures).toHaveLength(1)
    expect(Predicate.isTagged(failures[0]?.failure, "LocalDaemonOwnershipFailure")).toBe(true)
  }))))

  it("rejects a foreign process occupying the configured port", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const directory = yield* temporaryRoot
      const dataRoot = join(directory, ".crit", "v1")
      const port = yield* Effect.scoped(Effect.gen(function*() {
        const context = yield* build(dataRoot, yield* Effect.scope)
        return Number(new URL(Context.get(context, LocalDevelopment).descriptor.baseUrl).port)
      }))
      const server = yield* Effect.acquireRelease(
        Effect.callback<typeof import("node:net").Server, Error>((resume) => {
          const candidate = createServer()
          candidate.once("error", (cause) => resume(Effect.fail(cause)))
          candidate.listen(port, "127.0.0.1", () => resume(Effect.succeed(candidate)))
        }),
        (candidate) => Effect.callback<void>((resume) => candidate.close(() => resume(Effect.void)))
      )
      expect(server.listening).toBe(true)
      const result = yield* Effect.result(build(dataRoot, yield* Effect.scope))
      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result)) {
        expect(Predicate.isTagged(result.failure, "LocalDaemonOwnershipFailure")).toBe(true)
      }
    }))))

  it("does not remove a descriptor published by another instance", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const directory = yield* temporaryRoot
      const dataRoot = join(directory, ".crit", "v1")
      const replacement = "replacement descriptor"
      yield* Effect.scoped(Effect.gen(function*() {
        yield* build(dataRoot, yield* Effect.scope)
        writeFileSync(join(dataRoot, "daemon.json"), replacement)
      }))
      expect(readFileSync(join(dataRoot, "daemon.json"), "utf8")).toBe(replacement)
    }))))

  it("replaces a stale descriptor only after acquiring the port", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const directory = yield* temporaryRoot
      const dataRoot = join(directory, ".crit", "v1")
      yield* Effect.scoped(Effect.gen(function*() {
        yield* build(dataRoot, yield* Effect.scope)
      }))
      mkdirSync(dataRoot, { recursive: true })
      writeFileSync(join(dataRoot, "daemon.json"), "stale")
      yield* Effect.scoped(Effect.gen(function*() {
        const development = Context.get(yield* build(dataRoot, yield* Effect.scope), LocalDevelopment)
        expect(JSON.parse(readFileSync(join(dataRoot, "daemon.json"), "utf8"))).toEqual(
          development.descriptor
        )
      }))
    }))))

  it("fails closed on a malformed durable installation", () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const directory = yield* temporaryRoot
    const dataRoot = join(directory, ".crit", "v1")
    yield* Effect.sync(() => {
      mkdirSync(dataRoot, { recursive: true })
      writeFileSync(join(dataRoot, "installation.json"), "{}", { mode: 0o600 })
    })
    const result = yield* Effect.exit(build(dataRoot, yield* Effect.scope))
    expect(Exit.isFailure(result)).toBe(true)
  }))))

  it("rejects browser origins outside standalone 127.0.0.1 HTTP", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const directory = yield* temporaryRoot
      const result = yield* Effect.result(Layer.buildWithScope(
        LocalDevelopment.layer({
          dataRoot: join(directory, ".crit", "v1"),
          browserOrigin: "http://localhost:5173"
        }).pipe(Layer.provide(NodeServices.layer)),
        yield* Effect.scope
      ))
      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result)) {
        expect(Predicate.isTagged(result.failure, "LocalDevelopmentFailure")).toBe(true)
        if (Predicate.isTagged(result.failure, "LocalDevelopmentFailure") && "operation" in result.failure) {
          expect(result.failure.operation).toBe("validate browser origin")
        }
      }
    }))))

  it("classifies database startup failures without exposing adapter errors", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const directory = yield* temporaryRoot
      const dataRoot = join(directory, ".crit", "v1")
      yield* Effect.scoped(Effect.gen(function*() {
        yield* build(dataRoot, yield* Effect.scope)
      }))
      rmSync(join(dataRoot, "local.sqlite"))
      mkdirSync(join(dataRoot, "local.sqlite"))
      const result = yield* Effect.result(build(dataRoot, yield* Effect.scope))
      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result)) {
        expect(Predicate.isTagged(result.failure, "LocalDevelopmentFailure")).toBe(true)
        if (Predicate.isTagged(result.failure, "LocalDevelopmentFailure") && "operation" in result.failure) {
          expect(result.failure.operation).toBe("open local database")
        }
      }
    }))))

  it("removes descriptor staging files when publication fails", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const directory = yield* temporaryRoot
      const dataRoot = join(directory, ".crit", "v1")
      yield* Effect.scoped(Effect.gen(function*() {
        yield* build(dataRoot, yield* Effect.scope)
      }))
      mkdirSync(join(dataRoot, "daemon.json"))
      const result = yield* Effect.result(build(dataRoot, yield* Effect.scope))
      expect(Result.isFailure(result)).toBe(true)
      expect(readdirSync(dataRoot).filter((name) => name.startsWith(".daemon-"))).toEqual([])
    }))))

  it("writes unspecified email on first boot", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const directory = yield* temporaryRoot
      const dataRoot = join(directory, ".crit", "v1")
      yield* build(dataRoot, yield* Effect.scope)
      expect(personFrom(dataRoot).email).toEqual({ _tag: "unspecified" })
      expect(personFrom(dataRoot).displayName).toBe("Local Crit User")
    }))))

  it("rewrites a stored Person that predates the email field", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const directory = yield* temporaryRoot
      const dataRoot = join(directory, ".crit", "v1")
      yield* Effect.scoped(Effect.gen(function*() {
        yield* build(dataRoot, yield* Effect.scope)
      }))
      const installationPath = join(dataRoot, "installation.json")
      const stored = JSON.parse(readFileSync(installationPath, "utf8"))
      delete stored.principal.person.email
      writeFileSync(installationPath, JSON.stringify(stored))
      yield* build(dataRoot, yield* Effect.scope)
      expect(personFrom(dataRoot).email).toEqual({ _tag: "unspecified" })
      expect(JSON.parse(readFileSync(installationPath, "utf8")).principal.person.email)
        .toEqual({ _tag: "unspecified" })
    }))))

  it("does not rewrite installation.json on a later boot once email is stored", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const directory = yield* temporaryRoot
      const dataRoot = join(directory, ".crit", "v1")
      yield* Effect.scoped(Effect.gen(function*() {
        yield* build(dataRoot, yield* Effect.scope)
      }))
      const installationPath = join(dataRoot, "installation.json")
      writeFileSync(installationPath, JSON.stringify(
        JSON.parse(readFileSync(installationPath, "utf8")),
        null,
        2
      ))
      const marked = readFileSync(installationPath, "utf8")
      yield* build(dataRoot, yield* Effect.scope)
      expect(readFileSync(installationPath, "utf8")).toBe(marked)
    }))))
})
