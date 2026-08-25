import { Effect } from "effect"
import type { SqlError } from "effect/unstable/sql/SqlError"

import type { DurableSqlite } from "./durable-sqlite.js"

const canvases = `CREATE TABLE IF NOT EXISTS canvases (
  canvas_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by_json TEXT NOT NULL CHECK (json_valid(created_by_json)),
  genesis_cursor TEXT NOT NULL UNIQUE,
  current_cursor TEXT NOT NULL UNIQUE,
  current_sequence INTEGER NOT NULL CHECK (current_sequence >= 0),
  projection_json TEXT NOT NULL CHECK (json_valid(projection_json))
) STRICT`

const acceptedChanges = `CREATE TABLE IF NOT EXISTS accepted_changes (
  canvas_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  change_id TEXT NOT NULL,
  cursor TEXT NOT NULL UNIQUE,
  change_json TEXT NOT NULL CHECK (json_valid(change_json)),
  PRIMARY KEY (canvas_id, sequence),
  UNIQUE (canvas_id, change_id),
  UNIQUE (canvas_id, sequence, change_id),
  FOREIGN KEY (canvas_id) REFERENCES canvases(canvas_id)
) STRICT`

const retryReservations = `CREATE TABLE IF NOT EXISTS retry_reservations (
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

export const applyAuthoritySchema = (
  sqlite: DurableSqlite
): Effect.Effect<void, SqlError> =>
  Effect.gen(function*() {
    yield* sqlite.unsafe("PRAGMA foreign_keys = ON")
    yield* sqlite.unsafe(canvases)
    yield* sqlite.unsafe(acceptedChanges)
    yield* sqlite.unsafe(retryReservations)
  })
