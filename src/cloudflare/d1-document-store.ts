import { Effect, Layer } from "effect"

import type { CanvasDocument } from "../core/index.js"
import {
  DocumentAlreadyExists,
  DocumentConflict,
  DocumentMalformed,
  DocumentNotFound,
  DocumentStorageFailed,
  DocumentStore,
  type DocumentStoreShape
} from "../runtime/document-store.js"
import {
  canonicalizeDocument,
  serializeDocument
} from "../runtime/internal/document-codec.js"

export interface D1ResultLike {
  readonly success: true
  readonly meta: {
    readonly changes: number
    readonly [key: string]: unknown
  }
  readonly results: ReadonlyArray<Record<string, unknown>>
}

export interface D1PreparedStatementLike {
  bind(...values: Array<unknown>): D1PreparedStatementLike
  first(): Promise<Record<string, unknown> | null>
  run(): Promise<D1ResultLike>
  all(): Promise<D1ResultLike>
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike
}

export const CRIT_D1_MIGRATION_0001 = `CREATE TABLE IF NOT EXISTS crit_canvases (
  id TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  document TEXT NOT NULL CHECK (json_valid(document)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);`

const storageFailure = (operation: string, id: string, cause: unknown) =>
  new DocumentStorageFailed({
    operation,
    id,
    detail: cause instanceof Error ? cause.message : String(cause)
  })

const query = <A>(
  operation: string,
  id: string,
  execute: () => Promise<A>
) =>
  Effect.tryPromise({
    try: execute,
    catch: (cause) => storageFailure(operation, id, cause)
  })

const parseDocument = (id: string, value: unknown) =>
  Effect.try({
    try: () => {
      if (typeof value !== "string") {
        throw new TypeError("Stored document must be JSON text")
      }
      return JSON.parse(value) as unknown
    },
    catch: (cause) =>
      new DocumentMalformed({
        id,
        detail: cause instanceof Error ? cause.message : String(cause)
      })
  }).pipe(Effect.flatMap((input) => canonicalizeDocument(id, input)))

const revisionFrom = (id: string, row: Record<string, unknown>) => {
  const revision = row.revision
  return typeof revision === "number" && Number.isSafeInteger(revision)
    ? Effect.succeed(revision)
    : Effect.fail(
        new DocumentMalformed({
          id,
          detail: "Stored revision must be a safe integer"
        })
      )
}

const make = (database: D1DatabaseLike): DocumentStoreShape => {
  const load: DocumentStoreShape["load"] = (id) =>
    Effect.gen(function*() {
      const row = yield* query("load", id, () =>
        database
          .prepare("SELECT document FROM crit_canvases WHERE id = ?")
          .bind(id)
          .first()
      )
      if (row === null) return yield* new DocumentNotFound({ id })
      return yield* parseDocument(id, row.document)
    })

  const create: DocumentStoreShape["create"] = (document) =>
    Effect.gen(function*() {
      const canonical = yield* canonicalizeDocument(document.id, document)
      const result = yield* query("create", canonical.id, () =>
        database
          .prepare(
            "INSERT INTO crit_canvases (id, revision, document) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING"
          )
          .bind(
            canonical.id,
            canonical.revision,
            serializeDocument(canonical)
          )
          .run()
      )
      if (result.meta.changes > 0) return canonical

      const row = yield* query("create", canonical.id, () =>
        database
          .prepare("SELECT revision FROM crit_canvases WHERE id = ?")
          .bind(canonical.id)
          .first()
      )
      if (row === null) {
        return yield* storageFailure(
          "create",
          canonical.id,
          "Document disappeared during conditional creation"
        )
      }
      const currentRevision = yield* revisionFrom(canonical.id, row)
      return yield* new DocumentAlreadyExists({
        id: canonical.id,
        currentRevision
      })
    })

  const list: DocumentStoreShape["list"] = () =>
    Effect.gen(function*() {
      const result = yield* query("list", "*", () =>
        database
          .prepare("SELECT id, document FROM crit_canvases ORDER BY id")
          .all()
      )
      return yield* Effect.forEach(result.results, (row) => {
        const id = row.id
        return typeof id === "string"
          ? parseDocument(id, row.document)
          : Effect.fail(
              new DocumentMalformed({
                id: "*",
                detail: "Stored Canvas ID must be text"
              })
            )
      })
    })

  const save: DocumentStoreShape["save"] = (document, options) =>
    Effect.gen(function*() {
      const canonical = yield* canonicalizeDocument(document.id, document)
      const next: CanvasDocument = {
        ...canonical,
        revision: options.expectedRevision + 1
      }
      const result = yield* query("save", canonical.id, () =>
        database
          .prepare(
            "UPDATE crit_canvases SET revision = ?, document = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND revision = ?"
          )
          .bind(
            next.revision,
            serializeDocument(next),
            canonical.id,
            options.expectedRevision
          )
          .run()
      )
      if (result.meta.changes > 0) return next

      const row = yield* query("save", canonical.id, () =>
        database
          .prepare("SELECT revision FROM crit_canvases WHERE id = ?")
          .bind(canonical.id)
          .first()
      )
      if (row === null) return yield* new DocumentNotFound({ id: canonical.id })
      const currentRevision = yield* revisionFrom(canonical.id, row)
      return yield* new DocumentConflict({
        id: canonical.id,
        expectedRevision: options.expectedRevision,
        currentRevision
      })
    })

  return { create, load, list, save }
}

const initialize = (database: D1DatabaseLike) =>
  query("initialize", "*", () =>
    database.prepare(CRIT_D1_MIGRATION_0001).run()
  ).pipe(Effect.asVoid)

const layer = (options: { readonly database: D1DatabaseLike }) =>
  Layer.succeed(DocumentStore, make(options.database))

export const D1DocumentStore = { initialize, layer, make } as const
