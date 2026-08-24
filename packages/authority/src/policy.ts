import {
  type AcceptedAttribution,
  AgentAttribution,
  CanvasEngine,
  type CanvasId,
  type CanvasProjection,
  DomainValue,
  type IsoTimestamp,
  PersonAttribution,
  emptyCanvasProjection
} from "@crit/domain"
import {
  type AcceptedCanvasChange,
  ChangeValue,
  type ChangePage,
  type Cursor,
  ProtocolValue,
  type ProposedCanvasChange,
  type SubmitChangeReceipt
} from "@crit/protocol"
import { Data, Effect, Result } from "effect"

import {
  AuthorityFailure,
  AuthorityView,
  type ChangeRejected,
  type ChangesAfter,
  type CreateCanvas,
  type SubmitCanvasChangeFailure,
  type VerifiedInvocation
} from "./model.js"

export interface RetryIdentity {
  readonly proposal: ProposedCanvasChange
  readonly authorizationSubject: VerifiedInvocation["principal"]["subject"]
}

export interface RetryRecord {
  readonly identity: RetryIdentity
  readonly outcome: Result.Result<AcceptedCanvasChange, ChangeRejected>
}

export type SubmitDecision = Result.Result<SubmitChangeReceipt, SubmitCanvasChangeFailure>

export type RetryEvaluation = Data.TaggedEnum<{
  readonly fresh: {}
  readonly decided: { readonly decision: SubmitDecision }
}>
export const RetryEvaluation = Data.taggedEnum<RetryEvaluation>()

export interface AcceptanceCandidate {
  readonly proposal: ProposedCanvasChange
  readonly attribution: AcceptedAttribution
  readonly projection: CanvasProjection
  readonly identity: RetryIdentity
}

export type FreshEvaluation = Data.TaggedEnum<{
  readonly decided: { readonly decision: SubmitDecision }
  readonly rejected: { readonly decision: SubmitDecision; readonly retry: RetryRecord }
  readonly acceptance: { readonly candidate: AcceptanceCandidate }
}>
export const FreshEvaluation = Data.taggedEnum<FreshEvaluation>()

const attribution = (invocation: VerifiedInvocation): AcceptedAttribution => invocation._tag === "person"
  ? PersonAttribution.make({ person: invocation.principal.person })
  : AgentAttribution.make(invocation.reportedRuntime === undefined ? {
      agent: invocation.principal.agent,
      delegatedBy: invocation.principal.delegatedBy,
      executionId: invocation.executionId
    } : {
      agent: invocation.principal.agent,
      delegatedBy: invocation.principal.delegatedBy,
      executionId: invocation.executionId,
      reportedRuntime: invocation.reportedRuntime
    })

const cursorAt = (canvasId: CanvasId, position: number): Cursor =>
  ProtocolValue.cursor(`cursor_${canvasId}_${position}`)

const retryIdentity = (proposal: ProposedCanvasChange, invocation: VerifiedInvocation): RetryIdentity => ({
  proposal,
  authorizationSubject: invocation.principal.subject
})

const sameRetryIdentity = (left: RetryIdentity, right: RetryIdentity): boolean =>
  ChangeValue.proposedEquals(left.proposal, right.proposal) &&
  left.authorizationSubject === right.authorizationSubject

const createCanvas = (args: {
  readonly command: CreateCanvas
  readonly invocation: VerifiedInvocation
  readonly createdAt: IsoTimestamp
}) => {
  const cursor = cursorAt(args.command.canvasId, 0)
  const projection = emptyCanvasProjection(args.command.canvasId, args.command.title)
  return AuthorityView.make({
    canvasId: args.command.canvasId,
    createdAt: args.createdAt,
    createdBy: attribution(args.invocation),
    cursor,
    projection
  })
}

const evaluateRetry = (args: {
  readonly proposal: ProposedCanvasChange
  readonly invocation: VerifiedInvocation
  readonly prior: RetryRecord | undefined
}): RetryEvaluation => {
  if (args.prior === undefined) return RetryEvaluation.fresh()
  if (!sameRetryIdentity(args.prior.identity, retryIdentity(args.proposal, args.invocation))) {
    return RetryEvaluation.decided({ decision: Result.fail(AuthorityFailure.changeIdReused({
      canvasId: args.proposal.canvasId,
      changeId: args.proposal.changeId
    })) })
  }
  return RetryEvaluation.decided({
    decision: args.prior.outcome._tag === "Success"
      ? Result.succeed({ disposition: "identical-retry", change: args.prior.outcome.success })
      : Result.fail(args.prior.outcome.failure)
  })
}

const evaluateFresh = (args: {
  readonly proposal: ProposedCanvasChange
  readonly invocation: VerifiedInvocation
  readonly projection: CanvasProjection
  readonly observedCursorKnown: boolean
}): FreshEvaluation => {
  if (args.proposal.observedCursor !== null && !args.observedCursorKnown) {
    return FreshEvaluation.decided({ decision: Result.fail(AuthorityFailure.cursorNotFound({
      canvasId: args.proposal.canvasId,
      cursor: args.proposal.observedCursor
    })) })
  }
  const identity = retryIdentity(args.proposal, args.invocation)
  const result = CanvasEngine.apply(args.projection, args.proposal)
  if (result._tag === "rejected") {
    const failure = AuthorityFailure.changeRejected({
      canvasId: args.proposal.canvasId,
      changeId: args.proposal.changeId,
      failure: result.failure
    })
    return FreshEvaluation.rejected({
      decision: Result.fail(failure),
      retry: { identity, outcome: Result.fail(failure) }
    })
  }
  return FreshEvaluation.acceptance({
    candidate: {
      proposal: args.proposal,
      attribution: attribution(args.invocation),
      projection: result.projection,
      identity
    }
  })
}

const completeAcceptance = (args: {
  readonly candidate: AcceptanceCandidate
  readonly acceptedAt: IsoTimestamp
  readonly position: number
}) => {
  const sequence = ProtocolValue.sequence(args.position)
  const cursor = cursorAt(args.candidate.proposal.canvasId, sequence)
  const change: AcceptedCanvasChange = {
    ...args.candidate.proposal,
    sequence,
    cursor,
    acceptedAt: args.acceptedAt,
    attribution: args.candidate.attribution
  }
  const receipt: SubmitChangeReceipt = { disposition: "first-acceptance", change }
  const retry: RetryRecord = {
    identity: args.candidate.identity,
    outcome: Result.succeed(change)
  }
  return { receipt, retry, projection: args.candidate.projection }
}

const makeChangePage = (args: {
  readonly query: ChangesAfter
  readonly genesisCursor: Cursor
  readonly position: number
  readonly total: number
  readonly changes: readonly AcceptedCanvasChange[]
}): ChangePage => ({
  canvasId: args.query.canvasId,
  after: args.query.after,
  changes: args.changes,
  cursor: args.changes.at(-1)?.cursor ?? args.query.after ?? args.genesisCursor,
  hasMore: args.position + args.changes.length < args.total
})

const decisionEffect = (
  decision: SubmitDecision
): Effect.Effect<SubmitChangeReceipt, SubmitCanvasChangeFailure> => decision._tag === "Success"
  ? Effect.succeed(DomainValue.detach(decision.success))
  : Effect.fail(decision.failure)

export const AuthorityPolicy = {
  createCanvas,
  evaluateRetry,
  evaluateFresh,
  completeAcceptance,
  makeChangePage,
  decisionEffect
}
