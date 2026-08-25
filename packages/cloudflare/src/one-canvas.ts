import {
  AuthorityFailure,
  AuthorityView,
  CursorNotFound,
  type AuthorityClock,
  type ChangesAfter,
  type SubmitCanvasChangeFailure,
  type VerifiedInvocation
} from "@crit/authority"
import {
  AuthorityPolicy,
  type RetryRecord,
  type SubmitDecision
} from "@crit/authority/adapter"
import { DomainValue, type ChangeId } from "@crit/domain"
import type {
  AcceptedCanvasChange,
  ChangePage,
  Cursor,
  ProposedCanvasChange,
  SubmitChangeReceipt
} from "@crit/protocol"
import { Effect, Result, SynchronizedRef } from "effect"

export interface OneCanvasLedger {
  readonly view: AuthorityView
  readonly genesisCursor: Cursor
  readonly changes: readonly AcceptedCanvasChange[]
  readonly cursorPositions: ReadonlyMap<Cursor, number>
  readonly retries: ReadonlyMap<ChangeId, RetryRecord>
}

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

export const makeOneCanvas = (args: {
  readonly view: AuthorityView
  readonly clock: AuthorityClock["Service"]
}): OneCanvas => {
  const ledger = SynchronizedRef.makeUnsafe<OneCanvasLedger>({
    view: args.view,
    genesisCursor: args.view.cursor,
    changes: [],
    cursorPositions: new Map([[args.view.cursor, 0]]),
    retries: new Map()
  })

  const open: OneCanvas["open"] = () => SynchronizedRef.get(ledger).pipe(
    Effect.map((current) => DomainValue.detach(current.view))
  )

  const submit: OneCanvas["submit"] = (proposal, invocation) =>
    SynchronizedRef.modifyEffect(ledger, (current) => {
      const boundProposal: ProposedCanvasChange = {
        canvasId: current.view.canvasId,
        ...proposal
      }
      const retry = AuthorityPolicy.evaluateRetry({
        proposal: boundProposal,
        invocation,
        prior: current.retries.get(boundProposal.changeId)
      })
      if (retry._tag === "decided") return Effect.succeed([retry.decision, current] as const)
      const fresh = AuthorityPolicy.evaluateFresh({
        proposal: boundProposal,
        invocation,
        projection: current.view.projection,
        observedCursorKnown: boundProposal.observedCursor === null ||
          current.cursorPositions.has(boundProposal.observedCursor)
      })
      if (fresh._tag === "decided") return Effect.succeed([fresh.decision, current] as const)
      if (fresh._tag === "rejected") {
        return Effect.succeed([fresh.decision, {
          ...current,
          retries: new Map(current.retries).set(boundProposal.changeId, fresh.retry)
        }] as const)
      }
      return args.clock.now.pipe(Effect.map((acceptedAt): readonly [SubmitDecision, OneCanvasLedger] => {
        const accepted = AuthorityPolicy.completeAcceptance({
          candidate: fresh.candidate,
          acceptedAt,
          position: current.changes.length + 1
        })
        return [Result.succeed(accepted.receipt), {
          view: AuthorityView.make({
            ...current.view,
            cursor: accepted.receipt.change.cursor,
            projection: accepted.projection
          }),
          genesisCursor: current.genesisCursor,
          changes: [...current.changes, accepted.receipt.change],
          cursorPositions: new Map(current.cursorPositions).set(
            accepted.receipt.change.cursor,
            accepted.receipt.change.sequence
          ),
          retries: new Map(current.retries).set(boundProposal.changeId, accepted.retry)
        }]
      }))
    }).pipe(Effect.flatMap(AuthorityPolicy.decisionEffect))

  const changesAfter: OneCanvas["changesAfter"] = (query) =>
    SynchronizedRef.get(ledger).pipe(
      Effect.flatMap((current) => {
        let position = 0
        if (query.after !== null) {
          const knownPosition = current.cursorPositions.get(query.after)
          if (knownPosition === undefined) {
            return Effect.fail(AuthorityFailure.cursorNotFound({
              canvasId: current.view.canvasId,
              cursor: query.after
            }))
          }
          position = knownPosition
        }
        const changes = current.changes.slice(position, position + query.limit)
        return Effect.succeed(DomainValue.detach(AuthorityPolicy.makeChangePage({
          query: {
            canvasId: current.view.canvasId,
            ...query
          },
          genesisCursor: current.genesisCursor,
          position,
          total: current.changes.length,
          changes
        })))
      })
    )

  return { open, submit, changesAfter }
}
