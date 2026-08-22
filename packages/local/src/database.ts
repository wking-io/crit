import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient"
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator"
import { Cause, Data, Effect, Schedule, Schema } from "effect"
import * as Reactivity from "effect/unstable/reactivity/Reactivity"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import * as SqlError from "effect/unstable/sql/SqlError"

import { authorityTableSql, migrationEntries, migrations, replicaTableSql } from "./migrations.js"

export class LocalDatabaseOpenFailure extends Data.TaggedError("LocalDatabaseOpenFailure")<{
  readonly path: string
  readonly reason: string
}> {}

export interface SqliteLocalOptions {
  readonly path: string
}

const UserVersionRow = Schema.Struct({ user_version: Schema.Number })
const SchemaRow = Schema.Struct({ name: Schema.String, sql: Schema.NullOr(Schema.String) })
const MigrationRow = Schema.Struct({ migration_id: Schema.Number, name: Schema.String })

const normalizeSql = (sql: string): string => sql.replaceAll(/\s+/g, " ").trim().toLowerCase()

const requireTable = (
  tables: ReadonlyArray<typeof SchemaRow.Type>,
  name: string,
  definition: string
) => {
  const table = tables.find((candidate) => candidate.name === name)
  if (table === undefined || table.sql === null || normalizeSql(table.sql) !== normalizeSql(definition)) {
    throw new Error(`database table ${name} does not match the required schema`)
  }
}

const adoptLegacyAuthority = (sql: SqliteClient.SqliteClient) => Effect.gen(function*() {
  const versionRows = yield* sql.unsafe<typeof UserVersionRow.Encoded>("PRAGMA user_version")
  const version = Schema.decodeUnknownSync(UserVersionRow)(versionRows[0]).user_version
  const rows = yield* sql.unsafe<typeof SchemaRow.Encoded>(
    "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  )
  const tables = rows.map((row) => Schema.decodeUnknownSync(SchemaRow)(row))
  const migrationTable = tables.find((row) => row.name === "crit_migrations")
  if (migrationTable !== undefined) {
    const storedRows = yield* sql.unsafe<typeof MigrationRow.Encoded>(
      "SELECT migration_id, name FROM crit_migrations ORDER BY migration_id"
    )
    const stored = storedRows.map((row) => Schema.decodeUnknownSync(MigrationRow)(row))
    if (stored.length > migrationEntries.length) throw new Error("database has migrations newer than this runtime")
    for (let index = 0; index < stored.length; index += 1) {
      const actual = stored[index]!
      const expected = migrationEntries[index]!
      if (actual.migration_id !== expected[0] || actual.name !== expected[1]) {
        throw new Error(`database migration ${actual.migration_id} does not match ${expected[0]} ${expected[1]}`)
      }
    }
    if (stored.length >= 1) {
      for (const [name, definition] of Object.entries(authorityTableSql)) requireTable(tables, name, definition)
    }
    if (stored.length >= 2) requireTable(tables, "replica_states", replicaTableSql)
    if (version !== 0) yield* sql.unsafe("PRAGMA user_version = 0")
    return
  }
  if (version > 1) throw new Error(`database schema version ${version} is newer than the supported legacy version 1`)
  if (version === 0 && tables.length === 0) return
  if (version !== 1) throw new Error("database has tables without a recognized migration history")

  const expected = Object.entries(authorityTableSql).sort(([left], [right]) => left.localeCompare(right))
  if (tables.length !== expected.length) throw new Error("legacy authority database contains an unexpected table set")
  for (let index = 0; index < expected.length; index += 1) {
    const [name, definition] = expected[index]!
    const table = tables[index]!
    if (table.name !== name || table.sql === null || normalizeSql(table.sql) !== normalizeSql(definition)) {
      throw new Error(`legacy authority table ${name} does not match the supported schema`)
    }
  }
  yield* sql.unsafe(`CREATE TABLE crit_migrations (
    migration_id integer PRIMARY KEY NOT NULL,
    created_at datetime NOT NULL DEFAULT current_timestamp,
    name VARCHAR(255) NOT NULL
  )`)
  yield* sql`INSERT INTO crit_migrations (migration_id, name) VALUES (1, ${migrationEntries[0][1]})`
  yield* sql.unsafe("PRAGMA user_version = 0")
})

export const retryTransaction = <A, E, R>(
  sql: SqliteClient.SqliteClient,
  body: Effect.Effect<A, E, R>
): Effect.Effect<A, E | SqlError.SqlError, R> => sql.withTransaction(body).pipe(Effect.retry({
  schedule: Schedule.spaced("2 millis"),
  while: (error) => SqlError.isSqlError(error) && error.reason._tag === "LockTimeoutError"
}))

export const makeDatabase = (options: SqliteLocalOptions) => Effect.gen(function*() {
  const sql = yield* SqliteClient.make({ filename: options.path, busyTimeout: 0 }).pipe(
    Effect.provide(Reactivity.layer)
  )
  yield* sql.unsafe("PRAGMA foreign_keys = ON")
  yield* retryTransaction(sql, adoptLegacyAuthority(sql))
  yield* SqliteMigrator.run({ loader: migrations, table: "crit_migrations" }).pipe(
    Effect.provideService(SqlClient.SqlClient, sql),
    Effect.retry({
      schedule: Schedule.spaced("2 millis"),
      while: (error) => error._tag === "SqlError" && error.reason._tag === "LockTimeoutError"
    })
  )
  return sql
}).pipe(Effect.catchCause((cause) => Effect.fail(new LocalDatabaseOpenFailure({
  path: options.path,
  reason: Cause.pretty(cause)
}))))
