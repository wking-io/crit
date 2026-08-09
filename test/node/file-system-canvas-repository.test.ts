import { mkdtemp, rm } from "node:fs/promises"
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

      expect(failure).toMatchObject({ _tag: "CanvasNotFound", canvasId: "missing" })
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
      const canvas = Canvas.fromDocument(loaded)

      expect(loaded.revision).toBe(2)
      expect(Canvas.listFrames(canvas).map((frame) => frame.id).sort()).toEqual([
        "agent-a",
        "agent-b"
      ])
    }).pipe(Effect.provide(FileSystemCanvasRepository.layer({ root }))))
})
