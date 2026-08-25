import {
  AuthorityFailure,
  AuthorityView,
  ChangeRejected,
  CursorNotFound,
  type AuthorityClock,
  type ChangesAfter,
  type SubmitCanvasChangeFailure,
  type VerifiedInvocation
} from "@crit/authority"
import {
  AuthorityPolicy,
  type FreshEvaluation,
  type RetryRecord,
  type SubmitDecision
} from "@crit/authority/adapter"
import type { SqliteClient } from "@effect/sql-sqlite-node/SqliteClient"
import {
  AcceptedAttribution,
  AuthSubject,
  CanvasId,
  CanvasProjection,
  ChangeId,
  DomainValue,
  IsoTimestamp
} from "@crit/domain"
import {
  ChangeProtocol,
  ProtocolValue,
  type AcceptedCanvasChange,
  type ChangePage,
  type Cursor,
  type ProposedCanvasChange,
  type ProtocolFailure,
  type SubmitChangeReceipt
} from "@crit/protocol"
import { Data, Effect, Result, Schema } from "effect"
import type { SqlError } from "effect/unstable/sql/SqlError"

import { makeDatabase, retryTransaction } from "./database.js"
import { decodeStored, encodeStored } from "./stored-json.js"

type OneCanvasProposal = Omit<ProposedCanvasChange, "canvasId">
type OneCanvasChangesAfter = Omit<ChangesAfter, "canvasId">

export interface OneCanvas {
  readonly open: () => Effect.Effect<AuthorityView>
  readonly submit: (
    proposal: OneCanvasProposal,
    invocation: VerifiedInvocation
  ) => Effect.Effect<SubmitChangeReceipt, SubmitCanvasChangeFailure>
  readonly changesAfter: (
    query: OneCanvasChangesAfter
  ) => Effect.Effect<ChangePage, CursorNotFound>
}

class StoredProtocolDecodeFailure extends Data.TaggedError("StoredProtocolDecodeFailure")<{
  readonly failure: ProtocolFailure
}> {}

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
const CursorRow = Schema.Struct({ cursor: Schema.String })
const FoundRow = Schema.Struct({ found: Schema.Number })
const SequenceRow = Schema.Struct({ sequence: Schema.Number })

const json = (value: Schema.Json): string => JSON.stringify(value)
const parseJson = (value: string): Schema.Json =>
  Schema.decodeUnknownSync(Schema.Json)(JSON.parse(value))

const decodeProtocol = <A>(
  value: string,
  decode: (input: Schema.Json) => Result.Result<A, ProtocolFailure>
): A => {
  const result = decode(parseJson(value))
  if (Result.isFailure(result)) throw new StoredProtocolDecodeFailure({ failure: result.failure })
  return result.success
}

type CanvasRecord = {
  readonly row: typeof CanvasRow.Type
  readonly genesisCursor: Cursor
  readonly view: typeof AuthorityView.Type
}

type Evaluation = Data.TaggedEnum<{
  readonly decision: { readonly decision: SubmitDecision }
  readonly fresh: {
    readonly canvas: CanvasRecord
    readonly evaluation: Exclude<FreshEvaluation, { readonly _tag: "decided" }>
  }
}>
const Evaluation = Data.taggedEnum<Evaluation>()

const readAccepted = (stored: typeof AcceptedRow.Type): AcceptedCanvasChange => {
  const change = decodeProtocol(stored.change_json, ChangeProtocol.accepted.decode)
  if (
    change.canvasId !== stored.canvas_id ||
    change.changeId !== stored.change_id ||
    change.sequence !== stored.sequence ||
    change.cursor !== stored.cursor
  ) {
    throw new Error("stored accepted change facts disagree")
  }
  return change
}

const bindDatabase = (args: {
  readonly canvasId: typeof CanvasId.Type
  readonly sql: SqliteClient
  readonly clock: AuthorityClock["Service"]
}) => {
  const transaction = <A, R>(body: Effect.Effect<A, SqlError, R>): Effect.Effect<A, SqlError, R> =>
    retryTransaction(args.sql, body)

  const readCanvas = (): Effect.Effect<CanvasRecord | undefined, SqlError> =>
    Effect.gen(function*() {
      const rows = yield* args.sql<typeof CanvasRow.Encoded>`SELECT * FROM canvases`
      if (rows.length === 0) return undefined
      if (rows.length !== 1) throw new Error("one-canvas database contains multiple canvases")
      const row = Schema.decodeUnknownSync(CanvasRow, { onExcessProperty: "error" })(rows[0])
      if (row.canvas_id !== args.canvasId) {
        throw new Error("stored Canvas does not match the bound isolate")
      }
      const createdBy = decodeStored(AcceptedAttribution, row.created_by_json)
      const projection = decodeStored(CanvasProjection, row.projection_json)
      const genesisCursor = ProtocolValue.cursor(row.genesis_cursor)
      const cursor = ProtocolValue.cursor(row.current_cursor)
      if (projection.canvasId !== row.canvas_id || (row.current_sequence === 0 && cursor !== genesisCursor)) {
        throw new Error("stored Canvas checkpoint facts disagree")
      }
      if (row.current_sequence > 0) {
        const heads = yield* args.sql<typeof CursorRow.Encoded>`SELECT cursor FROM accepted_changes
          WHERE canvas_id = ${row.canvas_id} AND sequence = ${row.current_sequence}`
        if (heads.length !== 1) throw new Error("stored Canvas checkpoint head is missing")
        const head = Schema.decodeUnknownSync(CursorRow)(heads[0])
        if (ProtocolValue.cursor(head.cursor) !== cursor) {
          throw new Error("stored Canvas checkpoint is not the ledger head")
        }
      }
      return {
        row,
        genesisCursor,
        view: AuthorityView.make({
          canvasId: row.canvas_id,
          createdAt: row.created_at,
          createdBy,
          cursor,
          projection
        })
      }
    })

  const readRetry = (
    proposal: ProposedCanvasChange
  ): Effect.Effect<RetryRecord | undefined, SqlError> => Effect.gen(function*() {
    const rows = yield* args.sql<typeof RetryRow.Encoded>`SELECT * FROM retry_reservations
      WHERE canvas_id = ${args.canvasId} AND change_id = ${proposal.changeId}`
    if (rows.length === 0) return undefined
    const row = Schema.decodeUnknownSync(RetryRow, { onExcessProperty: "error" })(rows[0])
    const prior = decodeProtocol(row.proposal_json, ChangeProtocol.proposed.decode)
    if (row.canvas_id !== proposal.canvasId || row.change_id !== proposal.changeId) {
      throw new Error("stored retry facts disagree")
    }
    const identity = {
      proposal: prior,
      authorizationSubject: Schema.decodeUnknownSync(AuthSubject)(row.authorization_subject)
    }
    if (row.accepted_sequence !== null) {
      const acceptedRows = yield* args.sql<typeof AcceptedRow.Encoded>`SELECT * FROM accepted_changes
        WHERE canvas_id = ${args.canvasId} AND sequence = ${row.accepted_sequence}`
      if (acceptedRows.length !== 1) throw new Error("accepted retry target is missing")
      const stored = Schema.decodeUnknownSync(AcceptedRow, { onExcessProperty: "error" })(acceptedRows[0])
      return { identity, outcome: Result.succeed(readAccepted(stored)) }
    }
    if (row.rejected_failure_json === null) throw new Error("stored retry outcome is missing")
    return {
      identity,
      outcome: Result.fail(decodeStored(ChangeRejected, row.rejected_failure_json))
    }
  })

  const evaluate = (
    proposal: ProposedCanvasChange,
    invocation: VerifiedInvocation
  ): Effect.Effect<Evaluation, SqlError> => Effect.gen(function*() {
    const retry = AuthorityPolicy.evaluateRetry({
      proposal,
      invocation,
      prior: yield* readRetry(proposal)
    })
    if (retry._tag === "decided") return Evaluation.decision({ decision: retry.decision })
    const canvas = yield* readCanvas()
    if (canvas === undefined) throw new Error("one-canvas database is missing its Canvas")
    let observedCursorKnown = proposal.observedCursor === null || proposal.observedCursor === canvas.genesisCursor
    if (!observedCursorKnown && proposal.observedCursor !== null) {
      const knownRows = yield* args.sql<typeof FoundRow.Encoded>`
        SELECT 1 AS found FROM accepted_changes
        WHERE canvas_id = ${args.canvasId} AND cursor = ${proposal.observedCursor}`
      observedCursorKnown = knownRows.length > 0
    }
    const fresh = AuthorityPolicy.evaluateFresh({
      proposal,
      invocation,
      projection: canvas.view.projection,
      observedCursorKnown
    })
    if (fresh._tag === "decided") return Evaluation.decision({ decision: fresh.decision })
    return Evaluation.fresh({ canvas, evaluation: fresh })
  })

  const open: OneCanvas["open"] = () => readCanvas().pipe(
    Effect.catchTag("SqlError", Effect.die),
    Effect.flatMap((canvas) => canvas === undefined
      ? Effect.die("one-canvas database is missing its Canvas")
      : Effect.succeed(DomainValue.detach(canvas.view)))
  )

  const submit: OneCanvas["submit"] = (proposal, invocation) => Effect.suspend(() => {
    const ownedProposal = DomainValue.detach(proposal)
    const ownedInvocation = DomainValue.detach(invocation)
    const boundProposal: ProposedCanvasChange = {
      canvasId: args.canvasId,
      ...ownedProposal
    }
    return Effect.gen(function*() {
      const preflight = yield* evaluate(boundProposal, ownedInvocation).pipe(Effect.orDie)
      if (preflight._tag === "decision") {
        return yield* AuthorityPolicy.decisionEffect(preflight.decision)
      }
      const acceptedAt = preflight.evaluation._tag === "acceptance"
        ? yield* args.clock.now
        : undefined
      const decision = yield* transaction(Effect.gen(function*() {
        const durable = yield* evaluate(boundProposal, ownedInvocation)
        if (durable._tag === "decision") return durable.decision
        if (durable.evaluation._tag === "rejected") {
          const rejected = durable.evaluation.retry.outcome
          if (rejected._tag === "Success") {
            throw new Error("rejected retry contains an accepted change")
          }
          const failure = rejected.failure
          yield* args.sql`INSERT INTO retry_reservations
            (canvas_id, change_id, proposal_json, authorization_subject, accepted_sequence, rejected_failure_json)
            VALUES (${args.canvasId}, ${boundProposal.changeId},
              ${json(ChangeProtocol.proposed.encode(durable.evaluation.retry.identity.proposal))},
              ${durable.evaluation.retry.identity.authorizationSubject},
              NULL, ${encodeStored(ChangeRejected, failure)})`
          return Result.fail(failure)
        }
        if (acceptedAt === undefined) throw new Error("durable acceptance was not clocked")
        const accepted = AuthorityPolicy.completeAcceptance({
          candidate: durable.evaluation.candidate,
          acceptedAt,
          position: durable.canvas.row.current_sequence + 1
        })
        const change = accepted.receipt.change
        yield* args.sql`INSERT INTO accepted_changes
          (canvas_id, sequence, change_id, cursor, change_json)
          VALUES (${args.canvasId}, ${change.sequence}, ${boundProposal.changeId}, ${change.cursor},
            ${json(ChangeProtocol.accepted.encode(change))})`
        yield* args.sql`INSERT INTO retry_reservations
          (canvas_id, change_id, proposal_json, authorization_subject, accepted_sequence, rejected_failure_json)
          VALUES (${args.canvasId}, ${boundProposal.changeId},
            ${json(ChangeProtocol.proposed.encode(accepted.retry.identity.proposal))},
            ${accepted.retry.identity.authorizationSubject}, ${change.sequence}, NULL)`
        yield* args.sql`UPDATE canvases SET current_cursor = ${change.cursor}, current_sequence = ${change.sequence},
          projection_json = ${encodeStored(CanvasProjection, accepted.projection)}
          WHERE canvas_id = ${args.canvasId}`
        return Result.succeed(accepted.receipt)
      })).pipe(Effect.orDie)
      return yield* AuthorityPolicy.decisionEffect(decision)
    })
  })

  const changesAfter: OneCanvas["changesAfter"] = (query) => Effect.suspend(() => {
    const ownedQuery = DomainValue.detach(query)
    const boundQuery: ChangesAfter = {
      canvasId: args.canvasId,
      ...ownedQuery
    }
    return Effect.gen(function*() {
      const canvas = yield* readCanvas()
      if (canvas === undefined) throw new Error("one-canvas database is missing its Canvas")
      let position = 0
      if (boundQuery.after !== null && boundQuery.after !== canvas.genesisCursor) {
        const positions = yield* args.sql<typeof SequenceRow.Encoded>`SELECT sequence FROM accepted_changes
          WHERE canvas_id = ${args.canvasId} AND cursor = ${boundQuery.after}`
        if (positions.length === 0) {
          return yield* Effect.fail(AuthorityFailure.cursorNotFound({
            canvasId: args.canvasId,
            cursor: boundQuery.after
          }))
        }
        position = Schema.decodeUnknownSync(SequenceRow)(positions[0]).sequence
      }
      const rows = yield* args.sql<typeof AcceptedRow.Encoded>`SELECT * FROM accepted_changes
        WHERE canvas_id = ${args.canvasId} AND sequence > ${position}
        ORDER BY sequence LIMIT ${boundQuery.limit}`
      const changes = rows.map((row) => readAccepted(
        Schema.decodeUnknownSync(AcceptedRow, { onExcessProperty: "error" })(row)
      ))
      return DomainValue.detach(AuthorityPolicy.makeChangePage({
        query: boundQuery,
        genesisCursor: canvas.genesisCursor,
        position,
        total: canvas.row.current_sequence,
        changes
      }))
    }).pipe(Effect.catchTag("SqlError", Effect.die))
  })

  return {
    oneCanvas: { open, submit, changesAfter },
    readCanvas
  }
}

export const makeOneCanvas = (args: {
  readonly canvasId: typeof CanvasId.Type
  readonly path: string
  readonly clock: AuthorityClock["Service"]
}) => Effect.gen(function*() {
  const sql = yield* makeDatabase({ path: args.path })
  const bound = bindDatabase({ canvasId: args.canvasId, sql, clock: args.clock })
  const canvas = yield* bound.readCanvas().pipe(Effect.orDie)
  if (canvas === undefined) {
    return yield* Effect.fail(AuthorityFailure.canvasNotFound({ canvasId: args.canvasId }))
  }
  return bound.oneCanvas
})

export const createOneCanvas = (args: {
  readonly view: AuthorityView
  readonly path: string
  readonly clock: AuthorityClock["Service"]
}) => Effect.gen(function*() {
  const sql = yield* makeDatabase({ path: args.path })
  const bound = bindDatabase({ canvasId: args.view.canvasId, sql, clock: args.clock })
  yield* retryTransaction(sql, Effect.gen(function*() {
    const existing = yield* bound.readCanvas()
    if (existing !== undefined) {
      return yield* Effect.fail(AuthorityFailure.canvasAlreadyExists({
        canvasId: args.view.canvasId
      }))
    }
    yield* sql`INSERT INTO canvases
      (canvas_id, created_at, created_by_json, genesis_cursor, current_cursor, current_sequence, projection_json)
      VALUES (${args.view.canvasId}, ${args.view.createdAt}, ${encodeStored(AcceptedAttribution, args.view.createdBy)},
        ${args.view.cursor}, ${args.view.cursor}, 0, ${encodeStored(CanvasProjection, args.view.projection)})`
  })).pipe(Effect.catchTag("SqlError", Effect.die))
  return bound.oneCanvas
})
