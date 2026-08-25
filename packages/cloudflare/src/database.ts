import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient"
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator"
import { Cause, Data, Effect, Schedule } from "effect"
import * as Reactivity from "effect/unstable/reactivity/Reactivity"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import * as SqlError from "effect/unstable/sql/SqlError"

export class CloudflareDatabaseOpenFailure extends Data.TaggedError("CloudflareDatabaseOpenFailure")<{
  readonly path: string
  readonly reason: string
}> {}

export interface CloudflareDatabaseOptions {
  readonly path: string
}

const createAuthority = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  yield* sql.unsafe(`CREATE TABLE canvases (
    canvas_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    created_by_json TEXT NOT NULL CHECK (json_valid(created_by_json)),
    genesis_cursor TEXT NOT NULL UNIQUE,
    current_cursor TEXT NOT NULL UNIQUE,
    current_sequence INTEGER NOT NULL CHECK (current_sequence >= 0),
    projection_json TEXT NOT NULL CHECK (json_valid(projection_json))
  ) STRICT`)
  yield* sql.unsafe(`CREATE TABLE accepted_changes (
    canvas_id TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK (sequence > 0),
    change_id TEXT NOT NULL,
    cursor TEXT NOT NULL UNIQUE,
    change_json TEXT NOT NULL CHECK (json_valid(change_json)),
    PRIMARY KEY (canvas_id, sequence),
    UNIQUE (canvas_id, change_id),
    UNIQUE (canvas_id, sequence, change_id),
    FOREIGN KEY (canvas_id) REFERENCES canvases(canvas_id)
  ) STRICT`)
  yield* sql.unsafe(`CREATE TABLE retry_reservations (
    canvas_id TEXT NOT NULL,
    change_id TEXT NOT NULL,
    proposal_json TEXT NOT NULL CHECK (json_valid(proposal_json)),
    authorization_subject TEXT NOT NULL,
    accepted_sequence INTEGER,
    rejected_failure_json TEXT CHECK (rejected_failure_json IS NULL OR json_valid(rejected_failure_json)),
    PRIMARY KEY (canvas_id, change_id),
    CHECK ((accepted_sequence IS NOT NULL) <> (rejected_failure_json IS NOT NULL)),
    FOREIGN KEY (canvas_id) REFERENCES canvases(canvas_id),
    FOREIGN KEY (canvas_id, accepted_sequence, change_id)
      REFERENCES accepted_changes(canvas_id, sequence, change_id)
  ) STRICT`)
})

const migrations = SqliteMigrator.fromRecord({
  "0001_authority": createAuthority
})

export const retryTransaction = <A, E, R>(
  sql: SqliteClient.SqliteClient,
  body: Effect.Effect<A, E, R>
): Effect.Effect<A, E | SqlError.SqlError, R> => sql.withTransaction(body).pipe(Effect.retry({
  schedule: Schedule.spaced("2 millis"),
  while: (error) => SqlError.isSqlError(error) && error.reason._tag === "LockTimeoutError"
}))

export const makeDatabase = (options: CloudflareDatabaseOptions) => Effect.gen(function*() {
  const sql = yield* SqliteClient.make({ filename: options.path, busyTimeout: 0 }).pipe(
    Effect.provide(Reactivity.layer)
  )
  yield* sql.unsafe("PRAGMA foreign_keys = ON")
  yield* SqliteMigrator.run({ loader: migrations, table: "crit_migrations" }).pipe(
    Effect.provideService(SqlClient.SqlClient, sql),
    Effect.retry({
      schedule: Schedule.spaced("2 millis"),
      while: (error) => error._tag === "SqlError" && error.reason._tag === "LockTimeoutError"
    })
  )
  return sql
}).pipe(Effect.catchCause((cause) => Effect.fail(new CloudflareDatabaseOpenFailure({
  path: options.path,
  reason: Cause.pretty(cause)
}))))
