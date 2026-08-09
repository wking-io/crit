import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"

import { Canvas, CanvasCommand } from "../../src/core/index.js"
import { FileSystemCanvasRepository } from "../../src/node/file-system-canvas-repository.js"
import { CritRuntime, CritRuntimeLive } from "../../src/runtime/crit-runtime.js"

describe("CritRuntime.updateCanvas", () => {
  let root = ""

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "crit-runtime-"))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it.effect("persists semantic command batches against the latest local revision", () => {
    const storeLayer = FileSystemCanvasRepository.layer({ root })
    const runtimeLayer = CritRuntimeLive.pipe(Layer.provide(storeLayer))

    return Effect.gen(function*() {
      const runtime = yield* CritRuntime
      yield* runtime.createCanvas({ id: "review", title: "Review" })

      const mutation = yield* runtime.updateCanvas({
        id: "review",
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
      const rebased = yield* runtime.updateCanvas({
          id: "review",
          commands: [
            CanvasCommand.updateFrame({
              id: "checkout-v1",
              changes: { status: "approved" }
            })
          ]
        })
      const afterStaleWrite = yield* runtime.readCanvas("review")

      expect(mutation).toEqual({
        revision: 1,
        change: {
          commandCount: 2,
          changedFrameIds: ["checkout-v1"],
          changedNoteIds: []
        },
        canvas: {
          id: "review",
          title: "Review",
          revision: 1,
          frameCount: 1,
          noteCount: 0,
          statuses: {
            inProgress: 1,
            readyForReview: 0,
            approved: 0,
            changesRequested: 0,
            archived: 0
          }
        }
      })
      expect(Canvas.listFrames(opened)[0]?.geometry).toEqual({
        x: 300,
        y: 180,
        width: 1200,
        height: 800
      })
      expect(rebased).toMatchObject({ revision: 2 })
      expect(afterStaleWrite.frames[0]?.status).toBe("approved")
    }).pipe(Effect.provide(runtimeLayer))
  })

  it.effect("does not persist failed or empty command batches", () => {
    const storeLayer = FileSystemCanvasRepository.layer({ root })
    const runtimeLayer = CritRuntimeLive.pipe(Layer.provide(storeLayer))

    return Effect.gen(function*() {
      const runtime = yield* CritRuntime
      yield* runtime.createCanvas({ id: "review", title: "Review" })

      const commandFailure = yield* Effect.flip(
        runtime.updateCanvas({
          id: "review",
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
          commands: []
        })
      )
      const persisted = yield* runtime.readCanvas("review")
      const opened = yield* Canvas.open(persisted)

      expect(commandFailure).toMatchObject({
        _tag: "CritClientCommandFailed",
        id: "review",
        reason: "frame-not-found"
      })
      expect(emptyFailure).toMatchObject({
        _tag: "CritClientCommandFailed",
        id: "review",
        reason: "invalid-command"
      })
      expect(persisted.revision).toBe(0)
      expect(Canvas.listFrames(opened)).toEqual([])
    }).pipe(Effect.provide(runtimeLayer))
  })
})
