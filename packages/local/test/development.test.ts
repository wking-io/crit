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
import { createServer } from "node:net"

import { NodeServices } from "@effect/platform-node"
import { AuthorityModel } from "@crit/authority"
import { LocalCanvasClient } from "@crit/client"
import { Id } from "@crit/domain"
import { localApiToken, type LocalApiToken } from "@crit/replica/http"
import { Context, Effect, Exit, Layer, Result, Scope } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { describe, expect, it } from "vitest"

import { LocalDevelopment } from "../src/index.js"
import { LocalInstallation } from "../src/development.js"
import { decodeStored } from "../src/stored-json.js"

const temporaryRoot = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), "crit-development-"))),
  (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true }))
)

const build = (dataRoot: string, scope: Scope.Scope) => Layer.buildWithScope(
  LocalDevelopment.layer({ dataRoot }).pipe(Layer.provide(NodeServices.layer)),
  scope
)

const clientFor = (
  development: Context.Tag.Service<LocalDevelopment>,
  token: LocalApiToken,
  scope: Scope.Scope
) => Layer.buildWithScope(
  LocalCanvasClient.layer({
    baseUrl: development.descriptor.baseUrl,
    token
  }).pipe(Layer.provide(FetchHttpClient.layer)),
  scope
).pipe(Effect.map((context) => Context.get(context, LocalCanvasClient)))

const tokenFor = (dataRoot: string) => localApiToken(
  decodeStored(LocalInstallation, readFileSync(join(dataRoot, "installation.json"), "utf8")).bearerSecret
)

describe("LocalDevelopment", () => {
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
    expect(failures[0]?.failure._tag).toBe("LocalDaemonOwnershipFailure")
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
      if (Result.isFailure(result)) expect(result.failure._tag).toBe("LocalDaemonOwnershipFailure")
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
        expect(result.failure._tag).toBe("LocalDevelopmentFailure")
        if (result.failure._tag === "LocalDevelopmentFailure") {
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
})
