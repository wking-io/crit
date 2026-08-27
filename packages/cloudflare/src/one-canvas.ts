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
import { Context, Data, Effect, Layer, Result, Schema } from "effect"
import type { SqlError } from "effect/unstable/sql/SqlError"

import type { DurableSqlite } from "./durable-sqlite.js"
import {
  decodeStored,
  encodeDurableSqlText,
  encodeStored
} from "./stored-json.js"

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
const SequenceRow = Schema.Struct({ sequence: Schema.Number })

const encodeProtocol = (value: Schema.Json) =>
  encodeDurableSqlText(JSON.stringify(value))
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
  readonly sqlite: DurableSqlite
  readonly clock: AuthorityClock["Service"]
}) => {
  const sql = args.sqlite.sql

  const readCanvas = (): Effect.Effect<CanvasRecord | undefined, SqlError> =>
    Effect.gen(function*() {
      const rows = yield* sql`SELECT * FROM canvases`
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
        const heads = yield* sql`SELECT cursor FROM accepted_changes
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
    const rows = yield* sql`SELECT * FROM retry_reservations
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
      const acceptedRows = yield* sql`SELECT * FROM accepted_changes
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
    if (RetryEvaluation.$is("decided")(retry)) return Evaluation.decision({ decision: retry.decision })
    const canvas = yield* readCanvas()
    if (canvas === undefined) throw new Error("one-canvas database is missing its Canvas")
    let observedCursorKnown = proposal.observedCursor === null || proposal.observedCursor === canvas.genesisCursor
    if (!observedCursorKnown && proposal.observedCursor !== null) {
      const knownRows = yield* sql`
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
    if (FreshEvaluation.$is("decided")(fresh)) return Evaluation.decision({ decision: fresh.decision })
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
      if (Evaluation.$is("decision")(preflight)) {
        return yield* AuthorityPolicy.decisionEffect(preflight.decision)
      }
      const acceptedAt = FreshEvaluation.$is("acceptance")(preflight.evaluation)
        ? yield* args.clock.now
        : undefined
      const decision = yield* args.sqlite.transact(Effect.gen(function*() {
        const durable = yield* evaluate(boundProposal, ownedInvocation)
        if (Evaluation.$is("decision")(durable)) return durable.decision
        if (FreshEvaluation.$is("rejected")(durable.evaluation)) {
          const rejected = durable.evaluation.retry.outcome
          if (Result.isSuccess(rejected)) {
            throw new Error("rejected retry contains an accepted change")
          }
          const failure = rejected.failure
          const proposalJson = yield* encodeProtocol(
            ChangeProtocol.proposed.encode(durable.evaluation.retry.identity.proposal)
          )
          const rejectedFailureJson = yield* encodeStored(ChangeRejected, failure)
          yield* sql`INSERT INTO retry_reservations
            (canvas_id, change_id, proposal_json, authorization_subject, accepted_sequence, rejected_failure_json)
            VALUES (${args.canvasId}, ${boundProposal.changeId},
              ${proposalJson},
              ${durable.evaluation.retry.identity.authorizationSubject},
              NULL, ${rejectedFailureJson})`
          return Result.fail(failure)
        }
        if (acceptedAt === undefined) throw new Error("durable acceptance was not clocked")
        const accepted = AuthorityPolicy.completeAcceptance({
          candidate: durable.evaluation.candidate,
          acceptedAt,
          position: durable.canvas.row.current_sequence + 1
        })
        const change = accepted.receipt.change
        const changeJson = yield* encodeProtocol(ChangeProtocol.accepted.encode(change))
        const proposalJson = yield* encodeProtocol(
          ChangeProtocol.proposed.encode(accepted.retry.identity.proposal)
        )
        const projectionJson = yield* encodeStored(CanvasProjection, accepted.projection)
        yield* sql`INSERT INTO accepted_changes
          (canvas_id, sequence, change_id, cursor, change_json)
          VALUES (${args.canvasId}, ${change.sequence}, ${boundProposal.changeId}, ${change.cursor},
            ${changeJson})`
        yield* sql`INSERT INTO retry_reservations
          (canvas_id, change_id, proposal_json, authorization_subject, accepted_sequence, rejected_failure_json)
          VALUES (${args.canvasId}, ${boundProposal.changeId},
            ${proposalJson},
            ${accepted.retry.identity.authorizationSubject}, ${change.sequence}, NULL)`
        yield* sql`UPDATE canvases SET current_cursor = ${change.cursor}, current_sequence = ${change.sequence},
          projection_json = ${projectionJson}
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
        const positions = yield* sql`SELECT sequence FROM accepted_changes
          WHERE canvas_id = ${args.canvasId} AND cursor = ${boundQuery.after}`
        if (positions.length === 0) {
          return yield* Effect.fail(AuthorityFailure.cursorNotFound({
            canvasId: args.canvasId,
            cursor: boundQuery.after
          }))
        }
        position = Schema.decodeUnknownSync(SequenceRow)(positions[0]).sequence
      }
      const rows = yield* sql`SELECT * FROM accepted_changes
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
  readonly sqlite: DurableSqlite
  readonly clock: AuthorityClock["Service"]
}) => Effect.gen(function*() {
  const bound = bindDatabase(args)
  const canvas = yield* bound.readCanvas().pipe(Effect.orDie)
  if (canvas === undefined) {
    return yield* Effect.fail(AuthorityFailure.canvasNotFound({ canvasId: args.canvasId }))
  }
  return bound.oneCanvas
})

export class OneCanvasLoader extends Context.Service<OneCanvasLoader, {
  readonly open: typeof makeOneCanvas
}>()("@crit/cloudflare/OneCanvasLoader") {
  static readonly layer = Layer.succeed(OneCanvasLoader, {
    open: makeOneCanvas
  })
}

export const createOneCanvas = (args: {
  readonly view: AuthorityView
  readonly sqlite: DurableSqlite
  readonly clock: AuthorityClock["Service"]
}) => Effect.gen(function*() {
  const bound = bindDatabase({
    canvasId: args.view.canvasId,
    sqlite: args.sqlite,
    clock: args.clock
  })
  yield* args.sqlite.transact(Effect.gen(function*() {
    const existing = yield* bound.readCanvas()
    if (existing !== undefined) {
      return yield* Effect.fail(AuthorityFailure.canvasAlreadyExists({
        canvasId: args.view.canvasId
      }))
    }
    const createdByJson = yield* encodeStored(AcceptedAttribution, args.view.createdBy)
    const projectionJson = yield* encodeStored(CanvasProjection, args.view.projection)
    yield* args.sqlite.sql`INSERT INTO canvases
      (canvas_id, created_at, created_by_json, genesis_cursor, current_cursor, current_sequence, projection_json)
      VALUES (${args.view.canvasId}, ${args.view.createdAt}, ${createdByJson},
        ${args.view.cursor}, ${args.view.cursor}, 0, ${projectionJson})`
  })).pipe(
    Effect.catchTag("SqlError", Effect.die),
    Effect.catchTag("DurableSqlRowLimitExceeded", Effect.die)
  )
  return bound.oneCanvas
})
