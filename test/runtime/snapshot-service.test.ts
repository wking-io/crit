import { existsSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"

import { Canvas, CanvasCommand } from "../../src/core/index.js"
import { FileSystemCanvasRepository } from "../../src/node/file-system-canvas-repository.js"
import { FileSystemSnapshotArchive } from "../../src/node/file-system-snapshot-archive.js"
import { CanvasRepository } from "../../src/runtime/canvas-repository.js"
import {
  SnapshotArchive,
  SnapshotNotFound,
  type SnapshotArchiveShape
} from "../../src/runtime/snapshot-archive.js"
import {
  SnapshotService,
  SnapshotServiceLive
} from "../../src/runtime/snapshot-service.js"

describe("SnapshotService", () => {
  let root = ""

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "crit-snapshot-service-"))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it.effect("captures a live Frame and commits its archived Frame", () => {
    const repositoryLayer = FileSystemCanvasRepository.layer({ root })
    const archive: SnapshotArchiveShape = {
      capture: (sourceUrl) =>
        Effect.succeed({
          artifactId: "20260808120000-deadbeef",
          sourceUrl,
          capturedAt: "2026-08-08T12:00:00.000Z",
          sizeBytes: 512
        }),
      read: (artifactId) =>
        artifactId === "20260808120000-deadbeef"
          ? Effect.succeed(new TextEncoder().encode("<!doctype html>"))
          : Effect.fail(new SnapshotNotFound({ artifactId })),
      remove: () => Effect.void
    }
    const snapshotLayer = SnapshotServiceLive.pipe(
      Layer.provide(repositoryLayer),
      Layer.provide(Layer.succeed(SnapshotArchive, archive))
    )

    return Effect.gen(function*() {
      const repository = yield* CanvasRepository
      const snapshots = yield* SnapshotService
      const canvas = Canvas.create({ id: "review", title: "Review" })
      yield* Canvas.apply(
        canvas,
        CanvasCommand.addFrame({
          id: "candidate",
          url: "https://app.localhost/candidate",
          title: "Candidate",
          provenance: { kind: "agent", sourceId: "codex" }
        })
      )
      yield* repository.create(Canvas.export(canvas))

      const saved = yield* snapshots.snapshotFrame("review", "candidate")
      const artifact = yield* snapshots.readArtifact("20260808120000-deadbeef")

      expect(saved.revision).toBe(1)
      expect(saved.frames).toMatchObject([
        { id: "candidate" },
        {
          id: "snapshot-20260808120000-deadbeef",
          status: "archived",
          snapshot: { sourceUrl: "https://app.localhost/candidate" }
        }
      ])
      expect(new TextDecoder().decode(artifact)).toBe("<!doctype html>")
    }).pipe(
      Effect.provide(Layer.merge(repositoryLayer, snapshotLayer))
    )
  })

  it.effect("removes the captured artifact when the commit is rejected", () => {
    const repositoryLayer = FileSystemCanvasRepository.layer({ root })
    const artifactFile = () =>
      path.join(root, ".crit/snapshots", "20260808120000-cafebabe.html")
    const fixtureFetch: typeof fetch = () =>
      Promise.resolve(
        new Response(
          "<!doctype html><html><head></head><body>Fixture</body></html>",
          { headers: { "Content-Type": "text/html" } }
        )
      )
    let artifactOnDiskDuringCommit = false
    // A real archive captures to disk; the Frame's URL changes between capture
    // and commit, so the AddSnapshotFrame command is rejected with
    // snapshot-source-changed.
    const archiveLayer = Layer.effect(
      SnapshotArchive,
      Effect.gen(function*() {
        const repository = yield* CanvasRepository
        const archive = FileSystemSnapshotArchive.make({
          root,
          fetch: fixtureFetch,
          createId: () => "20260808120000-cafebabe",
          now: () => new Date("2026-08-08T12:00:00.000Z")
        })
        return {
          ...archive,
          capture: (sourceUrl) =>
            archive.capture(sourceUrl).pipe(
              Effect.tap(() =>
                Effect.gen(function*() {
                  artifactOnDiskDuringCommit = existsSync(artifactFile())
                  yield* repository.apply("review", [
                    CanvasCommand.updateFrame({
                      id: "candidate",
                      changes: { url: "https://app.localhost/moved" }
                    })
                  ]).pipe(Effect.orDie)
                })
              )
            )
        } satisfies SnapshotArchiveShape
      })
    ).pipe(Layer.provide(repositoryLayer))
    const snapshotLayer = SnapshotServiceLive.pipe(
      Layer.provide(repositoryLayer),
      Layer.provide(archiveLayer)
    )

    return Effect.gen(function*() {
      const repository = yield* CanvasRepository
      const snapshots = yield* SnapshotService
      const canvas = Canvas.create({ id: "review", title: "Review" })
      yield* Canvas.apply(
        canvas,
        CanvasCommand.addFrame({
          id: "candidate",
          url: "https://app.localhost/candidate",
          title: "Candidate",
          provenance: { kind: "agent", sourceId: "codex" }
        })
      )
      yield* repository.create(Canvas.export(canvas))

      const failure = yield* Effect.flip(
        snapshots.snapshotFrame("review", "candidate")
      )

      expect(failure).toMatchObject({
        _tag: "CanvasCommandFailed",
        reason: "snapshot-source-changed"
      })
      expect(artifactOnDiskDuringCommit).toBe(true)
      expect(existsSync(artifactFile())).toBe(false)
    }).pipe(Effect.provide(Layer.merge(repositoryLayer, snapshotLayer)))
  })
})
