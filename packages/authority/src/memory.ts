import {
  type AcceptedAttribution,
  CanvasCommandBatch,
  CanvasEngine,
  type CanvasId,
  type ChangeId,
  AgentAttribution,
  IsoTimestamp,
  PersonAttribution,
  emptyCanvasProjection
} from "@crit/domain"
import {
  type AcceptedCanvasChange,
  type ChangePage,
  type Cursor,
  ProtocolValue,
  type ProposedCanvasChange,
  type SubmitChangeReceipt
} from "@crit/protocol"
import { Effect, Result, Schema, SynchronizedRef } from "effect"

import {
  AuthorityFailure,
  AuthorityView,
  ChangeRejected,
  CreateCanvas,
  VerifiedInvocation,
  type CanvasAuthority,
  type ChangesAfter,
  type SubmitCanvasChangeFailure
} from "./model.js"
import { AuthorityClock } from "./clock.js"
import { detach } from "./ownership.js"

const commandBatchEquals = Schema.toEquivalence(CanvasCommandBatch)

interface RetryIdentity {
  readonly proposal: ProposedCanvasChange
  readonly authorizationSubject: VerifiedInvocation["principal"]["subject"]
}

type RetryOutcome = Result.Result<SubmitChangeReceipt, ChangeRejected>

interface RetryRecord {
  readonly identity: RetryIdentity
  readonly outcome: RetryOutcome
}

type SubmitDecision = Result.Result<SubmitChangeReceipt, SubmitCanvasChangeFailure>

interface CanvasState {
  readonly view: AuthorityView
  readonly genesisCursor: Cursor
  readonly changes: readonly AcceptedCanvasChange[]
  readonly cursorPositions: ReadonlyMap<Cursor, number>
  readonly retries: ReadonlyMap<ChangeId, RetryRecord>
}

type Registry = ReadonlyMap<CanvasId, SynchronizedRef.SynchronizedRef<CanvasState>>

export interface MemoryCanvasAuthorityOptions {
  readonly now?: Effect.Effect<typeof IsoTimestamp.Type>
}

const attribution = (invocation: VerifiedInvocation): AcceptedAttribution => invocation._tag === "person"
  ? PersonAttribution.make({ person: invocation.principal.person })
  : agentAttribution(invocation)

const agentAttribution = (invocation: Extract<VerifiedInvocation, { readonly _tag: "agent" }>) => {
  const fields = {
    agent: invocation.principal.agent,
    delegatedBy: invocation.principal.delegatedBy,
    oauthClientId: invocation.principal.oauthClientId,
    grantId: invocation.principal.grantId,
    executionId: invocation.executionId
  }
  return invocation.reportedRuntime === undefined
    ? AgentAttribution.make(fields)
    : AgentAttribution.make({ ...fields, reportedRuntime: invocation.reportedRuntime })
}

const cursorAt = (canvasId: CanvasId, position: number): Cursor =>
  ProtocolValue.cursor(`cursor_${canvasId}_${position}`)

const retryEquals = (left: RetryIdentity, right: RetryIdentity): boolean =>
  left.proposal.changeId === right.proposal.changeId &&
  left.proposal.canvasId === right.proposal.canvasId &&
  left.proposal.observedCursor === right.proposal.observedCursor &&
  commandBatchEquals(left.proposal.commands, right.proposal.commands) &&
  left.authorizationSubject === right.authorizationSubject

const failCursor = (canvasId: CanvasId, cursor: Cursor) =>
  Effect.fail(AuthorityFailure.cursorNotFound({ canvasId, cursor }))

const transition = (
  state: CanvasState,
  proposal: ProposedCanvasChange,
  invocation: VerifiedInvocation,
  now: Effect.Effect<typeof IsoTimestamp.Type>
): Effect.Effect<readonly [SubmitDecision, CanvasState]> => {
  const identity = { proposal, authorizationSubject: invocation.principal.subject }
  const prior = state.retries.get(proposal.changeId)
  if (prior !== undefined) {
    if (!retryEquals(prior.identity, identity)) {
      return Effect.succeed([Result.fail(
        AuthorityFailure.changeIdReused({ canvasId: proposal.canvasId, changeId: proposal.changeId })
      ), state])
    }
    return prior.outcome._tag === "Success"
      ? Effect.succeed([Result.succeed({
          disposition: "identical-retry",
          change: prior.outcome.success.change
        }), state])
      : Effect.succeed([Result.fail(prior.outcome.failure), state])
  }
  if (proposal.observedCursor !== null && state.cursorPositions.get(proposal.observedCursor) === undefined) {
    return Effect.succeed([Result.fail(
      AuthorityFailure.cursorNotFound({ canvasId: proposal.canvasId, cursor: proposal.observedCursor })
    ), state])
  }
  const result = CanvasEngine.apply(state.view.projection, proposal)
  if (result._tag === "rejected") {
    const failure = AuthorityFailure.changeRejected({
      canvasId: proposal.canvasId,
      changeId: proposal.changeId,
      failure: result.failure
    })
    const retries = new Map(state.retries).set(proposal.changeId, {
      identity,
      outcome: Result.fail(failure)
    })
    return Effect.succeed([Result.fail(failure), { ...state, retries }])
  }
  return now.pipe(Effect.map((acceptedAt) => {
    const sequence = ProtocolValue.sequence(state.changes.length + 1)
    const cursor = cursorAt(proposal.canvasId, sequence)
    const change: AcceptedCanvasChange = {
      ...proposal,
      sequence,
      cursor,
      acceptedAt,
      attribution: attribution(invocation)
    }
    const receipt: SubmitChangeReceipt = { disposition: "first-acceptance", change }
    const retries = new Map(state.retries).set(proposal.changeId, {
      identity,
      outcome: Result.succeed(receipt)
    })
    return [Result.succeed(receipt), {
      view: AuthorityView.make({
        ...state.view,
        cursor,
        projection: result.projection
      }),
      genesisCursor: state.genesisCursor,
      changes: [...state.changes, change],
      cursorPositions: new Map(state.cursorPositions).set(cursor, sequence),
      retries
    }] as const
  }))
}

export const makeMemoryCanvasAuthority = (
  options: MemoryCanvasAuthorityOptions = {}
): Effect.Effect<CanvasAuthority> => Effect.gen(function*() {
  const registry = yield* SynchronizedRef.make<Registry>(new Map())
  const now = options.now ?? AuthorityClock.now

  const lookup = (canvasId: CanvasId) => SynchronizedRef.get(registry).pipe(
    Effect.flatMap((canvases) => {
      const state = canvases.get(canvasId)
      return state === undefined
        ? Effect.fail(AuthorityFailure.canvasNotFound({ canvasId }))
        : Effect.succeed(state)
    })
  )

  const create: CanvasAuthority["create"] = (command: CreateCanvas, invocation: VerifiedInvocation) =>
    Effect.suspend(() => {
      const ownedCommand = detach(command)
      const ownedInvocation = detach(invocation)
      return SynchronizedRef.modifyEffect(registry, (canvases) => {
        if (canvases.has(ownedCommand.canvasId)) {
          return Effect.fail(AuthorityFailure.canvasAlreadyExists({ canvasId: ownedCommand.canvasId }))
        }
        return now.pipe(Effect.map((createdAt) => {
          const genesisCursor = cursorAt(ownedCommand.canvasId, 0)
          const projection = emptyCanvasProjection(ownedCommand.canvasId, ownedCommand.title)
          const view = AuthorityView.make({
            canvasId: ownedCommand.canvasId,
            createdAt,
            createdBy: attribution(ownedInvocation),
            cursor: genesisCursor,
            projection
          })
          const state = SynchronizedRef.makeUnsafe<CanvasState>({
            view,
            genesisCursor,
            changes: [],
            cursorPositions: new Map([[genesisCursor, 0]]),
            retries: new Map()
          })
          return [detach(view), new Map(canvases).set(ownedCommand.canvasId, state)] as const
        }))
      })
    })

  const open: CanvasAuthority["open"] = (canvasId) => lookup(canvasId).pipe(
    Effect.flatMap(SynchronizedRef.get),
    Effect.map((state) => detach(state.view))
  )

  const submit: CanvasAuthority["submit"] = (proposal, invocation) => Effect.suspend(() => {
    const ownedProposal = detach(proposal)
    const ownedInvocation = detach(invocation)
    return lookup(ownedProposal.canvasId).pipe(
      Effect.flatMap((state) => SynchronizedRef.modifyEffect(state, (current) =>
        transition(current, ownedProposal, ownedInvocation, now))),
      Effect.flatMap((decision) => decision._tag === "Success"
        ? Effect.succeed(detach(decision.success))
        : Effect.fail(decision.failure))
    )
  })

  const changesAfter: CanvasAuthority["changesAfter"] = (query: ChangesAfter) => lookup(query.canvasId).pipe(
    Effect.flatMap(SynchronizedRef.get),
    Effect.flatMap((state) => {
      const requestedCursor = query.after
      let position = 0
      if (requestedCursor !== null) {
        const knownPosition = state.cursorPositions.get(requestedCursor)
        if (knownPosition === undefined) return failCursor(query.canvasId, requestedCursor)
        position = knownPosition
      }
      const changes = state.changes.slice(position, position + query.limit)
      const cursor = changes.at(-1)?.cursor ?? requestedCursor ?? state.genesisCursor
      const page: ChangePage = {
        canvasId: query.canvasId,
        after: query.after,
        changes,
        cursor,
        hasMore: position + changes.length < state.changes.length
      }
      return Effect.succeed(detach(page))
    })
  )

  return { create, open, submit, changesAfter }
})
