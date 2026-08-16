import { Effect, Layer, Option, Schema } from "effect"
import { causeMessage } from "../internal/cause-message.js"

import {
  CanvasDraft,
  DraftJournal,
  DraftJournalFailed
} from "../session/draft-journal.js"

const DATABASE_VERSION = 1
const STORE_NAME = "drafts"

const StoredDraft = Schema.Struct({
  key: Schema.String,
  draft: CanvasDraft
})
type StoredDraft = typeof StoredDraft.Type
const decodeStoredDraftRecord = Schema.decodeUnknownSync(
  Schema.UndefinedOr(StoredDraft)
)

export type IndexedDbDraftJournalOptions = {
  readonly indexedDB?: IDBFactory
  readonly databaseName?: string
}

const draftKey = (canvasId: string, sessionId: string) =>
  `${canvasId}\u0000${sessionId}`

const openDatabase = (
  factory: IDBFactory | undefined,
  databaseName: string
) =>
  new Promise<IDBDatabase>((resolve, reject) => {
    if (factory === undefined) {
      reject(new Error("IndexedDB is unavailable in this environment"))
      return
    }

    const request = factory.open(databaseName, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "key" })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to open the draft database"))
    request.onblocked = () =>
      reject(new Error("Opening the draft database was blocked"))
  })

const validateStoredDraft = (
  stored: StoredDraft | undefined,
  canvasId: string,
  sessionId: string
) => {
  if (stored === undefined) return undefined
  const expectedKey = draftKey(canvasId, sessionId)
  if (stored.key !== expectedKey) {
    throw new Error("Draft journal record key does not match the request")
  }
  const draft = stored.draft
  if (draft.canvasId !== canvasId || draft.sessionId !== sessionId) {
    throw new Error("Draft journal record identity does not match its key")
  }
  return draft
}

const loadDraft = (
  database: IDBDatabase,
  canvasId: string,
  sessionId: string
) =>
  new Promise<Option.Option<CanvasDraft>>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly")
    const request = transaction.objectStore(STORE_NAME).get(
      draftKey(canvasId, sessionId)
    )
    request.onsuccess = () => {
      try {
        resolve(
          Option.fromUndefinedOr(
            validateStoredDraft(
              decodeStoredDraftRecord(request.result),
              canvasId,
              sessionId
            )
          )
        )
      } catch (cause) {
        reject(cause)
      }
    }
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to load the draft"))
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Loading the draft was aborted"))
  })

const saveDraft = (database: IDBDatabase, draft: CanvasDraft) =>
  new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite")
    const store = transaction.objectStore(STORE_NAME)
    const key = draftKey(draft.canvasId, draft.sessionId)
    const request = store.get(key)

    request.onsuccess = () => {
      try {
        const current = validateStoredDraft(
          decodeStoredDraftRecord(request.result),
          draft.canvasId,
          draft.sessionId
        )
        if (current === undefined || current.mutation <= draft.mutation) {
          store.put({ key, draft } satisfies StoredDraft)
        }
      } catch (cause) {
        reject(cause)
        transaction.abort()
      }
    }
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to read the current draft"))
    transaction.oncomplete = () => resolve()
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Failed to save the draft"))
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Saving the draft was aborted"))
  })

const clearDraft = (
  database: IDBDatabase,
  canvasId: string,
  sessionId: string,
  throughMutation: number
) =>
  new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite")
    const store = transaction.objectStore(STORE_NAME)
    const key = draftKey(canvasId, sessionId)
    const request = store.get(key)

    request.onsuccess = () => {
      try {
        const current = validateStoredDraft(
          decodeStoredDraftRecord(request.result),
          canvasId,
          sessionId
        )
        if (current !== undefined && current.mutation <= throughMutation) {
          store.delete(key)
        }
      } catch (cause) {
        reject(cause)
        transaction.abort()
      }
    }
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to read the current draft"))
    transaction.oncomplete = () => resolve()
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Failed to clear the draft"))
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Clearing the draft was aborted"))
  })

const indexedDbFromRuntime = (): IDBFactory | undefined =>
  globalThis.indexedDB

const make = (options: IndexedDbDraftJournalOptions = {}): DraftJournal["Service"] => {
  const databaseName = options.databaseName ?? "@riff-refine/crit/drafts/v1"
  const factory =
    options.indexedDB ??
    indexedDbFromRuntime()

  const run = <A>(
    operation: string,
    canvasId: string,
    execute: (database: IDBDatabase) => Promise<A>
  ) =>
    Effect.tryPromise({
      try: async () => {
        const database = await openDatabase(factory, databaseName)
        try {
          return await execute(database)
        } finally {
          database.close()
        }
      },
      catch: (cause) =>
        new DraftJournalFailed({
          operation,
          canvasId,
          detail: causeMessage(cause)
        })
    })

  return {
    load: (canvasId, sessionId) =>
      run("load", canvasId, (database) =>
        loadDraft(database, canvasId, sessionId)
      ),
    save: (draft) =>
      run("save", draft.canvasId, (database) => saveDraft(database, draft)),
    clear: (canvasId, sessionId, throughMutation) =>
      run("clear", canvasId, (database) =>
        clearDraft(database, canvasId, sessionId, throughMutation)
      )
  }
}

const layer = (options: IndexedDbDraftJournalOptions = {}) =>
  Layer.succeed(DraftJournal, make(options))

export const IndexedDbDraftJournal = { make, layer } as const
