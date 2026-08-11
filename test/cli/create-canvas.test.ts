import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest"
import { Effect, FileSystem, Layer, Path, Sink, Stdio, Terminal } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process"

import { runCrit } from "../../src/cli/command.js"
import { FileSystemCanvasRepository } from "../../src/node/file-system-canvas-repository.js"
import { CanvasRepository } from "../../src/runtime/canvas-repository.js"
import { TEST_AUTHOR, TestAuthorIdentityLayer } from "../support/author-identity.js"

describe("crit create", () => {
  let root = ""
  let stdout: Array<string> = []

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "crit-cli-"))
    stdout = []
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it.effect("creates a Canvas and reports a versioned JSON result", () => {
    const storeLayer = FileSystemCanvasRepository.layer({ root })
    const cliLayer = Layer.mergeAll(
      TestAuthorIdentityLayer,
      FileSystem.layerNoop({}),
      Path.layer,
      Stdio.layerTest({
        stdout: () =>
          Sink.forEach((chunk: string | Uint8Array) =>
            Effect.sync(() => {
              stdout.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk))
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
      storeLayer
    )

    return Effect.gen(function*() {
      yield* runCrit([
        "create",
        "checkout-iterations",
        "--title",
        "Checkout iterations",
        "--json"
      ])

      const store = yield* CanvasRepository
      const persisted = yield* store.load("checkout-iterations")

      expect(JSON.parse(stdout.join(""))).toEqual({
        schemaVersion: 1,
        command: "create",
        canvas: {
          id: "checkout-iterations",
          title: "Checkout iterations",
          revision: 0,
          frameCount: 0,
          noteCount: 0,
          activeCommentCount: 0,
          resolvedCommentCount: 0,
          statuses: {
            inProgress: 0,
            readyForReview: 0,
            approved: 0,
            changesRequested: 0,
            archived: 0
          }
        }
      })
      expect(persisted.id).toBe("checkout-iterations")
      expect(persisted.owner).toEqual(TEST_AUTHOR)
    }).pipe(Effect.provide(cliLayer))
  })
})
