import { CanvasId } from "@crit/domain"
import type { CanvasAuthority } from "@crit/authority"
import type { CanvasReplica, ReplicaChangeIds } from "@crit/replica"
import {
  CanvasReplicaLive,
  ReplicaPolicy,
  ReplicaStateSchema,
  ReplicaStore,
  type ReplicaState
} from "@crit/replica/adapter"
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient"
import { Effect, Layer, Result, Schema } from "effect"

import {
  LocalDatabaseOpenFailure,
  localDatabaseLayer,
  retryTransaction,
  type SqliteLocalOptions
} from "./database.js"
import { decodeStored, encodeStored } from "./stored-json.js"

export type SqliteCanvasReplicaOptions = SqliteLocalOptions

const ReplicaRow = Schema.Struct({
  canvas_id: CanvasId,
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  state_json: Schema.String
})
const ChangeCount = Schema.Struct({ changes: Schema.Number })

type StoredReplica = {
  readonly state: ReplicaState
  readonly revision: number
}

const makeStore = () => Effect.gen(function*() {
  const sql = yield* SqliteClient.SqliteClient

  const read = (canvasId: typeof CanvasId.Type): Effect.Effect<StoredReplica | undefined> =>
    Effect.gen(function*() {
      const rows = yield* sql<typeof ReplicaRow.Encoded>`SELECT canvas_id, revision, state_json
        FROM replica_states WHERE canvas_id = ${canvasId}`
      if (rows.length === 0) return undefined
      const row = Schema.decodeUnknownSync(ReplicaRow, { onExcessProperty: "error" })(rows[0])
      const state = decodeStored(ReplicaStateSchema, row.state_json)
      if (state.canvasId !== row.canvas_id || state.canvasId !== state.genesisProjection.canvasId) {
        throw new Error("stored replica canvas facts disagree")
      }
      const rebuilt = ReplicaPolicy.rebuild(state)
      if (Result.isFailure(rebuilt)) throw rebuilt.failure
      return { state: rebuilt.success.state, revision: row.revision }
    }).pipe(Effect.orDie)

  const get: ReplicaStore["Service"]["get"] = (canvasId) => read(canvasId).pipe(
    Effect.map((stored) => stored?.state)
  )

  const modify: ReplicaStore["Service"]["modify"] = (canvasId, transition) =>
    retryTransaction(sql, Effect.gen(function*() {
      const stored = yield* read(canvasId)
      const decision = transition(stored?.state)
      if (Result.isFailure(decision)) return Result.fail(decision.failure)
      const [value, next] = decision.success
      if (next !== undefined) {
        if (next.canvasId !== canvasId) throw new Error("replica transition changed its canvas identity")
        const valid = ReplicaPolicy.view(next)
        if (Result.isFailure(valid)) throw valid.failure
      }
      if (stored === undefined) {
        if (next !== undefined) {
          yield* sql`INSERT INTO replica_states (canvas_id, revision, state_json)
            VALUES (${canvasId}, 0, ${encodeStored(ReplicaStateSchema, next)})`
        }
      } else if (next === undefined) {
        const raw = yield* sql`DELETE FROM replica_states
          WHERE canvas_id = ${canvasId} AND revision = ${stored.revision}`.raw
        if (Schema.decodeUnknownSync(ChangeCount)(raw).changes !== 1) throw new Error("stale replica delete")
      } else {
        const raw = yield* sql`UPDATE replica_states
          SET revision = ${stored.revision + 1}, state_json = ${encodeStored(ReplicaStateSchema, next)}
          WHERE canvas_id = ${canvasId} AND revision = ${stored.revision}`.raw
        if (Schema.decodeUnknownSync(ChangeCount)(raw).changes !== 1) throw new Error("stale replica update")
      }
      return Result.succeed(value)
    })).pipe(
      Effect.orDie,
      Effect.flatMap((decision) => Result.isSuccess(decision)
        ? Effect.succeed(decision.success)
        : Effect.fail(decision.failure))
    )

  return ReplicaStore.of({ get, modify })
})

export const sqliteReplicaStoreLayer = (options: SqliteCanvasReplicaOptions) =>
  Layer.effect(ReplicaStore, makeStore()).pipe(Layer.provide(localDatabaseLayer(options)))

export const SqliteCanvasReplica = {
  layer: (options: SqliteCanvasReplicaOptions): Layer.Layer<
    CanvasReplica,
    LocalDatabaseOpenFailure,
    CanvasAuthority | ReplicaChangeIds
  > => CanvasReplicaLive.pipe(
    Layer.provide(sqliteReplicaStoreLayer(options))
  )
}
