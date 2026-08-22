import { DatabaseSync, type StatementSync } from "node:sqlite"

import {
  AuthorityFailure,
  AuthorityClock,
  AuthorityView,
  ChangeRejected,
  CreateCanvas,
  VerifiedInvocation,
  type CanvasAuthority,
  type ChangesAfter,
  type SubmitCanvasChangeFailure
} from "@crit/authority"
import {
  AcceptedAttribution,
  AgentAttribution,
  CanvasCommandBatch,
  CanvasEngine,
  CanvasId,
  CanvasProjection,
  ChangeId,
  IsoTimestamp,
  PersonAttribution,
  emptyCanvasProjection
} from "@crit/domain"
import {
  ChangeProtocol,
  ProtocolValue,
  type AcceptedCanvasChange,
  type ChangePage,
  type Cursor,
  type ProposedCanvasChange,
  type SubmitChangeReceipt
} from "@crit/protocol"
import { Data, Effect, Result, Schema, Semaphore, type Scope } from "effect"

const schemaVersion = 1

export class LocalAuthorityOpenFailure extends Data.TaggedError("LocalAuthorityOpenFailure")<{
  readonly path: string
  readonly reason: string
}> {}

export interface SqliteCanvasAuthorityOptions {
  readonly path: string
  readonly now?: Effect.Effect<typeof IsoTimestamp.Type>
}

const setup = (database: DatabaseSync): void => {
  database.exec("PRAGMA foreign_keys = ON")
  database.exec("PRAGMA busy_timeout = 0")
  const version = database.prepare("PRAGMA user_version").get()
  const current = Schema.decodeUnknownSync(Schema.Struct({ user_version: Schema.Number }))(version).user_version
  if (current > schemaVersion) throw new Error(`database schema version ${current} is newer than ${schemaVersion}`)
  if (current === 0) {
    database.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE canvases (
        canvas_id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        created_by_json TEXT NOT NULL CHECK (json_valid(created_by_json)),
        genesis_cursor TEXT NOT NULL UNIQUE,
        current_cursor TEXT NOT NULL UNIQUE,
        current_sequence INTEGER NOT NULL CHECK (current_sequence >= 0),
        projection_json TEXT NOT NULL CHECK (json_valid(projection_json))
      ) STRICT;
      CREATE TABLE accepted_changes (
        canvas_id TEXT NOT NULL,
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        change_id TEXT NOT NULL,
        cursor TEXT NOT NULL UNIQUE,
        change_json TEXT NOT NULL CHECK (json_valid(change_json)),
        PRIMARY KEY (canvas_id, sequence),
        UNIQUE (canvas_id, change_id),
        UNIQUE (canvas_id, sequence, change_id),
        FOREIGN KEY (canvas_id) REFERENCES canvases(canvas_id)
      ) STRICT;
      CREATE TABLE retry_reservations (
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
      ) STRICT;
      PRAGMA user_version = 1;
      COMMIT;
    `)
  }
}

const JsonText = Schema.String
const CanvasRow = Schema.Struct({
  canvas_id: CanvasId,
  created_at: IsoTimestamp,
  created_by_json: JsonText,
  genesis_cursor: Schema.String,
  current_cursor: Schema.String,
  current_sequence: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  projection_json: JsonText
})
const AcceptedRow = Schema.Struct({
  canvas_id: CanvasId,
  sequence: Schema.Int.check(Schema.isGreaterThan(0)),
  change_id: ChangeId,
  cursor: Schema.String,
  change_json: JsonText
})
const RetryRow = Schema.Struct({
  canvas_id: CanvasId,
  change_id: ChangeId,
  proposal_json: JsonText,
  authorization_subject: Schema.String,
  accepted_sequence: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0))),
  rejected_failure_json: Schema.NullOr(JsonText)
})

const json = (value: Schema.Json): string => JSON.stringify(value)
const parseJson = (value: string): Schema.Json => Schema.decodeUnknownSync(Schema.Json)(JSON.parse(value))
const decodeStored = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, value: string): S["Type"] =>
  Schema.decodeUnknownSync(schema, { onExcessProperty: "error" })(parseJson(value))
const encodeStored = <S extends Schema.ConstraintEncoder<unknown>>(schema: S, value: S["Type"]): string =>
  json(Schema.decodeUnknownSync(Schema.Json)(Schema.encodeUnknownSync(schema)(value)))

const decodeProtocol = <A>(value: string, decode: (input: Schema.Json) => { readonly ok: boolean; readonly value?: A }): A => {
  const result = decode(parseJson(value))
  if (!result.ok || result.value === undefined) throw new Error("stored protocol value is invalid")
  return result.value
}

const attribution = (invocation: VerifiedInvocation): AcceptedAttribution => invocation._tag === "person"
  ? PersonAttribution.make({ person: invocation.principal.person })
  : AgentAttribution.make(invocation.reportedRuntime === undefined ? {
      agent: invocation.principal.agent,
      delegatedBy: invocation.principal.delegatedBy,
      oauthClientId: invocation.principal.oauthClientId,
      grantId: invocation.principal.grantId,
      executionId: invocation.executionId
    } : {
      agent: invocation.principal.agent,
      delegatedBy: invocation.principal.delegatedBy,
      oauthClientId: invocation.principal.oauthClientId,
      grantId: invocation.principal.grantId,
      executionId: invocation.executionId,
      reportedRuntime: invocation.reportedRuntime
    })

const cursorAt = (canvasId: typeof CanvasId.Type, sequence: number): Cursor =>
  ProtocolValue.cursor(`cursor_${canvasId}_${sequence}`)

const readCanvas = (database: DatabaseSync, statement: StatementSync, canvasId: typeof CanvasId.Type) => {
  const unknownRow = statement.get(canvasId)
  if (unknownRow === undefined) return undefined
  const row = Schema.decodeUnknownSync(CanvasRow, { onExcessProperty: "error" })(unknownRow)
  const createdBy = decodeStored(AcceptedAttribution, row.created_by_json)
  const projection = decodeStored(CanvasProjection, row.projection_json)
  const genesisCursor = ProtocolValue.cursor(row.genesis_cursor)
  const cursor = ProtocolValue.cursor(row.current_cursor)
  if (projection.canvasId !== row.canvas_id || (row.current_sequence === 0 && cursor !== genesisCursor)) {
    throw new Error("stored Canvas checkpoint facts disagree")
  }
  if (row.current_sequence > 0) {
    const head = database.prepare(
      "SELECT cursor FROM accepted_changes WHERE canvas_id = ? AND sequence = ?"
    ).get(row.canvas_id, row.current_sequence)
    const decoded = Schema.decodeUnknownSync(Schema.Struct({ cursor: Schema.String }))(head)
    if (ProtocolValue.cursor(decoded.cursor) !== cursor) throw new Error("stored Canvas checkpoint is not the ledger head")
  }
  return { row, genesisCursor, view: AuthorityView.make({
    canvasId: row.canvas_id,
    createdAt: row.created_at,
    createdBy,
    cursor,
    projection
  }) }
}

const readAccepted = (stored: typeof AcceptedRow.Type): AcceptedCanvasChange => {
  const change = decodeProtocol(stored.change_json, ChangeProtocol.accepted.decode)
  if (change.canvasId !== stored.canvas_id || change.changeId !== stored.change_id ||
      change.sequence !== stored.sequence || change.cursor !== stored.cursor) {
    throw new Error("stored accepted change facts disagree")
  }
  return change
}

const commandBatchEquals = Schema.toEquivalence(CanvasCommandBatch)
const sameProposal = (left: ProposedCanvasChange, right: ProposedCanvasChange): boolean =>
  left.changeId === right.changeId && left.canvasId === right.canvasId &&
  left.observedCursor === right.observedCursor && commandBatchEquals(left.commands, right.commands)

type SubmitDecision = Result.Result<SubmitChangeReceipt, SubmitCanvasChangeFailure>
type CanvasRecord = NonNullable<ReturnType<typeof readCanvas>>
type Evaluation = Data.TaggedEnum<{
  readonly decision: { readonly decision: SubmitDecision }
  readonly engine: { readonly canvas: CanvasRecord; readonly result: ReturnType<typeof CanvasEngine.apply> }
}>
const Evaluation = Data.taggedEnum<Evaluation>()

interface TransactionFailure {
  readonly acquired: boolean
  readonly cause: unknown
}

export const makeSqliteCanvasAuthority = (
  options: SqliteCanvasAuthorityOptions
): Effect.Effect<CanvasAuthority, LocalAuthorityOpenFailure, Scope.Scope> => Effect.gen(function*() {
  const database = yield* Effect.acquireRelease(
    Effect.try({
      try: () => {
        const opened = new DatabaseSync(options.path)
        try {
          setup(opened)
          return opened
        } catch (error) {
          opened.close()
          throw error
        }
      },
      catch: (error) => new LocalAuthorityOpenFailure({ path: options.path, reason: String(error) })
    }),
    (opened) => Effect.sync(() => opened.close())
  )
  const writer = yield* Semaphore.make(1)
  const now = options.now ?? AuthorityClock.now
  const canvasById = database.prepare("SELECT * FROM canvases WHERE canvas_id = ?")
  const retryById = database.prepare("SELECT * FROM retry_reservations WHERE canvas_id = ? AND change_id = ?")
  const acceptedBySequence = database.prepare("SELECT * FROM accepted_changes WHERE canvas_id = ? AND sequence = ?")

  const transaction = <A>(body: () => A): Effect.Effect<A> => Effect.sync((): Result.Result<A, TransactionFailure> => {
    let acquired = false
    try {
      database.exec("BEGIN IMMEDIATE")
      acquired = true
      const value = body()
      database.exec("COMMIT")
      return Result.succeed(value)
    } catch (cause) {
      if (acquired && database.isTransaction) database.exec("ROLLBACK")
      return Result.fail({ acquired, cause })
    }
  }).pipe(Effect.flatMap((attempt) => {
    if (attempt._tag === "Success") return Effect.succeed(attempt.success)
    if (!attempt.failure.acquired && /busy|locked/i.test(String(attempt.failure.cause))) {
      return Effect.sleep("2 millis").pipe(Effect.andThen(transaction(body)))
    }
    return Effect.die(attempt.failure.cause)
  }))

  const retryDecision = (proposal: ProposedCanvasChange, invocation: VerifiedInvocation): SubmitDecision | undefined => {
    const unknownRow = retryById.get(proposal.canvasId, proposal.changeId)
    if (unknownRow === undefined) return undefined
    const row = Schema.decodeUnknownSync(RetryRow, { onExcessProperty: "error" })(unknownRow)
    const prior = decodeProtocol(row.proposal_json, ChangeProtocol.proposed.decode)
    if (row.canvas_id !== proposal.canvasId || row.change_id !== proposal.changeId) throw new Error("stored retry facts disagree")
    if (!sameProposal(prior, proposal) || row.authorization_subject !== invocation.principal.subject) {
      return Result.fail(AuthorityFailure.changeIdReused({ canvasId: proposal.canvasId, changeId: proposal.changeId }))
    }
    if (row.accepted_sequence !== null) {
      const acceptedRow = acceptedBySequence.get(row.canvas_id, row.accepted_sequence)
      if (acceptedRow === undefined) throw new Error("accepted retry target is missing")
      const stored = Schema.decodeUnknownSync(AcceptedRow, { onExcessProperty: "error" })(acceptedRow)
      return Result.succeed({ disposition: "identical-retry", change: readAccepted(stored) })
    }
    if (row.rejected_failure_json === null) throw new Error("stored retry outcome is missing")
    return Result.fail(decodeStored(ChangeRejected, row.rejected_failure_json))
  }

  const evaluate = (proposal: ProposedCanvasChange, invocation: VerifiedInvocation) => {
    const retry = retryDecision(proposal, invocation)
    if (retry !== undefined) return Evaluation.decision({ decision: retry })
    const canvas = readCanvas(database, canvasById, proposal.canvasId)
    if (canvas === undefined) return Evaluation.decision({ decision: Result.fail(
      AuthorityFailure.canvasNotFound({ canvasId: proposal.canvasId })
    ) })
    if (proposal.observedCursor !== null) {
      const known = proposal.observedCursor === canvas.genesisCursor || database.prepare(
        "SELECT 1 AS found FROM accepted_changes WHERE canvas_id = ? AND cursor = ?"
      ).get(proposal.canvasId, proposal.observedCursor) !== undefined
      if (!known) return Evaluation.decision({ decision: Result.fail(
        AuthorityFailure.cursorNotFound({ canvasId: proposal.canvasId, cursor: proposal.observedCursor })
      ) })
    }
    return Evaluation.engine({ canvas, result: CanvasEngine.apply(canvas.view.projection, proposal) })
  }

  const create: CanvasAuthority["create"] = (command: CreateCanvas, invocation: VerifiedInvocation) => Effect.suspend(() => {
    const ownedCommand = structuredClone(command)
    const ownedInvocation = structuredClone(invocation)
    return writer.withPermits(1)(Effect.gen(function*() {
      if (readCanvas(database, canvasById, ownedCommand.canvasId) !== undefined) {
        return yield* Effect.fail(AuthorityFailure.canvasAlreadyExists({ canvasId: ownedCommand.canvasId }))
      }
      const createdAt = yield* now
      const projection = emptyCanvasProjection(ownedCommand.canvasId, ownedCommand.title)
      const genesisCursor = cursorAt(ownedCommand.canvasId, 0)
      return yield* transaction(() => {
            if (readCanvas(database, canvasById, ownedCommand.canvasId) !== undefined) {
              return Result.fail(AuthorityFailure.canvasAlreadyExists({ canvasId: ownedCommand.canvasId }))
            }
            const createdBy = attribution(ownedInvocation)
            database.prepare(`INSERT INTO canvases
              (canvas_id, created_at, created_by_json, genesis_cursor, current_cursor, current_sequence, projection_json)
              VALUES (?, ?, ?, ?, ?, 0, ?)`
            ).run(ownedCommand.canvasId, createdAt, encodeStored(AcceptedAttribution, createdBy), genesisCursor, genesisCursor,
              encodeStored(CanvasProjection, projection))
            return Result.succeed(AuthorityView.make({ canvasId: ownedCommand.canvasId, createdAt, createdBy, cursor: genesisCursor, projection }))
      }).pipe(Effect.flatMap((result) => result._tag === "Success" ? Effect.succeed(result.success) : Effect.fail(result.failure)))
    }))
  })

  const open: CanvasAuthority["open"] = (canvasId) => Effect.sync(() => readCanvas(database, canvasById, canvasId)).pipe(
    Effect.flatMap((canvas) => canvas === undefined
      ? Effect.fail(AuthorityFailure.canvasNotFound({ canvasId }))
      : Effect.succeed(structuredClone(canvas.view)))
  )

  const submit: CanvasAuthority["submit"] = (proposal, invocation) => Effect.suspend(() => {
    const ownedProposal = structuredClone(proposal)
    const ownedInvocation = structuredClone(invocation)
    return writer.withPermits(1)(Effect.gen(function*() {
    const preflight = evaluate(ownedProposal, ownedInvocation)
    if (preflight._tag === "decision") {
      return yield* preflight.decision._tag === "Success"
        ? Effect.succeed(structuredClone(preflight.decision.success))
        : Effect.fail(preflight.decision.failure)
    }
    const acceptedAt = preflight.result._tag === "applied" ? yield* now : undefined
    const decision = yield* transaction((): SubmitDecision => {
        const durable = evaluate(ownedProposal, ownedInvocation)
        if (durable._tag === "decision") {
          return durable.decision
        }
        if (durable.result._tag === "rejected") {
          const failure = AuthorityFailure.changeRejected({
            canvasId: ownedProposal.canvasId, changeId: ownedProposal.changeId, failure: durable.result.failure
          })
          database.prepare(`INSERT INTO retry_reservations
            (canvas_id, change_id, proposal_json, authorization_subject, accepted_sequence, rejected_failure_json)
            VALUES (?, ?, ?, ?, NULL, ?)`
          ).run(ownedProposal.canvasId, ownedProposal.changeId, json(ChangeProtocol.proposed.encode(ownedProposal)),
            ownedInvocation.principal.subject, encodeStored(ChangeRejected, failure))
          return Result.fail(failure)
        }
        if (acceptedAt === undefined) throw new Error("durable acceptance was not clocked")
        const sequence = durable.canvas.row.current_sequence + 1
        const cursor = cursorAt(ownedProposal.canvasId, sequence)
        const change: AcceptedCanvasChange = {
          ...ownedProposal, sequence: ProtocolValue.sequence(sequence), cursor, acceptedAt, attribution: attribution(ownedInvocation)
        }
        database.prepare(`INSERT INTO accepted_changes
          (canvas_id, sequence, change_id, cursor, change_json) VALUES (?, ?, ?, ?, ?)`
        ).run(ownedProposal.canvasId, sequence, ownedProposal.changeId, cursor, json(ChangeProtocol.accepted.encode(change)))
        database.prepare(`INSERT INTO retry_reservations
          (canvas_id, change_id, proposal_json, authorization_subject, accepted_sequence, rejected_failure_json)
          VALUES (?, ?, ?, ?, ?, NULL)`
        ).run(ownedProposal.canvasId, ownedProposal.changeId, json(ChangeProtocol.proposed.encode(ownedProposal)),
          ownedInvocation.principal.subject, sequence)
        database.prepare(`UPDATE canvases SET current_cursor = ?, current_sequence = ?, projection_json = ?
          WHERE canvas_id = ?`
        ).run(cursor, sequence, encodeStored(CanvasProjection, durable.result.projection), ownedProposal.canvasId)
        return Result.succeed({ disposition: "first-acceptance", change })
    })
    return yield* decision._tag === "Success"
      ? Effect.succeed(structuredClone(decision.success))
      : Effect.fail(decision.failure)
    }))
  })

  const changesAfter: CanvasAuthority["changesAfter"] = (query: ChangesAfter) => Effect.sync(() => {
    const canvas = readCanvas(database, canvasById, query.canvasId)
    if (canvas === undefined) return Result.fail(AuthorityFailure.canvasNotFound({ canvasId: query.canvasId }))
    let position = 0
    if (query.after !== null) {
      if (query.after === canvas.genesisCursor) position = 0
      else {
        const found = database.prepare("SELECT sequence FROM accepted_changes WHERE canvas_id = ? AND cursor = ?")
          .get(query.canvasId, query.after)
        if (found === undefined) return Result.fail(AuthorityFailure.cursorNotFound({ canvasId: query.canvasId, cursor: query.after }))
        position = Schema.decodeUnknownSync(Schema.Struct({ sequence: Schema.Number }))(found).sequence
      }
    }
    const rows = database.prepare(`SELECT * FROM accepted_changes WHERE canvas_id = ? AND sequence > ?
      ORDER BY sequence LIMIT ?`).all(query.canvasId, position, query.limit)
    const changes = rows.map((row) => readAccepted(
      Schema.decodeUnknownSync(AcceptedRow, { onExcessProperty: "error" })(row)
    ))
    const cursor = changes.at(-1)?.cursor ?? query.after ?? canvas.genesisCursor
    const page: ChangePage = {
      canvasId: query.canvasId, after: query.after, changes, cursor,
      hasMore: position + changes.length < canvas.row.current_sequence
    }
    return Result.succeed(page)
  }).pipe(Effect.flatMap((result) => result._tag === "Success"
    ? Effect.succeed(structuredClone(result.success))
    : Effect.fail(result.failure)))

  return { create, open, submit, changesAfter }
})
