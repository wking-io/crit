import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient"
import { Cause, Context, Data, Effect, Layer, Predicate, Schedule } from "effect"
import * as Reactivity from "effect/unstable/reactivity/Reactivity"
import { isSqlError, type SqlError } from "effect/unstable/sql/SqlError"

import type { DurableSqlite } from "./durable-sqlite.js"
import { applyAuthoritySchema } from "./schema.js"

export class CloudflareDatabaseOpenFailure extends Data.TaggedError("CloudflareDatabaseOpenFailure")<{
  readonly path: string
  readonly reason: string
}> {}

export interface CloudflareDatabaseOptions {
  readonly path: string
}

const retryTransaction = <A, E, R>(
  sql: SqliteClient.SqliteClient,
  body: Effect.Effect<A, E, R>
): Effect.Effect<A, E | SqlError, R> => sql.withTransaction(body).pipe(Effect.retry({
  schedule: Schedule.spaced("2 millis"),
  while: (error) => isSqlError(error) && Predicate.isTagged(error.reason, "LockTimeoutError")
}))

export const makeDatabase = (options: CloudflareDatabaseOptions) => Effect.gen(function*() {
  const sql = yield* SqliteClient.make({ filename: options.path, busyTimeout: 0 }).pipe(
    Effect.provide(Reactivity.layer)
  )
  const sqlite: DurableSqlite = {
    sql,
    unsafe: (query, ...args) => sql.unsafe(query, args),
    transact: (body) => retryTransaction(sql, body)
  }
  yield* applyAuthoritySchema(sqlite).pipe(
    Effect.retry({
      schedule: Schedule.spaced("2 millis"),
      while: (error) => Predicate.isTagged(error, "SqlError") && "reason" in error
        && Predicate.isTagged(error.reason, "LockTimeoutError")
    })
  )
  return sqlite
}).pipe(Effect.catchCause((cause) => Effect.fail(new CloudflareDatabaseOpenFailure({
  path: options.path,
  reason: Cause.pretty(cause)
}))))

export class CloudflareDatabase extends Context.Service<CloudflareDatabase, {
  readonly open: (
    options: CloudflareDatabaseOptions
  ) => Effect.Effect<DurableSqlite, CloudflareDatabaseOpenFailure>
}>()("@crit/cloudflare/CloudflareDatabase") {
  static readonly layer = Layer.succeed(CloudflareDatabase, {
    open: makeDatabase
  })
}
