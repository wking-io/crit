import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest"
import { Effect, FileSystem, Layer, Path, Sink, Stdio, Terminal } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process"

import { runCrit } from "../../src/cli/command.js"
import { FileSystemAgentActivity } from "../../src/node/file-system-agent-activity.js"
import { FileSystemCanvasRepository } from "../../src/node/file-system-canvas-repository.js"
import { CritRuntimeLive } from "../../src/runtime/crit-runtime.js"
import { SnapshotArchive } from "../../src/runtime/snapshot-archive.js"
import {
  SnapshotService,
  SnapshotServiceLive
} from "../../src/runtime/snapshot-service.js"

describe("crit Canvas workflows", () => {
  let root = ""
  let stdout: Array<string> = []

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "crit-cli-workflows-"))
    stdout = []
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it.effect("adds URLs, lists Canvases, and opens a semantic Canvas view", () => {
    const storeLayer = FileSystemCanvasRepository.layer({ root })
    const runtimeLayer = CritRuntimeLive.pipe(Layer.provide(storeLayer))
    const activityLayer = FileSystemAgentActivity.layer({ root })
    const snapshotLayer = SnapshotServiceLive.pipe(
      Layer.provide(storeLayer),
      Layer.provide(
        Layer.succeed(SnapshotArchive, {
          capture: (sourceUrl) =>
            Effect.succeed({
              artifactId: "20260808120000-deadbeef",
              sourceUrl,
              capturedAt: "2026-08-08T12:00:00.000Z",
              sizeBytes: 512
            }),
          read: () => Effect.die("unused"),
          remove: () => Effect.void
        })
      )
    )
    const cliLayer = Layer.mergeAll(
      FileSystem.layerNoop({}),
      Path.layer,
      Stdio.layerTest({
        stdout: () =>
          Sink.forEach((chunk: string | Uint8Array) =>
            Effect.sync(() => {
              stdout.push(
                typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk)
              )
            })
          )
      }),
      Layer.succeed(
        Terminal.Terminal,
        Terminal.make({
          columns: Effect.succeed(80),
          rows: Effect.succeed(24),
          readInput: Effect.die("unused"),
          readLine: Effect.die("unused"),
          display: () => Effect.void
        })
      ),
      Layer.succeed(
        ChildProcessSpawner.ChildProcessSpawner,
        ChildProcessSpawner.make(() => Effect.die("unused"))
      ),
      storeLayer,
      runtimeLayer,
      snapshotLayer,
      activityLayer
    )

    return Effect.gen(function*() {
      yield* runCrit(["create", "review", "--title", "Review", "--json"])
      yield* runCrit(["create", "archive", "--title", "Archive", "--json"])
      stdout = []

      yield* runCrit([
        "add",
        "review",
        "checkout.localhost/v1#draft",
        "https://checkout.localhost/v2",
        "--json"
      ])
      const added = JSON.parse(stdout.join(""))
      stdout = []

      yield* runCrit(["list", "--json"])
      const listed = JSON.parse(stdout.join(""))
      stdout = []

      yield* runCrit(["open", "review", "--json"])
      const opened = JSON.parse(stdout.join(""))
      stdout = []

      yield* runCrit([
        "snapshot",
        "review",
        added.frames[0].id,
        "--json"
      ])
      const snapshotted = JSON.parse(stdout.join(""))
      stdout = []

      yield* runCrit([
        "activity",
        "review",
        "--for",
        "120",
        "--detail",
        "Implementing checkout",
        "--json"
      ])
      const activity = JSON.parse(stdout.join(""))

      expect(added).toMatchObject({
        schemaVersion: 1,
        command: "add",
        mutation: {
          revision: 1,
          change: { commandCount: 2 },
          canvas: { id: "review", revision: 1, frameCount: 2, noteCount: 0 }
        }
      })
      expect(added.frames).toHaveLength(2)
      expect(added.frames.map((frame: { url: string }) => frame.url)).toEqual([
        "https://checkout.localhost/v1",
        "https://checkout.localhost/v2"
      ])
      expect(listed).toEqual({
        schemaVersion: 1,
        command: "list",
        canvases: [
          {
            id: "archive",
            title: "Archive",
            revision: 0,
            frameCount: 0,
            noteCount: 0,
            statuses: {
              inProgress: 0,
              readyForReview: 0,
              approved: 0,
              changesRequested: 0,
              archived: 0
            }
          },
          {
            id: "review",
            title: "Review",
            revision: 1,
            frameCount: 2,
            noteCount: 0,
            statuses: {
              inProgress: 2,
              readyForReview: 0,
              approved: 0,
              changesRequested: 0,
              archived: 0
            }
          }
        ]
      })
      expect(opened).toEqual({
        schemaVersion: 1,
        command: "open",
        canvas: added.mutation.canvas,
        frames: added.frames,
        notes: []
      })
      expect(snapshotted).toMatchObject({
        schemaVersion: 1,
        command: "snapshot",
        canvasId: "review",
        frame: {
          id: "snapshot-20260808120000-deadbeef",
          status: "archived",
          provenance: {
            kind: "snapshot",
            sourceId: added.frames[0].id
          },
          snapshot: {
            sourceUrl: "https://checkout.localhost/v1",
            sizeBytes: 512
          }
        }
      })
      expect(activity).toMatchObject({
        schemaVersion: 1,
        command: "activity",
        activity: {
          canvasId: "review",
          active: true,
          detail: "Implementing checkout"
        }
      })
    }).pipe(Effect.provide(cliLayer))
  })

  it.effect("atomically exposes every semantic Frame edit to agents", () => {
    const storeLayer = FileSystemCanvasRepository.layer({ root })
    const runtimeLayer = CritRuntimeLive.pipe(Layer.provide(storeLayer))
    const cliLayer = Layer.mergeAll(
      FileSystem.layerNoop({}),
      Path.layer,
      Stdio.layerTest({
        stdout: () =>
          Sink.forEach((chunk: string | Uint8Array) =>
            Effect.sync(() => {
              stdout.push(
                typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk)
              )
            })
          )
      }),
      Layer.succeed(
        Terminal.Terminal,
        Terminal.make({
          columns: Effect.succeed(80),
          rows: Effect.succeed(24),
          readInput: Effect.die("unused"),
          readLine: Effect.die("unused"),
          display: () => Effect.void
        })
      ),
      Layer.succeed(
        ChildProcessSpawner.ChildProcessSpawner,
        ChildProcessSpawner.make(() => Effect.die("unused"))
      ),
      storeLayer,
      runtimeLayer
    )

    return Effect.gen(function*() {
      yield* runCrit(["create", "review", "--title", "Review", "--json"])
      stdout = []
      const commands = JSON.stringify([
        {
          _tag: "AddFrame",
          id: "candidate",
          url: "https://checkout.localhost/v1",
          title: "Checkout candidate",
          status: "in-progress",
          provenance: { kind: "agent", sourceId: "codex" }
        },
        {
          _tag: "UpdateFrame",
          id: "candidate",
          changes: {
            url: "https://checkout.localhost/v2",
            title: "Checkout candidate v2",
            display: { heightMode: "fit-page" }
          }
        },
        {
          _tag: "SetFrameStatus",
          id: "candidate",
          status: "approved"
        },
        { _tag: "MoveFrame", id: "candidate", x: 120, y: 240 },
        {
          _tag: "ResizeFrame",
          id: "candidate",
          width: 1440,
          height: 900
        },
        {
          _tag: "AddFrame",
          id: "discarded",
          url: "https://checkout.localhost/discarded",
          title: "Discarded",
          status: "changes-requested",
          provenance: { kind: "agent", sourceId: "codex" }
        },
        { _tag: "RemoveFrame", id: "discarded" }
      ])

      yield* runCrit([
        "apply",
        "review",
        commands,
        "--json"
      ])
      const output = JSON.parse(stdout.join(""))

      expect(output).toMatchObject({
        schemaVersion: 1,
        command: "apply",
        mutation: {
          revision: 1,
          change: { commandCount: 7 },
          canvas: {
            id: "review",
            frameCount: 1,
            noteCount: 0,
            statuses: {
              inProgress: 0,
              readyForReview: 0,
              approved: 1,
              changesRequested: 0,
              archived: 0
            }
          }
        },
        frames: [
          {
            id: "candidate",
            url: "https://checkout.localhost/v2",
            title: "Checkout candidate v2",
            status: "approved",
            display: { heightMode: "fit-page" },
            geometry: { x: 120, y: 240, width: 1440, height: 900 }
          }
        ],
        notes: []
      })
    }).pipe(Effect.provide(cliLayer))
  })

  it.effect("rejects AddSnapshotFrame on the public apply surface", () => {
    const storeLayer = FileSystemCanvasRepository.layer({ root })
    const runtimeLayer = CritRuntimeLive.pipe(Layer.provide(storeLayer))
    const cliLayer = Layer.mergeAll(
      FileSystem.layerNoop({}),
      Path.layer,
      Stdio.layerTest({
        stdout: () =>
          Sink.forEach((chunk: string | Uint8Array) =>
            Effect.sync(() => {
              stdout.push(
                typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk)
              )
            })
          )
      }),
      Layer.succeed(
        Terminal.Terminal,
        Terminal.make({
          columns: Effect.succeed(80),
          rows: Effect.succeed(24),
          readInput: Effect.die("unused"),
          readLine: Effect.die("unused"),
          display: () => Effect.void
        })
      ),
      Layer.succeed(
        ChildProcessSpawner.ChildProcessSpawner,
        ChildProcessSpawner.make(() => Effect.die("unused"))
      ),
      storeLayer,
      runtimeLayer
    )

    return Effect.gen(function*() {
      yield* runCrit(["create", "review", "--title", "Review", "--json"])
      stdout = []

      const forged = JSON.stringify([
        {
          _tag: "AddSnapshotFrame",
          id: "snapshot-forged",
          sourceFrameId: "candidate",
          expectedSourceUrl: "https://checkout.localhost/v1",
          url: "/__crit/snapshots/forged",
          artifact: {
            artifactId: "forged",
            sourceUrl: "https://checkout.localhost/v1",
            capturedAt: "2026-01-01T00:00:00.000Z",
            sizeBytes: 1
          }
        }
      ])
      const failure = yield* runCrit(["apply", "review", forged, "--json"]).pipe(
        Effect.flip
      )
      expect(failure).toMatchObject({
        _tag: "InvalidCliInput",
        detail: expect.stringContaining("crit snapshot")
      })
      stdout = []

      yield* runCrit(["open", "review", "--json"])
      const opened = JSON.parse(stdout.join(""))
      expect(opened.canvas).toMatchObject({ revision: 0, frameCount: 0 })
    }).pipe(Effect.provide(cliLayer))
  })

  it.effect(
    "reports the captured snapshot when a concurrent writer appends another Frame",
    () => {
      const storeLayer = FileSystemCanvasRepository.layer({ root })
      const runtimeLayer = CritRuntimeLive.pipe(Layer.provide(storeLayer))
      const cliLayer = Layer.mergeAll(
        FileSystem.layerNoop({}),
        Path.layer,
        Stdio.layerTest({
          stdout: () =>
            Sink.forEach((chunk: string | Uint8Array) =>
              Effect.sync(() => {
                stdout.push(
                  typeof chunk === "string"
                    ? chunk
                    : new TextDecoder().decode(chunk)
                )
              })
            )
        }),
        Layer.succeed(
          Terminal.Terminal,
          Terminal.make({
            columns: Effect.succeed(80),
            rows: Effect.succeed(24),
            readInput: Effect.die("unused"),
            readLine: Effect.die("unused"),
            display: () => Effect.void
          })
        ),
        Layer.succeed(
          ChildProcessSpawner.ChildProcessSpawner,
          ChildProcessSpawner.make(() => Effect.die("unused"))
        ),
        storeLayer,
        runtimeLayer,
        Layer.succeed(SnapshotService, {
          snapshotFrame: () =>
            Effect.succeed({
              format: "crit-canvas" as const,
              version: 1 as const,
              id: "review",
              title: "Review",
              revision: 3,
              frames: [
                {
                  id: "candidate",
                  url: "https://checkout.localhost/v1",
                  title: "Checkout candidate",
                  status: "in-progress" as const,
                  provenance: { kind: "agent" as const, sourceId: "codex" },
                  geometry: { x: 0, y: 0, width: 1440, height: 900 },
                  display: { heightMode: "viewport" as const },
                  zIndex: 0
                },
                {
                  id: "snapshot-20260808120000-deadbeef",
                  url: "/__crit/snapshots/20260808120000-deadbeef",
                  title: "Checkout candidate snapshot",
                  status: "archived" as const,
                  provenance: {
                    kind: "snapshot" as const,
                    sourceId: "candidate"
                  },
                  geometry: { x: 1488, y: 0, width: 1440, height: 900 },
                  display: { heightMode: "viewport" as const },
                  zIndex: 1,
                  snapshot: {
                    artifactId: "20260808120000-deadbeef",
                    sourceUrl: "https://checkout.localhost/v1",
                    capturedAt: "2026-08-08T12:00:00.000Z",
                    sizeBytes: 512
                  }
                },
                {
                  id: "concurrent",
                  url: "https://checkout.localhost/concurrent",
                  title: "Concurrent Frame",
                  status: "in-progress" as const,
                  provenance: {
                    kind: "agent" as const,
                    sourceId: "other-agent"
                  },
                  geometry: { x: 2976, y: 0, width: 1440, height: 900 },
                  display: { heightMode: "viewport" as const },
                  zIndex: 2
                }
              ],
              notes: []
            }),
          readArtifact: () => Effect.die("unused")
        })
      )

      return Effect.gen(function*() {
        yield* runCrit(["snapshot", "review", "candidate", "--json"])
        const output = JSON.parse(stdout.join(""))

        expect(output).toMatchObject({
          command: "snapshot",
          canvasId: "review",
          frame: {
            id: "snapshot-20260808120000-deadbeef",
            provenance: { kind: "snapshot", sourceId: "candidate" }
          }
        })
      }).pipe(Effect.provide(cliLayer))
    }
  )
})
