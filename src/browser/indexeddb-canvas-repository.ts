import { Effect, Predicate, Schema, Semaphore } from "effect"

import type { CanvasDocument } from "../core/index.js"
import { causeMessage } from "../internal/cause-message.js"
import { applyCanvasCommands } from "../runtime/apply-canvas-commands.js"
import {
  CritClientInvalidDocument,
  CritClientNotFound,
  unavailableCanvas
} from "../runtime/canvas-failure.js"
import {
  CanvasRepository,
  DocumentAlreadyExists
} from "../runtime/canvas-repository.js"
import { canonicalizeDocument } from "../runtime/internal/document-codec.js"

const DATABASE_VERSION = 1
const STORE_NAME = "canvases"

export type IndexedDbCanvasRepositoryOptions = {
  readonly indexedDB?: IDBFactory
  readonly databaseName?: string
  readonly seed?: ReadonlyArray<CanvasDocument>
}

const storageFailure = (operation: string, id: string, cause: unknown) =>
  unavailableCanvas(operation, id, cause)

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
        database.createObjectStore(STORE_NAME, { keyPath: "id" })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to open the canvas database"))
    request.onblocked = () =>
      reject(new Error("Opening the canvas database was blocked"))
  })

const requestValue = <Value>(request: IDBRequest<Value>) =>
  new Promise<Value>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed"))
  })

const readRecord = (database: IDBDatabase, id: string) =>
  requestValue(
    database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(id)
  )

const writeRecord = (database: IDBDatabase, document: CanvasDocument) =>
  new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite")
    transaction.objectStore(STORE_NAME).put(document)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Failed to write the Canvas"))
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Canvas write was aborted"))
  })

const readAllRecords = (database: IDBDatabase) =>
  requestValue(
    database
      .transaction(STORE_NAME, "readonly")
      .objectStore(STORE_NAME)
      .getAll()
  )

const make = (
  options: IndexedDbCanvasRepositoryOptions = {}
): CanvasRepository["Service"] => {
  const factory = options.indexedDB ?? globalThis.indexedDB
  const databaseName = options.databaseName ?? "@riff-refine/crit/canvases"
  const seed = new Map(
    (options.seed ?? []).map((document) => [document.id, document])
  )
  const locks = new Map<string, Semaphore.Semaphore>()

  const lockFor = (id: string) => {
    const existing = locks.get(id)
    if (existing !== undefined) return existing
    const lock = Effect.runSync(Semaphore.make(1))
    locks.set(id, lock)
    return lock
  }

  const withDatabase = <Value>(
    operation: string,
    id: string,
    task: (database: IDBDatabase) => Promise<Value>
  ): Effect.Effect<Value, ReturnType<typeof storageFailure>> =>
    Effect.tryPromise({
      try: async () => {
        const database = await openDatabase(factory, databaseName)
        try {
          return await task(database)
        } finally {
          database.close()
        }
      },
      catch: (cause) => storageFailure(operation, id, cause)
    })

  const decodeDocument = (id: string, input: Schema.Json) =>
    Effect.gen(function*() {
      const json = yield* Effect.try({
        try: () => Schema.decodeUnknownSync(Schema.Json)(input),
        catch: (cause) =>
          new CritClientInvalidDocument({
            id,
            detail: causeMessage(cause)
          })
      })
      return yield* canonicalizeDocument(id, json)
    })

  const loadStored = (id: string) =>
    withDatabase("load", id, (database) => readRecord(database, id)).pipe(
      Effect.flatMap((record) =>
        record === undefined
          ? Effect.succeed(undefined)
          : decodeDocument(id, record)
      )
    )

  const persist = (document: CanvasDocument) =>
    withDatabase("write", document.id, (database) =>
      writeRecord(database, document)
    ).pipe(Effect.as(document))

  const load: CanvasRepository["Service"]["load"] = (id) =>
    Effect.gen(function*() {
      const stored = yield* loadStored(id)
      if (stored !== undefined) return stored
      const seeded = seed.get(id)
      if (seeded === undefined) {
        return yield* new CritClientNotFound({ id })
      }
      const canonical = yield* canonicalizeDocument(id, seeded)
      return yield* persist(canonical).pipe(
        Effect.catchTag("CritClientUnavailable", () => Effect.succeed(canonical))
      )
    })

  const create: CanvasRepository["Service"]["create"] = (document) =>
    lockFor(document.id).withPermits(1)(
      Effect.gen(function*() {
        const canonical = yield* canonicalizeDocument(document.id, document)
        const existing = yield* loadStored(document.id)
        if (existing !== undefined) {
          return yield* new DocumentAlreadyExists({
            id: document.id,
            currentRevision: existing.revision
          })
        }
        return yield* persist(canonical)
      })
    )

  const list: CanvasRepository["Service"]["list"] = () =>
    withDatabase("list", "*", (database) => readAllRecords(database)).pipe(
      Effect.flatMap((records) =>
        Effect.forEach(Array.isArray(records) ? records : [], (record) => {
          const id =
            Predicate.hasProperty(record, "id") && Predicate.isString(record.id)
              ? record.id
              : "*"
          return decodeDocument(id, record).pipe(
            Effect.catchTag("CritClientInvalidDocument", () =>
              Effect.succeed(undefined)
            )
          )
        })
      ),
      Effect.map((documents) =>
        documents
          .filter(Predicate.isNotUndefined)
          .sort((left, right) => left.id.localeCompare(right.id))
      )
    )

  const apply: CanvasRepository["Service"]["apply"] = (id, commands) =>
    lockFor(id).withPermits(1)(
      load(id).pipe(
        Effect.flatMap((current) => applyCanvasCommands(id, current, commands)),
        Effect.tap((mutation) => persist(mutation.document))
      )
    )

  return { create, load, list, apply }
}

export const IndexedDbCanvasRepository = { make } as const
