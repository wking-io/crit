import { IDBFactory } from "fake-indexeddb"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Option } from "effect"

import { IndexedDbDraftJournal } from "../../src/browser/indexeddb-draft-journal.js"
import {
  DraftJournal,
  DraftJournalFailed,
  type CanvasDraft
} from "../../src/session/draft-journal.js"

const draft = (
  sessionId: string,
  mutation: number,
  baseRevision = 0
): CanvasDraft => ({
  schemaVersion: 1,
  canvasId: "review",
  sessionId,
  baseRevision,
  mutation,
  commands: []
})

const putRawRecord = (
  indexedDB: IDBFactory,
  databaseName: string,
  value: unknown
) =>
  Effect.promise(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(databaseName, 1)
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const database = open.result
          const transaction = database.transaction("drafts", "readwrite")
          transaction.objectStore("drafts").put(value)
          transaction.oncomplete = () => {
            database.close()
            resolve()
          }
          transaction.onerror = () => reject(transaction.error)
        }
      })
  )

describe("IndexedDbDraftJournal", () => {
  it.effect("isolates sessions and conditionally clears only acknowledged mutations", () => {
    const layer = IndexedDbDraftJournal.layer({
      indexedDB: new IDBFactory(),
      databaseName: "crit-draft-journal-contract"
    })

    return Effect.gen(function*() {
      const journal = yield* DraftJournal
      const first = draft("session-a", 1)
      const newer = draft("session-a", 2)

      yield* journal.save(newer)
      yield* journal.save(first)

      expect(yield* journal.load("review", "session-a")).toEqual(
        Option.some(newer)
      )
      expect(yield* journal.load("review", "session-b")).toEqual(Option.none())

      yield* journal.clear("review", "session-a", 1)
      expect(yield* journal.load("review", "session-a")).toEqual(
        Option.some(newer)
      )

      yield* journal.clear("review", "session-a", 2)
      expect(yield* journal.load("review", "session-a")).toEqual(Option.none())
    }).pipe(Effect.provide(layer))
  })

  it.effect("reports IndexedDB unavailability as a typed journal failure", () =>
    Effect.gen(function*() {
      const journal = yield* DraftJournal
      const failure = yield* Effect.flip(journal.load("review", "session-a"))

      expect(failure).toBeInstanceOf(DraftJournalFailed)
      expect(failure).toMatchObject({
        operation: "load",
        canvasId: "review"
      })
    }).pipe(
      Effect.provide(
        IndexedDbDraftJournal.layer({
          databaseName: "crit-draft-journal-unavailable"
        })
      )
    ))

  it.effect("rejects malformed persisted drafts through the public Schema", () => {
    const indexedDB = new IDBFactory()
    const databaseName = "crit-draft-journal-malformed"
    const layer = IndexedDbDraftJournal.layer({ indexedDB, databaseName })

    return Effect.gen(function*() {
      const journal = yield* DraftJournal
      yield* journal.save(draft("session-a", 1))
      yield* putRawRecord(indexedDB, databaseName, {
        key: "review\u0000session-a",
        draft: { schemaVersion: 999 }
      })

      const failure = yield* Effect.flip(journal.load("review", "session-a"))

      expect(failure).toBeInstanceOf(DraftJournalFailed)
      expect(failure.operation).toBe("load")
      expect(failure.detail).toContain("schemaVersion")
    }).pipe(Effect.provide(layer))
  })

  it.effect("rejects a malformed persisted record envelope", () => {
    const indexedDB = new IDBFactory()
    const databaseName = "crit-draft-journal-malformed-envelope"
    const layer = IndexedDbDraftJournal.layer({ indexedDB, databaseName })

    return Effect.gen(function*() {
      const journal = yield* DraftJournal
      yield* journal.save(draft("session-a", 1))
      yield* putRawRecord(indexedDB, databaseName, {
        key: "review\u0000session-a",
        payload: draft("session-a", 1)
      })

      const failure = yield* Effect.flip(journal.load("review", "session-a"))

      expect(failure).toBeInstanceOf(DraftJournalFailed)
      expect(failure.detail).toContain("draft")
    }).pipe(Effect.provide(layer))
  })

  it.effect("rejects a draft whose identity disagrees with its storage key", () => {
    const indexedDB = new IDBFactory()
    const databaseName = "crit-draft-journal-key-mismatch"
    const layer = IndexedDbDraftJournal.layer({ indexedDB, databaseName })

    return Effect.gen(function*() {
      const journal = yield* DraftJournal
      yield* journal.save(draft("session-a", 1))
      yield* putRawRecord(indexedDB, databaseName, {
        key: "review\u0000session-a",
        draft: draft("session-b", 1)
      })

      const failure = yield* Effect.flip(journal.load("review", "session-a"))

      expect(failure).toBeInstanceOf(DraftJournalFailed)
      expect(failure.detail).toContain("identity does not match its key")
    }).pipe(Effect.provide(layer))
  })
})
