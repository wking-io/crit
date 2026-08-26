import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator"
import { Effect } from "effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"

export const authorityTableSql = {
  canvases: `CREATE TABLE canvases (
    canvas_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    created_by_json TEXT NOT NULL CHECK (json_valid(created_by_json)),
    genesis_cursor TEXT NOT NULL UNIQUE,
    current_cursor TEXT NOT NULL UNIQUE,
    current_sequence INTEGER NOT NULL CHECK (current_sequence >= 0),
    projection_json TEXT NOT NULL CHECK (json_valid(projection_json))
  ) STRICT`,
  accepted_changes: `CREATE TABLE accepted_changes (
    canvas_id TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK (sequence > 0),
    change_id TEXT NOT NULL,
    cursor TEXT NOT NULL UNIQUE,
    change_json TEXT NOT NULL CHECK (json_valid(change_json)),
    PRIMARY KEY (canvas_id, sequence),
    UNIQUE (canvas_id, change_id),
    UNIQUE (canvas_id, sequence, change_id),
    FOREIGN KEY (canvas_id) REFERENCES canvases(canvas_id)
  ) STRICT`,
  retry_reservations: `CREATE TABLE retry_reservations (
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
  ) STRICT`
} as const

export const replicaTableSql = `CREATE TABLE replica_states (
  canvas_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  state_json TEXT NOT NULL CHECK (json_valid(state_json))
) STRICT`

export const agentIdentityTableSql = `CREATE TABLE agent_identities (
  display_name TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL UNIQUE
) STRICT`

export const migrationEntries = [
  [1, "authority"],
  [2, "replica_state"],
  [3, "agent_identities"]
] as const

const createAuthority = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  yield* sql.unsafe(authorityTableSql.canvases)
  yield* sql.unsafe(authorityTableSql.accepted_changes)
  yield* sql.unsafe(authorityTableSql.retry_reservations)
})

const createReplica = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  yield* sql.unsafe(replicaTableSql)
})

const createAgentIdentities = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  yield* sql.unsafe(agentIdentityTableSql)
})

export const migrations = SqliteMigrator.fromRecord({
  "0001_authority": createAuthority,
  "0002_replica_state": createReplica,
  "0003_agent_identities": createAgentIdentities
})
