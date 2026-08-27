import { type AuthorityView, type ChangeRejected } from "@crit/authority"
import {
  CanvasEngine,
  ChangeId,
  type CanvasProjection
} from "@crit/domain"
import {
  ChangeValue,
  type ChangePage,
  type ProposedCanvasChange,
  type SubmitChangeReceipt
} from "@crit/protocol"
import { Match, Option, Predicate, Result, Schema } from "effect"

import {
  AcceptedUnconfirmed,
  AgentPendingAuthor,
  Blocked,
  ChangeIdAlreadyPresent,
  Conflicted,
  LocalChangeRejected,
  PersonPendingAuthor,
  Ready,
  ReplicaDiverged,
  ReplicaInvariantFailure,
  ReplicaView,
  type PendingAuthor,
  type PendingRecord,
  type ReplicaChange,
  type ReplicaState
} from "./model.js"

const decodeNonEmptyChangeIds = Schema.decodeUnknownSync(Schema.NonEmptyArray(ChangeId))
const active = (record: PendingRecord) =>
  Predicate.isTagged(record.state, "ready") || Predicate.isTagged(record.state, "acceptedUnconfirmed")

const pendingAuthor = (invocation: PendingRecord["invocation"]): PendingAuthor =>
  Match.value(invocation).pipe(Match.tagsExhaustive({
    person: ({ principal }) => PersonPendingAuthor.make({ displayName: principal.person.displayName }),
    agent: ({ principal, executionId, reportedRuntime }) =>
      reportedRuntime === undefined
        ? AgentPendingAuthor.make({
          displayName: principal.agent.displayName,
          runBy: principal.delegatedBy.displayName,
          executionId
        })
        : AgentPendingAuthor.make({
          displayName: principal.agent.displayName,
          runBy: principal.delegatedBy.displayName,
          executionId,
          reportedRuntime
        })
  }))

const rebuild = (state: ReplicaState): Result.Result<{
  readonly state: ReplicaState
  readonly projection: CanvasProjection
}, ReplicaInvariantFailure> =>
  Match.value(CanvasEngine.replay(state.genesisProjection, state.accepted)).pipe(
    Match.tag("replayFailed", (replay) => Result.fail(new ReplicaInvariantFailure({
      canvasId: state.canvasId,
      reason: `accepted history failed at ${replay.failure._tag}`
    }))),
    Match.orElse((replay) => {
      let projection = replay.projection
      const statuses = new Map<ChangeId, PendingRecord["state"]>()
      const pending: PendingRecord[] = []
      for (const record of state.pending) {
        const blockedBy = record.dependencies.filter((id) => {
          const status = statuses.get(id)
          return Predicate.isTagged(status, "conflicted") || Predicate.isTagged(status, "blocked")
        })
        if (blockedBy.length > 0) {
          const next = { ...record, state: Blocked.make({ blockedBy: decodeNonEmptyChangeIds(blockedBy) }) }
          pending.push(next)
          statuses.set(record.proposal.changeId, next.state)
          continue
        }
        if (Predicate.isTagged(record.state, "conflicted")) {
          pending.push(record)
          statuses.set(record.proposal.changeId, record.state)
          continue
        }
        const applied = CanvasEngine.apply(projection, record.proposal)
        Match.value(applied).pipe(Match.tagsExhaustive({
          rejected: ({ failure }) => {
            const next = { ...record, state: Conflicted.make({ failure }) }
            pending.push(next)
            statuses.set(record.proposal.changeId, next.state)
          },
          applied: ({ projection: nextProjection }) => {
            const stateValue = Predicate.isTagged(record.state, "acceptedUnconfirmed")
              ? record.state
              : Ready.make({})
            const next = { ...record, state: stateValue }
            pending.push(next)
            statuses.set(record.proposal.changeId, next.state)
            projection = nextProjection
          }
        }))
      }
      return Result.succeed({ state: { ...state, pending }, projection })
    })
  )

const view = (state: ReplicaState) => Result.map(rebuild(state), ({ state: rebuilt, projection }) => ReplicaView.make({
  canvasId: rebuilt.canvasId,
  acknowledgedCursor: rebuilt.acknowledgedCursor,
  projection,
  pending: rebuilt.pending.map(({ proposal, invocation, dependencies, state }) => ({
    proposal,
    dependencies,
    state,
    author: pendingAuthor(invocation)
  }))
}))

const initialize = (authority: AuthorityView): ReplicaState => ({
  canvasId: authority.canvasId,
  genesisCursor: authority.cursor,
  genesisProjection: authority.projection,
  acceptedBaseSequence: null,
  acknowledgedCursor: authority.cursor,
  accepted: [],
  pending: []
})

const enqueue = (
  state: ReplicaState,
  input: ReplicaChange,
  invocation: PendingRecord["invocation"],
  changeId: ChangeId
): Result.Result<ReplicaState, ChangeIdAlreadyPresent | ReplicaInvariantFailure | LocalChangeRejected> => {
  if (state.pending.some((record) => record.proposal.changeId === changeId) || state.accepted.some((change) => change.changeId === changeId)) {
    return Result.fail(new ChangeIdAlreadyPresent({ canvasId: state.canvasId, changeId }))
  }
  const current = rebuild(state)
  if (Result.isFailure(current)) return Result.fail(current.failure)
  const proposal: ProposedCanvasChange = { changeId, canvasId: input.canvasId, observedCursor: state.acknowledgedCursor, commands: input.commands }
  const onAcknowledged = CanvasEngine.replay(state.genesisProjection, state.accepted)
  if (Predicate.isTagged(onAcknowledged, "replayFailed")) {
    return Result.fail(new ReplicaInvariantFailure({ canvasId: state.canvasId, reason: "accepted history is invalid" }))
  }
  const acknowledgedResult = CanvasEngine.apply(onAcknowledged.projection, proposal)
  const optimisticResult = CanvasEngine.apply(current.success.projection, proposal)
  const optimisticFailure = Match.value(optimisticResult).pipe(
    Match.tag("rejected", (result) => result.failure),
    Match.option
  )
  if (Option.isSome(optimisticFailure)) {
    return Result.fail(new LocalChangeRejected({ canvasId: state.canvasId, changeId, failure: optimisticFailure.value }))
  }
  const dependencies = Predicate.isTagged(acknowledgedResult, "applied")
    ? []
    : state.pending.filter(active).map((record) => record.proposal.changeId)
  const next = { ...state, pending: [...current.success.state.pending, { proposal, invocation, dependencies, state: Ready.make({}) }] }
  return Result.succeed(next)
}

const incorporatePage = (
  state: ReplicaState,
  page: ChangePage
): Result.Result<{
  readonly state: ReplicaState
  readonly pulled: number
  readonly acknowledged: number
}, ReplicaDiverged | ReplicaInvariantFailure> => {
  if (page.canvasId !== state.canvasId) return Result.fail(new ReplicaDiverged({ canvasId: state.canvasId, reason: "page Canvas does not match replica" }))
  const knownAfter = page.after === state.genesisCursor || state.accepted.some((change) => change.cursor === page.after)
  if (!knownAfter) return Result.fail(new ReplicaDiverged({ canvasId: state.canvasId, reason: "page starts from an unknown cursor" }))
  const expectedPageCursor = page.changes.at(-1)?.cursor ?? page.after
  if (expectedPageCursor !== page.cursor) return Result.fail(new ReplicaDiverged({ canvasId: state.canvasId, reason: "page cursor does not match its accepted tail" }))
  let accepted = [...state.accepted]
  let acceptedBaseSequence = state.acceptedBaseSequence
  let pending = [...state.pending]
  let pulled = 0
  let acknowledged = 0
  for (const change of page.changes) {
    if (acceptedBaseSequence === null) acceptedBaseSequence = change.sequence - 1
    const index = change.sequence - acceptedBaseSequence - 1
    const existing = accepted[index]
    if (existing !== undefined) {
      if (!ChangeValue.acceptedEquals(existing, change)) return Result.fail(new ReplicaDiverged({ canvasId: state.canvasId, reason: `accepted facts differ at sequence ${change.sequence}` }))
    } else {
      if (change.sequence !== acceptedBaseSequence + accepted.length + 1) return Result.fail(new ReplicaDiverged({ canvasId: state.canvasId, reason: `accepted sequence gap at ${change.sequence}` }))
      accepted.push(change)
      pulled += 1
    }
    const local = pending.find((record) => record.proposal.changeId === change.changeId)
    if (local !== undefined) {
      if (!ChangeValue.proposedEquals(local.proposal, ChangeValue.proposalOf(change))) return Result.fail(new ReplicaDiverged({ canvasId: state.canvasId, reason: `self-acceptance differs for ${change.changeId}` }))
      pending = pending.filter((record) => record !== local)
      acknowledged += 1
    }
  }
  const acknowledgedCursor = accepted.at(-1)?.cursor ?? state.genesisCursor
  const rebuilt = rebuild({ ...state, accepted, pending, acknowledgedCursor, acceptedBaseSequence })
  if (Result.isFailure(rebuilt)) return Result.fail(rebuilt.failure)
  return Result.succeed({ state: rebuilt.success.state, pulled, acknowledged })
}

const receipt = (state: ReplicaState, value: SubmitChangeReceipt) => {
  const index = state.pending.findIndex((record) => record.proposal.changeId === value.change.changeId)
  if (index < 0) {
    const accepted = state.acceptedBaseSequence === null
      ? undefined
      : state.accepted[value.change.sequence - state.acceptedBaseSequence - 1]
    return accepted !== undefined && ChangeValue.acceptedEquals(accepted, value.change)
      ? Result.succeed(state)
      : Result.fail(new ReplicaDiverged({ canvasId: state.canvasId, reason: `receipt differs for ${value.change.changeId}` }))
  }
  if (!ChangeValue.proposedEquals(state.pending[index]!.proposal, ChangeValue.proposalOf(value.change))) {
    return Result.fail(new ReplicaDiverged({ canvasId: state.canvasId, reason: `receipt differs for ${value.change.changeId}` }))
  }
  const pending = [...state.pending]
  pending[index] = { ...pending[index]!, state: AcceptedUnconfirmed.make({}) }
  return Result.succeed({ ...state, pending })
}

const rejection = (
  state: ReplicaState,
  value: ChangeRejected
): Result.Result<ReplicaState, ReplicaInvariantFailure> => {
  const pending = state.pending.map((record) => record.proposal.changeId === value.changeId
    ? { ...record, state: Conflicted.make({ failure: value.failure }) }
    : record)
  const rebuilt = rebuild({ ...state, pending })
  if (Result.isFailure(rebuilt)) return Result.fail(rebuilt.failure)
  return Result.succeed(rebuilt.success.state)
}

export const ReplicaPolicy = {
  initialize,
  enqueue,
  incorporatePage,
  receipt,
  rejection,
  rebuild,
  view
}
