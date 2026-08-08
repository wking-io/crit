import { readFile } from "node:fs/promises"
import { DatabaseSync, type SQLInputValue } from "node:sqlite"

import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import {
  CRIT_D1_MIGRATION_0001,
  D1DocumentStore,
  makeCritCloudflareHandler,
  type D1DatabaseLike,
  type D1PreparedStatementLike,
  type D1ResultLike
} from "../../src/cloudflare/index.js"
import { Canvas } from "../../src/core/index.js"

const sqliteValue = (value: unknown): SQLInputValue => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint"
  ) {
    return value
  }
  if (typeof value === "boolean") return value ? 1 : 0
  throw new TypeError(`Unsupported SQLite binding: ${String(value)}`)
}

class SqliteD1Statement implements D1PreparedStatementLike {
  constructor(
    private readonly database: DatabaseSync,
    private readonly query: string,
    private readonly values: ReadonlyArray<SQLInputValue> = []
  ) {}

  bind(...values: Array<unknown>): D1PreparedStatementLike {
    return new SqliteD1Statement(
      this.database,
      this.query,
      values.map(sqliteValue)
    )
  }

  first(): Promise<Record<string, unknown> | null> {
    const row = this.database.prepare(this.query).get(...this.values)
    return Promise.resolve(row === undefined ? null : { ...row })
  }

  run(): Promise<D1ResultLike> {
    const result = this.database.prepare(this.query).run(...this.values)
    return Promise.resolve({
      success: true,
      meta: { changes: Number(result.changes) },
      results: []
    })
  }

  all(): Promise<D1ResultLike> {
    const rows = this.database
      .prepare(this.query)
      .all(...this.values)
      .map((row) => ({ ...row }))
    return Promise.resolve({
      success: true,
      meta: { changes: 0 },
      results: rows
    })
  }
}

class SqliteD1Database implements D1DatabaseLike {
  readonly sqlite = new DatabaseSync(":memory:")

  prepare(query: string): D1PreparedStatementLike {
    return new SqliteD1Statement(this.sqlite, query)
  }

  close() {
    this.sqlite.close()
  }
}

describe("D1DocumentStore", () => {
  let database: SqliteD1Database

  beforeEach(() => {
    database = new SqliteD1Database()
  })

  afterEach(() => {
    database.close()
  })

  it("ships the same schema used by zero-setup initialization", async () => {
    const migration = await readFile(
      new URL("../../migrations/0001_crit_canvases.sql", import.meta.url),
      "utf8"
    )

    expect(migration.trim()).toBe(CRIT_D1_MIGRATION_0001.trim())
  })

  it.effect("uses SQLite constraints for creation and optimistic saves", () =>
    Effect.gen(function*() {
      yield* D1DocumentStore.initialize(database)
      const store = D1DocumentStore.make(database)
      const initial = Canvas.export(
        Canvas.create({ id: "checkout", title: "Checkout review" })
      )

      const created = yield* store.create(initial)
      const duplicate = yield* Effect.flip(store.create(initial))
      const saved = yield* store.save(initial, { expectedRevision: 0 })
      const stale = yield* Effect.flip(
        store.save(initial, { expectedRevision: 0 })
      )
      const listed = yield* store.list()

      expect(created).toEqual(initial)
      expect(duplicate).toMatchObject({
        _tag: "DocumentAlreadyExists",
        id: "checkout",
        currentRevision: 0
      })
      expect(saved.revision).toBe(1)
      expect(stale).toMatchObject({
        _tag: "DocumentConflict",
        id: "checkout",
        expectedRevision: 0,
        currentRevision: 1
      })
      expect(listed).toEqual([saved])
    }))
})

describe("makeCritCloudflareHandler", () => {
  let database: SqliteD1Database

  beforeEach(() => {
    database = new SqliteD1Database()
  })

  afterEach(() => {
    database.close()
  })

  it("auto-initializes D1, serves Crit requests, and respects the environment gate", async () => {
    const handler = makeCritCloudflareHandler()
    const request = new Request(
      "https://preview.example/__crit/api/canvases/homepage"
    )

    const disabled = await handler(request, {
      database,
      enabled: false
    })
    const unrelated = await handler(
      new Request("https://preview.example/app"),
      { database }
    )
    const tableBeforeCrit = database.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'crit_canvases'"
      )
      .get()
    const concurrent = await Promise.all(
      Array.from({ length: 8 }, () => handler(request, { database }))
    )
    const documents = await Promise.all(
      concurrent.map((response) => response?.json())
    )

    expect(disabled).toBeNull()
    expect(unrelated).toBeNull()
    expect(tableBeforeCrit).toBeUndefined()
    expect(concurrent.every((response) => response?.status === 200)).toBe(true)
    expect(
      documents.every(
        (document) =>
          typeof document === "object" &&
          document !== null &&
          "revision" in document &&
          document.revision === 0
      )
    ).toBe(true)
  })
})
