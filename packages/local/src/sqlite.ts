import {
  AuthorityFailure,
  AuthorityClock,
  AuthorityView,
  CanvasAuthority,
  ChangeRejected,
  type CreateCanvas,
  type VerifiedInvocation,
  type ChangesAfter
} from "@crit/authority"
import {
  AuthorityPolicy,
  FreshEvaluation,
  RetryEvaluation,
  type RetryRecord,
  type SubmitDecision
} from "@crit/authority/adapter"
import {
  AcceptedAttribution,
  AuthSubject,
  CanvasId,
  CanvasProjection,
  ChangeId,
  DomainValue,
  IsoTimestamp,
} from "@crit/domain"
import {
  ChangeProtocol,
  ProtocolValue,
  type AcceptedCanvasChange,
  type Cursor,
  type ProposedCanvasChange,
  type ProtocolFailure
} from "@crit/protocol"
import { CanvasListing } from "@crit/replica/http"
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient"
import { Context, Data, Effect, Layer, Result, Schema } from "effect"
import type { SqlError } from "effect/unstable/sql/SqlError"

import { LocalDatabaseOpenFailure, localDatabaseLayer, retryTransaction } from "./database.js"
import { decodeStored, encodeStored } from "./stored-json.js"

export { LocalDatabaseOpenFailure }

class StoredProtocolDecodeFailure extends Data.TaggedError("StoredProtocolDecodeFailure")<{
  readonly failure: ProtocolFailure
}> {}

export interface SqliteCanvasAuthorityOptions {
  readonly path: string
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
const CursorRow = Schema.Struct({ cursor: Schema.String })
const FoundRow = Schema.Struct({ found: Schema.Number })
const SequenceRow = Schema.Struct({ sequence: Schema.Number })
const CatalogRow = Schema.Struct({
  canvas_id: CanvasId,
  created_at: IsoTimestamp,
  projection_json: JsonText
})

export class LocalCanvasCatalog extends Context.Service<LocalCanvasCatalog, {
  readonly list: () => Effect.Effect<ReadonlyArray<CanvasListing>>
}>()("@crit/local/LocalCanvasCatalog") {}

const json = (value: Schema.Json): string => JSON.stringify(value)
const parseJson = (value: string): Schema.Json => Schema.decodeUnknownSync(Schema.Json)(JSON.parse(value))

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
  if (change.canvasId !== stored.canvas_id || change.changeId !== stored.change_id ||
      change.sequence !== stored.sequence || change.cursor !== stored.cursor) {
    throw new Error("stored accepted change facts disagree")
  }
  return change
}

const make = () => Effect.gen(function*() {
  const clock = yield* AuthorityClock
  const sql = yield* SqliteClient.SqliteClient
  const transaction = <A, R>(body: Effect.Effect<A, SqlError, R>): Effect.Effect<A, SqlError, R> =>
    retryTransaction(sql, body)

  const readCanvas = (canvasId: typeof CanvasId.Type): Effect.Effect<CanvasRecord | undefined, SqlError> =>
    Effect.gen(function*() {
      const rows = yield* sql<typeof CanvasRow.Encoded>`SELECT * FROM canvases WHERE canvas_id = ${canvasId}`
      if (rows.length === 0) return undefined
      const row = Schema.decodeUnknownSync(CanvasRow, { onExcessProperty: "error" })(rows[0])
      const createdBy = decodeStored(AcceptedAttribution, row.created_by_json)
      const projection = decodeStored(CanvasProjection, row.projection_json)
      const genesisCursor = ProtocolValue.cursor(row.genesis_cursor)
      const cursor = ProtocolValue.cursor(row.current_cursor)
      if (projection.canvasId !== row.canvas_id || (row.current_sequence === 0 && cursor !== genesisCursor)) {
        throw new Error("stored Canvas checkpoint facts disagree")
      }
      if (row.current_sequence > 0) {
        const heads = yield* sql<typeof CursorRow.Encoded>`SELECT cursor FROM accepted_changes
          WHERE canvas_id = ${row.canvas_id} AND sequence = ${row.current_sequence}`
        const head = Schema.decodeUnknownSync(CursorRow)(heads[0])
        if (ProtocolValue.cursor(head.cursor) !== cursor) throw new Error("stored Canvas checkpoint is not the ledger head")
      }
      return { row, genesisCursor, view: AuthorityView.make({
        canvasId: row.canvas_id,
        createdAt: row.created_at,
        createdBy,
        cursor,
        projection
      }) }
    })

  const readRetry = (
    proposal: ProposedCanvasChange,
  ): Effect.Effect<RetryRecord | undefined, SqlError> => Effect.gen(function*() {
    const rows = yield* sql<typeof RetryRow.Encoded>`SELECT * FROM retry_reservations
      WHERE canvas_id = ${proposal.canvasId} AND change_id = ${proposal.changeId}`
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
      const acceptedRows = yield* sql<typeof AcceptedRow.Encoded>`SELECT * FROM accepted_changes
        WHERE canvas_id = ${row.canvas_id} AND sequence = ${row.accepted_sequence}`
      if (acceptedRows.length === 0) throw new Error("accepted retry target is missing")
      const stored = Schema.decodeUnknownSync(AcceptedRow, { onExcessProperty: "error" })(acceptedRows[0])
      return { identity, outcome: Result.succeed(readAccepted(stored)) }
    }
    if (row.rejected_failure_json === null) throw new Error("stored retry outcome is missing")
    return { identity, outcome: Result.fail(decodeStored(ChangeRejected, row.rejected_failure_json)) }
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
    if (RetryEvaluation.$is("decided")(retry)) return Evaluation.decision({ decision: retry.decision })
    const canvas = yield* readCanvas(proposal.canvasId)
    if (canvas === undefined) return Evaluation.decision({ decision: Result.fail(
      AuthorityFailure.canvasNotFound({ canvasId: proposal.canvasId })
    ) })
    let observedCursorKnown = proposal.observedCursor === null || proposal.observedCursor === canvas.genesisCursor
    if (!observedCursorKnown && proposal.observedCursor !== null) {
      const knownRows = yield* sql<typeof FoundRow.Encoded>`
        SELECT 1 AS found FROM accepted_changes
        WHERE canvas_id = ${proposal.canvasId} AND cursor = ${proposal.observedCursor}`
      observedCursorKnown = knownRows.length > 0
    }
    const fresh = AuthorityPolicy.evaluateFresh({
      proposal,
      invocation,
      projection: canvas.view.projection,
      observedCursorKnown
    })
    if (FreshEvaluation.$is("decided")(fresh)) return Evaluation.decision({ decision: fresh.decision })
    return Evaluation.fresh({ canvas, evaluation: fresh })
  })

  const create: CanvasAuthority["Service"]["create"] = (command: CreateCanvas, invocation: VerifiedInvocation) => Effect.suspend(() => {
    const ownedCommand = DomainValue.detach(command)
    const ownedInvocation = DomainValue.detach(invocation)
    return Effect.gen(function*() {
      if ((yield* readCanvas(ownedCommand.canvasId).pipe(Effect.orDie)) !== undefined) {
        return yield* Effect.fail(AuthorityFailure.canvasAlreadyExists({ canvasId: ownedCommand.canvasId }))
      }
      const createdAt = yield* clock.now
      const view = AuthorityPolicy.createCanvas({
        command: ownedCommand,
        invocation: ownedInvocation,
        createdAt
      })
      const decision = yield* transaction(Effect.gen(function*() {
        if ((yield* readCanvas(ownedCommand.canvasId)) !== undefined) {
          return Result.fail(AuthorityFailure.canvasAlreadyExists({ canvasId: ownedCommand.canvasId }))
        }
        yield* sql`INSERT INTO canvases
          (canvas_id, created_at, created_by_json, genesis_cursor, current_cursor, current_sequence, projection_json)
          VALUES (${ownedCommand.canvasId}, ${createdAt}, ${encodeStored(AcceptedAttribution, view.createdBy)},
            ${view.cursor}, ${view.cursor}, 0, ${encodeStored(CanvasProjection, view.projection)})`
        return Result.succeed(view)
      })).pipe(Effect.orDie)
      return yield* Result.isSuccess(decision) ? Effect.succeed(decision.success) : Effect.fail(decision.failure)
    })
  })

  const open: CanvasAuthority["Service"]["open"] = (canvasId) => readCanvas(canvasId).pipe(
    Effect.orDie,
    Effect.flatMap((canvas) => canvas === undefined
      ? Effect.fail(AuthorityFailure.canvasNotFound({ canvasId }))
      : Effect.succeed(canvas.view))
  )

  const submit: CanvasAuthority["Service"]["submit"] = (proposal, invocation) => Effect.suspend(() => {
    const ownedProposal = DomainValue.detach(proposal)
    const ownedInvocation = DomainValue.detach(invocation)
    return Effect.gen(function*() {
      const preflight = yield* evaluate(ownedProposal, ownedInvocation).pipe(Effect.orDie)
      if (Evaluation.$is("decision")(preflight)) {
        return yield* AuthorityPolicy.decisionEffect(preflight.decision)
      }
      const acceptedAt = FreshEvaluation.$is("acceptance")(preflight.evaluation) ? yield* clock.now : undefined
      const decision = yield* transaction(Effect.gen(function*() {
        const durable = yield* evaluate(ownedProposal, ownedInvocation)
        if (Evaluation.$is("decision")(durable)) return durable.decision
        if (FreshEvaluation.$is("rejected")(durable.evaluation)) {
          const rejected = durable.evaluation.retry.outcome
          if (Result.isSuccess(rejected)) throw new Error("rejected retry contains an accepted change")
          const failure = rejected.failure
          yield* sql`INSERT INTO retry_reservations
            (canvas_id, change_id, proposal_json, authorization_subject, accepted_sequence, rejected_failure_json)
            VALUES (${ownedProposal.canvasId}, ${ownedProposal.changeId},
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
        yield* sql`INSERT INTO accepted_changes
          (canvas_id, sequence, change_id, cursor, change_json)
          VALUES (${ownedProposal.canvasId}, ${change.sequence}, ${ownedProposal.changeId}, ${change.cursor},
            ${json(ChangeProtocol.accepted.encode(change))})`
        yield* sql`INSERT INTO retry_reservations
          (canvas_id, change_id, proposal_json, authorization_subject, accepted_sequence, rejected_failure_json)
          VALUES (${ownedProposal.canvasId}, ${ownedProposal.changeId},
            ${json(ChangeProtocol.proposed.encode(accepted.retry.identity.proposal))},
            ${accepted.retry.identity.authorizationSubject}, ${change.sequence}, NULL)`
        yield* sql`UPDATE canvases SET current_cursor = ${change.cursor}, current_sequence = ${change.sequence},
          projection_json = ${encodeStored(CanvasProjection, accepted.projection)}
          WHERE canvas_id = ${ownedProposal.canvasId}`
        return Result.succeed(accepted.receipt)
      })).pipe(Effect.orDie)
      return yield* AuthorityPolicy.decisionEffect(decision)
    })
  })

  const changesAfter: CanvasAuthority["Service"]["changesAfter"] = (query: ChangesAfter) => Effect.gen(function*() {
    const canvas = yield* readCanvas(query.canvasId)
    if (canvas === undefined) return yield* Effect.fail(AuthorityFailure.canvasNotFound({ canvasId: query.canvasId }))
    let position = 0
    if (query.after !== null) {
      if (query.after !== canvas.genesisCursor) {
        const positions = yield* sql<typeof SequenceRow.Encoded>`SELECT sequence FROM accepted_changes
          WHERE canvas_id = ${query.canvasId} AND cursor = ${query.after}`
        if (positions.length === 0) {
          return yield* Effect.fail(AuthorityFailure.cursorNotFound({ canvasId: query.canvasId, cursor: query.after }))
        }
        position = Schema.decodeUnknownSync(SequenceRow)(positions[0]).sequence
      }
    }
    const rows = yield* sql<typeof AcceptedRow.Encoded>`SELECT * FROM accepted_changes
      WHERE canvas_id = ${query.canvasId} AND sequence > ${position}
      ORDER BY sequence LIMIT ${query.limit}`
    const changes = rows.map((row) => readAccepted(
      Schema.decodeUnknownSync(AcceptedRow, { onExcessProperty: "error" })(row)
    ))
    return AuthorityPolicy.makeChangePage({
      query,
      genesisCursor: canvas.genesisCursor,
      position,
      total: canvas.row.current_sequence,
      changes,
    })
  }).pipe(Effect.catchTag("SqlError", Effect.die))

  return { create, open, submit, changesAfter }
})

const makeCatalog = () => Effect.gen(function*() {
  const sql = yield* SqliteClient.SqliteClient
  const list: LocalCanvasCatalog["Service"]["list"] = () => Effect.gen(function*() {
    const rows = yield* sql<typeof CatalogRow.Encoded>`
      SELECT canvas_id, created_at, projection_json FROM canvases
      ORDER BY created_at ASC, canvas_id ASC`
    return rows.map((encoded) => {
      const row = Schema.decodeUnknownSync(CatalogRow, { onExcessProperty: "error" })(encoded)
      const projection = decodeStored(CanvasProjection, row.projection_json)
      if (projection.canvasId !== row.canvas_id) {
        throw new Error("stored Canvas catalog facts disagree")
      }
      return CanvasListing.make({ canvasId: row.canvas_id, title: projection.title })
    })
  }).pipe(Effect.catchTag("SqlError", Effect.die))
  return LocalCanvasCatalog.of({ list })
})

export const SqliteCanvasAuthority = {
  layer: (options: SqliteCanvasAuthorityOptions) => {
    const database = localDatabaseLayer(options)
    return Layer.merge(
      Layer.effect(CanvasAuthority, make()),
      Layer.effect(LocalCanvasCatalog, makeCatalog())
    ).pipe(Layer.provide(database))
  }
}
