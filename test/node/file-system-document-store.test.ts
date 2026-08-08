import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { Canvas } from "../../src/core/index.js"
import { DocumentStore } from "../../src/runtime/document-store.js"
import { FileSystemDocumentStore } from "../../src/node/file-system-document-store.js"

describe("FileSystemDocumentStore", () => {
  let root = ""

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "crit-document-store-"))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it.effect("preserves the winner when a stale writer attempts to save", () =>
    Effect.gen(function*() {
      const store = yield* DocumentStore
      const initial = Canvas.export(
        Canvas.create({ id: "checkout-iterations", title: "Checkout iterations" })
      )

      yield* store.create(initial)
      const saved = yield* store.save(initial, { expectedRevision: 0 })
      const staleFailure = yield* Effect.flip(
        store.save(initial, { expectedRevision: 0 })
      )
      const loaded = yield* store.load("checkout-iterations")

      expect(saved.revision).toBe(1)
      expect(staleFailure).toMatchObject({
        _tag: "DocumentConflict",
        id: "checkout-iterations",
        expectedRevision: 0,
        currentRevision: 1
      })
      expect(loaded).toEqual(saved)
    }).pipe(Effect.provide(FileSystemDocumentStore.layer({ root }))))
})

