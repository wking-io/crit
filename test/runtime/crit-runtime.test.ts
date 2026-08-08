import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"

import { Canvas, CanvasCommand } from "../../src/core/index.js"
import { FileSystemDocumentStore } from "../../src/node/file-system-document-store.js"
import { CritRuntime, CritRuntimeLive } from "../../src/runtime/crit-runtime.js"

describe("CritRuntime.updateCanvas", () => {
  let root = ""

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "crit-runtime-"))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it.effect("persists a semantic command batch once and rejects a stale writer", () => {
    const storeLayer = FileSystemDocumentStore.layer({ root })
    const runtimeLayer = CritRuntimeLive.pipe(Layer.provide(storeLayer))

    return Effect.gen(function*() {
      const runtime = yield* CritRuntime
      yield* runtime.createCanvas({ id: "review", title: "Review" })

      const mutation = yield* runtime.updateCanvas({
        id: "review",
        expectedRevision: 0,
        commands: [
          CanvasCommand.addFrame({
            id: "checkout-v1",
            url: "https://checkout.localhost/v1",
            title: "Checkout v1",
            provenance: { kind: "agent", sourceId: "iteration-agent" }
          }),
          CanvasCommand.moveFrame({ id: "checkout-v1", x: 300, y: 180 })
        ]
      })
      const persisted = yield* runtime.readCanvas("review")
      const opened = yield* Canvas.open(persisted)
      const beforeStaleWrite = Canvas.export(opened)

      const staleFailure = yield* Effect.flip(
        runtime.updateCanvas({
          id: "review",
          expectedRevision: 0,
          commands: [
            CanvasCommand.updateFrame({
              id: "checkout-v1",
              changes: { status: "approved" }
            })
          ]
        })
      )
      const afterStaleWrite = yield* runtime.readCanvas("review")

      expect(mutation).toEqual({
        revision: 1,
        change: {
          commandCount: 2,
          changedFrameIds: ["shape:checkout-v1"]
        },
        canvas: {
          id: "review",
          title: "Review",
          revision: 1,
          frameCount: 1,
          statuses: {
            inProgress: 1,
            approved: 0,
            changesRequested: 0
          }
        }
      })
      expect(Canvas.listFrames(opened)[0]?.geometry).toEqual({
        x: 300,
        y: 180,
        width: 1200,
        height: 800
      })
      expect(staleFailure).toMatchObject({
        _tag: "DocumentConflict",
        id: "review",
        expectedRevision: 0,
        currentRevision: 1
      })
      expect(afterStaleWrite).toEqual(beforeStaleWrite)
    }).pipe(Effect.provide(runtimeLayer))
  })

  it.effect("does not persist failed or empty command batches", () => {
    const storeLayer = FileSystemDocumentStore.layer({ root })
    const runtimeLayer = CritRuntimeLive.pipe(Layer.provide(storeLayer))

    return Effect.gen(function*() {
      const runtime = yield* CritRuntime
      yield* runtime.createCanvas({ id: "review", title: "Review" })

      const commandFailure = yield* Effect.flip(
        runtime.updateCanvas({
          id: "review",
          expectedRevision: 0,
          commands: [
            CanvasCommand.addFrame({
              id: "checkout-v1",
              url: "https://checkout.localhost/v1",
              title: "Checkout v1",
              provenance: { kind: "agent", sourceId: "iteration-agent" }
            }),
            CanvasCommand.updateFrame({
              id: "missing-frame",
              changes: { status: "approved" }
            })
          ]
        })
      )
      const emptyFailure = yield* Effect.flip(
        runtime.updateCanvas({
          id: "review",
          expectedRevision: 0,
          commands: []
        })
      )
      const persisted = yield* runtime.readCanvas("review")
      const opened = yield* Canvas.open(persisted)

      expect(commandFailure).toMatchObject({
        _tag: "CanvasCommandFailed",
        reason: "frame-not-found"
      })
      expect(emptyFailure).toMatchObject({
        _tag: "CanvasCommandFailed",
        reason: "invalid-command"
      })
      expect(persisted.revision).toBe(0)
      expect(Canvas.listFrames(opened)).toEqual([])
    }).pipe(Effect.provide(runtimeLayer))
  })
})
