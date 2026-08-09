import { spawnSync } from "node:child_process"
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { Canvas, CanvasCommand } from "../../src/core/index.js"
import { CanvasRepository } from "../../src/runtime/canvas-repository.js"
import { FileSystemCanvasRepository } from "../../src/node/file-system-canvas-repository.js"

describe("FileSystemCanvasRepository", () => {
  let root = ""

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "crit-canvas-repository-"))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it.effect("reports missing Canvases before attempting to lock them", () =>
    Effect.gen(function*() {
      const store = yield* CanvasRepository
      const failure = yield* Effect.flip(
        store.apply("missing", [
          CanvasCommand.addNote({ id: "note", text: "", x: 0, y: 0 })
        ])
      )

      expect(failure).toMatchObject({ _tag: "DocumentNotFound", id: "missing" })
    }).pipe(Effect.provide(FileSystemCanvasRepository.layer({ root }))))

  it.effect("serializes semantic commands from concurrent local writers", () =>
    Effect.gen(function*() {
      const store = yield* CanvasRepository
      const initial = Canvas.export(
        Canvas.create({ id: "checkout-iterations", title: "Checkout iterations" })
      )

      yield* store.create(initial)
      yield* Effect.all(
        [
          store.apply("checkout-iterations", [
            CanvasCommand.addFrame({
              id: "agent-a",
              url: "/a",
              title: "Agent A",
              provenance: { kind: "manual", sourceId: "agent-a" }
            })
          ]),
          store.apply("checkout-iterations", [
            CanvasCommand.addFrame({
              id: "agent-b",
              url: "/b",
              title: "Agent B",
              provenance: { kind: "manual", sourceId: "agent-b" }
            })
          ])
        ],
        { concurrency: "unbounded" }
      )

      const loaded = yield* store.load("checkout-iterations")
      const canvas = yield* Canvas.open(loaded)

      expect(loaded.revision).toBe(2)
      expect(Canvas.listFrames(canvas).map((frame) => frame.id).sort()).toEqual([
        "agent-a",
        "agent-b"
      ])
    }).pipe(Effect.provide(FileSystemCanvasRepository.layer({ root }))))

  it.effect("steals a lock whose owning process is dead", () =>
    Effect.gen(function*() {
      const store = yield* CanvasRepository
      yield* store.create(
        Canvas.export(Canvas.create({ id: "wedged", title: "Wedged" }))
      )

      // A short-lived child process yields a PID that is guaranteed dead.
      const child = spawnSync(process.execPath, ["-e", ""])
      const lock = path.join(root, ".crit", "canvases", "wedged.json.lock")
      yield* Effect.promise(() => writeFile(lock, `${child.pid}\n`, { mode: 0o600 }))

      const { document } = yield* store.apply("wedged", [
        CanvasCommand.addNote({ id: "note", text: "", x: 0, y: 0, width: 200, height: 120 })
      ])

      expect(document.revision).toBe(1)
    }).pipe(Effect.provide(FileSystemCanvasRepository.layer({ root }))))

  it.effect("steals a lock without a readable PID once its TTL expires", () =>
    Effect.gen(function*() {
      const store = yield* CanvasRepository
      yield* store.create(
        Canvas.export(Canvas.create({ id: "abandoned", title: "Abandoned" }))
      )

      const lock = path.join(root, ".crit", "canvases", "abandoned.json.lock")
      yield* Effect.promise(async () => {
        await writeFile(lock, "", { mode: 0o600 })
        const past = new Date(Date.now() - 10 * 60_000)
        await utimes(lock, past, past)
      })

      const { document } = yield* store.apply("abandoned", [
        CanvasCommand.addNote({ id: "note", text: "", x: 0, y: 0, width: 200, height: 120 })
      ])

      expect(document.revision).toBe(1)
    }).pipe(Effect.provide(FileSystemCanvasRepository.layer({ root }))))
})
