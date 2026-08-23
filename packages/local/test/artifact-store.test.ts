import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { ArtifactRepresentation, HttpUrl, Id, Sha256Digest } from "@crit/domain"
import {
  ApplicationBaseUrl,
  ApplicationBindings,
  ArtifactStore
} from "@crit/representations"
import {
  artifactStoreConformanceScenarios,
  runRepresentationRuntimeConformance
} from "@crit/representations/testing"
import { Effect, Layer, Option, Schema } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { LocalArtifactStore } from "../src/artifact-store.js"

let directory = ""

beforeEach(async() => {
  directory = await mkdtemp(path.join(tmpdir(), "crit-artifacts-"))
})

afterEach(async() => {
  await rm(directory, { recursive: true, force: true })
})

const run = <A, E>(effect: Effect.Effect<A, E, ArtifactStore>) => Effect.runPromise(
  effect.pipe(Effect.provide(LocalArtifactStore.layer({ directory })))
)

const put = (artifactId: ReturnType<typeof Id.artifact>, bytes: Uint8Array) => Effect.gen(function*() {
  const store = yield* ArtifactStore
  return yield* store.put({ artifactId, bytes })
})

const storeRoot = () => path.join(directory, ".crit-artifact-store")
const artifactsDirectory = () => path.join(storeRoot(), "artifacts")
const stagingDirectory = () => path.join(storeRoot(), "staging")

for (const scenario of artifactStoreConformanceScenarios()) {
  it(`conforms when it ${scenario.name}`, async() => {
    await run(scenario.run)
  })
}

it("resolves representations through the real local artifact store", async() => {
  const applicationId = Id.application("application_local_conformance")
  const baseUrl = Schema.decodeUnknownSync(ApplicationBaseUrl)("http://localhost:5173/")
  const bindings = Layer.succeed(ApplicationBindings, ApplicationBindings.of({
    get: (requestedId) => Effect.succeed(
      requestedId === applicationId ? Option.some(baseUrl) : Option.none()
    )
  }))
  await Effect.runPromise(runRepresentationRuntimeConformance({
    artifactStoreLayer: LocalArtifactStore.layer({ directory }),
    applicationBindingsLayer: bindings,
    expected: {
      applicationId,
      baseUrl,
      renderedUrl: Schema.decodeUnknownSync(HttpUrl)(
        "http://localhost:5173/products/%E2%9C%93?view=grid"
      )
    }
  }))
})

describe("LocalArtifactStore", () => {
  it("persists across layer restarts and rejects a later conflict", async() => {
    const artifactId = Id.artifact("artifact_restart")
    const stored = await run(put(artifactId, Uint8Array.from([1, 3, 5])))
    const loaded = await run(Effect.gen(function*() {
      const store = yield* ArtifactStore
      return yield* store.read(stored)
    }))
    expect([...loaded]).toEqual([1, 3, 5])
    const conflict = await run(put(artifactId, Uint8Array.from([5, 3, 1])).pipe(Effect.result))
    expect(conflict._tag).toBe("Failure")
    if (conflict._tag === "Failure") expect(conflict.failure._tag).toBe("ArtifactConflict")
  })

  it("owns input bytes when put is called", async() => {
    const artifactId = Id.artifact("artifact_lazy_ownership")
    const input = Uint8Array.from([1, 2, 3])
    const stored = await run(Effect.gen(function*() {
      const store = yield* ArtifactStore
      const pending = store.put({ artifactId, bytes: input })
      input[0] = 9
      return yield* pending
    }))
    const loaded = await run(Effect.gen(function*() {
      const store = yield* ArtifactStore
      return yield* store.read(stored)
    }))
    expect([...loaded]).toEqual([1, 2, 3])
  })

  it("computes the known SHA-256 digest for abc", async() => {
    const stored = await run(put(
      Id.artifact("artifact_known_digest"),
      new TextEncoder().encode("abc")
    ))
    expect(stored.digest).toBe("sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
  })

  it("converges identical publications from independent layers", async() => {
    const artifactId = Id.artifact("artifact_concurrent_identical")
    const representations = await Promise.all(Array.from({ length: 16 }, () =>
      run(put(artifactId, Uint8Array.from([2, 4, 6])))))
    expect(new Set(representations.map((artifact) => artifact.digest)).size).toBe(1)
    expect(await readdir(stagingDirectory())).toEqual([])
  })

  it("preserves one winner across conflicting independent layers", async() => {
    const artifactId = Id.artifact("artifact_concurrent_conflict")
    const results = await Promise.all([
      run(put(artifactId, Uint8Array.from([1])).pipe(Effect.result)),
      run(put(artifactId, Uint8Array.from([2])).pipe(Effect.result))
    ])
    const successes = results.filter((result) => result._tag === "Success")
    const failures = results.filter((result) => result._tag === "Failure")
    expect(successes).toHaveLength(1)
    expect(failures).toHaveLength(1)
    expect(failures[0]?.failure._tag).toBe("ArtifactConflict")
    const winner = successes[0]?.success
    if (winner === undefined) throw new Error("concurrent publication did not produce a winner")
    const loaded = await run(Effect.gen(function*() {
      const store = yield* ArtifactStore
      return yield* store.read(winner)
    }))
    expect([[1], [2]]).toContainEqual([...loaded])
  })

  it("reports corruption without changing the file", async() => {
    const artifactId = Id.artifact("artifact_corrupt")
    const stored = await run(put(artifactId, Uint8Array.from([3, 3, 3])))
    const storedPath = path.join(artifactsDirectory(), artifactId)
    await writeFile(storedPath, Uint8Array.from([4, 4, 4]))
    const result = await run(Effect.gen(function*() {
      const store = yield* ArtifactStore
      return yield* store.read(stored).pipe(Effect.result)
    }))
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") expect(result.failure._tag).toBe("ArtifactCorrupt")
    expect([...await readFile(storedPath)]).toEqual([4, 4, 4])
  })

  it("does not reclaim unknown staging entries during acquisition", async() => {
    await mkdir(stagingDirectory(), { recursive: true })
    const unknown = path.join(stagingDirectory(), "unknown-owner")
    await writeFile(unknown, Uint8Array.from([9]))
    await run(put(Id.artifact("artifact_unknown_staging"), Uint8Array.from([5])))
    expect([...await readFile(unknown)]).toEqual([9])
  })

  it("rejects a non-directory store root", async() => {
    await writeFile(storeRoot(), Uint8Array.from([1]))
    const result = await Effect.runPromise(Effect.gen(function*() {
      yield* ArtifactStore
    }).pipe(
      Effect.provide(LocalArtifactStore.layer({ directory })),
      Effect.result
    ))
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("FileSystemArtifactStoreOpenFailure")
      expect(result.failure.reason).toBe("BadResource")
    }
  })

  it("cleans its staging file when publication fails", async() => {
    await run(put(Id.artifact("artifact_initialize_cleanup"), Uint8Array.from([0])))
    const artifactId = Id.artifact("artifact_publication_failure")
    await mkdir(path.join(artifactsDirectory(), artifactId))
    const result = await run(put(artifactId, Uint8Array.from([7])).pipe(Effect.result))
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("ArtifactStoreIoFailure")
      expect(result.failure.reason).toBe("BadResource")
    }
    expect(await readdir(stagingDirectory())).toEqual([])
  })

  it("reports a missing artifact with its authoritative identity", async() => {
    const artifact = ArtifactRepresentation.make({
      artifactId: Id.artifact("artifact_missing"),
      digest: Schema.decodeUnknownSync(Sha256Digest)(`sha256:${"0".repeat(64)}`)
    })
    const result = await run(Effect.gen(function*() {
      const store = yield* ArtifactStore
      return yield* store.read(artifact).pipe(Effect.result)
    }))
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("ArtifactNotFound")
      if (result.failure._tag === "ArtifactNotFound") expect(result.failure.artifact).toEqual(artifact)
    }
  })
})
