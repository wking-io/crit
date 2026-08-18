import { IDBFactory } from "fake-indexeddb"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { Canvas, CanvasCommand } from "../../src/core/index.js"
import { BrowserCritClient } from "../../src/browser/browser-crit-client.js"
import { IndexedDbCanvasRepository } from "../../src/browser/indexeddb-canvas-repository.js"

const owner = { id: "git:test", name: "Test Author" }

const emptyDocument = (id: string) =>
  Canvas.export(Canvas.create({ id, title: id, owner }))

describe("IndexedDbCanvasRepository", () => {
  it.effect("seeds a missing Canvas then serializes commands", () => {
    const indexedDB = new IDBFactory()
    const seed = emptyDocument("launch")
    const store = IndexedDbCanvasRepository.make({
      indexedDB,
      databaseName: "crit-www-repository",
      seed: [seed]
    })

    return Effect.gen(function*() {
      const loaded = yield* store.load("launch")
      expect(loaded.id).toBe("launch")
      expect(loaded.revision).toBe(0)

      yield* store.apply("launch", [
        CanvasCommand.addFrame({
          id: "hero",
          url: "/hero",
          title: "Hero",
          provenance: { kind: "manual", sourceId: "hero" }
        })
      ])
      const next = yield* store.load("launch")
      expect(next.revision).toBe(1)
      expect(next.frames.map((frame) => frame.id)).toEqual(["hero"])

      const missing = yield* Effect.flip(store.load("missing"))
      expect(missing).toMatchObject({ _tag: "CritClientNotFound", id: "missing" })
    })
  })
})

describe("BrowserCritClient", () => {
  it.effect("opens as a Guest Session until Sign-in supplies a Current Author", () => {
    const indexedDB = new IDBFactory()
    const guest = BrowserCritClient.make({
      author: null,
      indexedDB,
      databaseName: "crit-www-guest",
      seed: [emptyDocument("launch")]
    })
    const signedIn = BrowserCritClient.make({
      author: { id: "signed-in:ada@example.com", name: "Ada Lovelace" },
      indexedDB,
      databaseName: "crit-www-guest",
      seed: [emptyDocument("launch")]
    })

    return Effect.gen(function*() {
      const unsigned = yield* Effect.flip(guest.client.currentAuthor())
      expect(unsigned).toMatchObject({
        _tag: "CritClientUnavailable",
        operation: "current-author"
      })
      expect(yield* signedIn.client.currentAuthor()).toEqual({
        id: "signed-in:ada@example.com",
        name: "Ada Lovelace"
      })
      expect(guest.snapshots).toBeNull()
      expect(guest.activity).toBeNull()
    })
  })
})
