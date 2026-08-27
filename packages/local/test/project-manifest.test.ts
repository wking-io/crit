import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { NodeCrypto, NodeFileSystem, NodePath, NodeServices } from "@effect/platform-node"
import { Crypto, Effect, FileSystem, Layer, Predicate, Result } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  critProjectManifestFile,
  LocalProjectManifest
} from "../src/index.js"

let root = ""

beforeEach(async() => {
  root = await mkdtemp(path.join(tmpdir(), "crit-project-manifest-"))
})

afterEach(async() => {
  await rm(root, { recursive: true, force: true })
})

const manifestPath = () => path.join(root, critProjectManifestFile)

const run = <A, E>(effect: Effect.Effect<A, E, LocalProjectManifest>) => Effect.runPromise(
  effect.pipe(
    Effect.provide(LocalProjectManifest.layer({ root })),
    Effect.provide(NodeServices.layer)
  )
)

const initialize = () => run(Effect.gen(function*() {
  const manifest = yield* LocalProjectManifest
  return yield* manifest.initialize
}))

const initializeEffect = () => Effect.gen(function*() {
  const manifest = yield* LocalProjectManifest
  return yield* manifest.initialize
}).pipe(Effect.provide(LocalProjectManifest.layer({ root })))

describe("LocalProjectManifest", () => {
  it("creates once and byte-preserves an existing manifest", async() => {
    const created = await initialize()
    expect(Predicate.isTagged(created, "created")).toBe(true)
    expect(created.manifest.schemaVersion).toBe(2)
    expect(created.manifest.applicationId).toMatch(/^application_/)
    const firstBytes = await readFile(manifestPath())
    expect(JSON.parse(firstBytes.toString("utf8"))).toEqual(created.manifest)
    const unchanged = await initialize()
    expect(Predicate.isTagged(unchanged, "unchanged")).toBe(true)
    expect(unchanged.manifest).toEqual(created.manifest)
    expect(await readFile(manifestPath())).toEqual(firstBytes)
    expect((await readdir(root)).filter((name) => name.startsWith(".crit-manifest-"))).toEqual([])
  })

  it("converges independent concurrent initializers on one identity", async() => {
    const results = await Effect.runPromise(Effect.all(
      Array.from({ length: 16 }, initializeEffect),
      { concurrency: "unbounded" }
    ).pipe(Effect.provide(NodeServices.layer)))
    expect(results.filter(Predicate.isTagged("created"))).toHaveLength(1)
    expect(new Set(results.map((result) => result.manifest.applicationId)).size).toBe(1)
    const stored = JSON.parse(await readFile(manifestPath(), "utf8"))
    expect(stored).toEqual(results[0]?.manifest)
    expect((await readdir(root)).filter((name) => name.startsWith(".crit-manifest-"))).toEqual([])
  })

  it.each([
    ["non-JSON", "not json"],
    ["legacy version", JSON.stringify({ schemaVersion: 1, applicationId: "application_legacy" })],
    ["excess property", JSON.stringify({ schemaVersion: 2, applicationId: "application_valid", extra: true })]
  ] as const)("rejects invalid existing bytes without overwriting them: %s", async(_label, source) => {
    await writeFile(manifestPath(), source)
    const result = await run(Effect.gen(function*() {
      const manifest = yield* LocalProjectManifest
      return yield* manifest.initialize.pipe(Effect.result)
    }))
    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(Predicate.isTagged(result.failure, "ProjectManifestInvalid")).toBe(true)
      if (Predicate.isTagged(result.failure, "ProjectManifestInvalid") && "reason" in result.failure) {
        expect(result.failure.reason).toBe("Manifest does not match schema version 2")
        expect(result.failure.reason).not.toContain(source)
      }
    }
    expect(await readFile(manifestPath(), "utf8")).toBe(source)
  })

  it("rejects a non-regular target without replacing it", async() => {
    await mkdir(manifestPath())
    const result = await run(Effect.gen(function*() {
      const manifest = yield* LocalProjectManifest
      return yield* manifest.initialize.pipe(Effect.result)
    }))
    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(Predicate.isTagged(result.failure, "ProjectManifestInvalid")).toBe(true)
      if (Predicate.isTagged(result.failure, "ProjectManifestInvalid") && "reason" in result.failure) {
        expect(result.failure.reason).toBe("Manifest target must be a regular file")
      }
    }
    expect((await readdir(root))).toContain(critProjectManifestFile)
  })

  it("rejects a stable symbolic-link target without following it", async() => {
    const source = path.join(root, "elsewhere.json")
    await writeFile(source, JSON.stringify({
      schemaVersion: 2,
      applicationId: "application_elsewhere"
    }))
    await symlink(source, manifestPath())
    const result = await run(Effect.gen(function*() {
      const manifest = yield* LocalProjectManifest
      return yield* manifest.initialize.pipe(Effect.result)
    }))
    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(Predicate.isTagged(result.failure, "ProjectManifestInvalid")).toBe(true)
      if (Predicate.isTagged(result.failure, "ProjectManifestInvalid") && "reason" in result.failure) {
        expect(result.failure.reason).toBe("Manifest target must be a regular file")
      }
    }
    expect((await lstat(manifestPath())).isSymbolicLink()).toBe(true)
  })

  it("preserves a staging file it did not create", async() => {
    const uuid = "00000000-0000-4000-8000-000000000000"
    const stagingPath = path.join(root, `.crit-manifest-${uuid}.tmp`)
    const existing = Uint8Array.from([9, 2, 6, 5])
    await writeFile(stagingPath, existing)
    const testCrypto = Layer.succeed(Crypto.Crypto, Crypto.make({
      randomBytes: (size) => new Uint8Array(size),
      digest: (_algorithm, data) => Effect.succeed(data)
    }))
    const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, testCrypto)
    const result = await Effect.runPromise(Effect.gen(function*() {
      const manifest = yield* LocalProjectManifest
      return yield* manifest.initialize.pipe(Effect.result)
    }).pipe(
      Effect.provide(LocalProjectManifest.layer({ root })),
      Effect.provide(platform)
    ))
    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(Predicate.isTagged(result.failure, "ProjectManifestIoFailure")).toBe(true)
      if (
        Predicate.isTagged(result.failure, "ProjectManifestIoFailure") &&
        "operation" in result.failure &&
        "reason" in result.failure
      ) {
        expect(result.failure.operation).toBe("stage")
        expect(result.failure.reason).toBe("AlreadyExists")
      }
    }
    expect([...await readFile(stagingPath)]).toEqual([...existing])
  })

  it("rejects oversized manifest bytes without replacing them", async() => {
    const oversized = " ".repeat(1_025)
    await writeFile(manifestPath(), oversized)
    const result = await run(Effect.gen(function*() {
      const manifest = yield* LocalProjectManifest
      return yield* manifest.initialize.pipe(Effect.result)
    }))
    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(Predicate.isTagged(result.failure, "ProjectManifestInvalid")).toBe(true)
      if (Predicate.isTagged(result.failure, "ProjectManifestInvalid") && "reason" in result.failure) {
        expect(result.failure.reason).toBe("Manifest exceeds the 1024-byte limit")
      }
    }
    expect(await readFile(manifestPath(), "utf8")).toBe(oversized)
  })

  it("fills one bounded buffer across short reads without a path read", async() => {
    const stored = JSON.stringify({
      schemaVersion: 2,
      applicationId: "application_short_reads"
    })
    await writeFile(manifestPath(), stored)
    const requested: Array<number> = []
    let pathReads = 0
    const boundedFileSystem = Layer.effect(FileSystem.FileSystem, Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      return FileSystem.make({
        ...fs,
        readFile: (target) => {
          pathReads += 1
          return fs.readFile(target)
        },
        open: (target, options) => fs.open(target, options).pipe(Effect.map((file): FileSystem.File => ({
          [FileSystem.FileTypeId]: FileSystem.FileTypeId,
          stat: file.stat,
          sync: file.sync,
          seek: (offset, from) => file.seek(offset, from),
          read: (buffer) => {
            requested.push(buffer.length)
            return file.read(buffer.subarray(0, Math.min(3, buffer.length)))
          },
          readAlloc: (size) => file.readAlloc(size),
          truncate: (length) => file.truncate(length),
          write: (buffer) => file.write(buffer),
          writeAll: (buffer) => file.writeAll(buffer)
        })))
      })
    })).pipe(Layer.provide(NodeFileSystem.layer))
    const platform = Layer.mergeAll(boundedFileSystem, NodePath.layer, NodeCrypto.layer)
    const result = await Effect.runPromise(Effect.gen(function*() {
      const manifest = yield* LocalProjectManifest
      return yield* manifest.initialize.pipe(Effect.result)
    }).pipe(
      Effect.provide(LocalProjectManifest.layer({ root })),
      Effect.provide(platform)
    ))
    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isSuccess(result)) {
      expect(Predicate.isTagged(result.success, "unchanged")).toBe(true)
      expect(result.success.manifest.applicationId).toBe("application_short_reads")
    }
    expect(requested.length).toBeGreaterThan(1)
    expect(requested[0]).toBe(1_025)
    expect(requested.every((capacity) => capacity <= 1_025)).toBe(true)
    expect(pathReads).toBe(0)
    expect(await readFile(manifestPath(), "utf8")).toBe(stored)
  })

  it("rejects a stable FIFO path before opening it", async() => {
    await writeFile(manifestPath(), JSON.stringify({
      schemaVersion: 2,
      applicationId: "application_fifo"
    }))
    let opens = 0
    const fifoFileSystem = Layer.effect(FileSystem.FileSystem, Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      return FileSystem.make({
        ...fs,
        stat: (target) => fs.stat(target).pipe(Effect.map((info): FileSystem.File.Info => ({
          ...info,
          type: "FIFO"
        }))),
        open: () => {
          opens += 1
          return Effect.die("FIFO target must not be opened")
        }
      })
    })).pipe(Layer.provide(NodeFileSystem.layer))
    const platform = Layer.mergeAll(fifoFileSystem, NodePath.layer, NodeCrypto.layer)
    const result = await Effect.runPromise(Effect.gen(function*() {
      const manifest = yield* LocalProjectManifest
      return yield* manifest.initialize.pipe(Effect.result)
    }).pipe(
      Effect.provide(LocalProjectManifest.layer({ root })),
      Effect.provide(platform)
    ))
    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(Predicate.isTagged(result.failure, "ProjectManifestInvalid")).toBe(true)
      if (Predicate.isTagged(result.failure, "ProjectManifestInvalid") && "reason" in result.failure) {
        expect(result.failure.reason).toBe("Manifest target must be a regular file")
      }
    }
    expect(opens).toBe(0)
  })
})
