import { type AuthorityView, type ChangeRejected } from "@crit/authority"
import {
  CanvasEngine,
  ChangeId
} from "@crit/domain"
import {
  ChangeValue,
  type ChangePage,
  type ProposedCanvasChange,
  type SubmitChangeReceipt
} from "@crit/protocol"
import { Match, Result, Schema } from "effect"

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
const active = (record: PendingRecord) => record.state._tag === "ready" || record.state._tag === "accepted-unconfirmed"

const pendingAuthor = (invocation: PendingRecord["invocation"]): PendingAuthor =>
  Match.value(invocation).pipe(Match.tagsExhaustive({
    person: ({ principal }) => PersonPendingAuthor.make({ displayName: principal.person.displayName }),
    agent: ({ principal, executionId, reportedRuntime }) =>
      AgentPendingAuthor.make({
        displayName: principal.agent.displayName,
        runBy: principal.delegatedBy.displayName,
        executionId,
        ...(reportedRuntime === undefined ? {} : { reportedRuntime })
      })
  }))

const rebuild = (state: ReplicaState) => {
  const replay = CanvasEngine.replay(state.genesisProjection, state.accepted)
  if (replay._tag === "replay-failed") return Result.fail(new ReplicaInvariantFailure({
    canvasId: state.canvasId,
    reason: `accepted history failed at ${replay.failure._tag}`
  }))
  let projection = replay.projection
  const statuses = new Map<ChangeId, PendingRecord["state"]>()
  const pending: PendingRecord[] = []
  for (const record of state.pending) {
    const blockedBy = record.dependencies.filter((id) => {
      const status = statuses.get(id)
      return status?._tag === "conflicted" || status?._tag === "blocked"
    })
    if (blockedBy.length > 0) {
      const next = { ...record, state: Blocked.make({ blockedBy: decodeNonEmptyChangeIds(blockedBy) }) }
      pending.push(next)
      statuses.set(record.proposal.changeId, next.state)
      continue
    }
    if (record.state._tag === "conflicted") {
      pending.push(record)
      statuses.set(record.proposal.changeId, record.state)
      continue
    }
    const applied = CanvasEngine.apply(projection, record.proposal)
    if (applied._tag === "rejected") {
      const next = { ...record, state: Conflicted.make({ failure: applied.failure }) }
      pending.push(next)
      statuses.set(record.proposal.changeId, next.state)
      continue
    }
    const stateValue = record.state._tag === "accepted-unconfirmed" ? record.state : Ready.make({})
    const next = { ...record, state: stateValue }
    pending.push(next)
    statuses.set(record.proposal.changeId, next.state)
    projection = applied.projection
  }
  return Result.succeed({ state: { ...state, pending }, projection })
}

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

const enqueue = (state: ReplicaState, input: ReplicaChange, invocation: PendingRecord["invocation"], changeId: ChangeId) => {
  if (state.pending.some((record) => record.proposal.changeId === changeId) || state.accepted.some((change) => change.changeId === changeId)) {
    return Result.fail(new ChangeIdAlreadyPresent({ canvasId: state.canvasId, changeId }))
  }
  const current = rebuild(state)
  if (current._tag === "Failure") return current
  const proposal: ProposedCanvasChange = { changeId, canvasId: input.canvasId, observedCursor: state.acknowledgedCursor, commands: input.commands }
  const onAcknowledged = CanvasEngine.replay(state.genesisProjection, state.accepted)
  if (onAcknowledged._tag === "replay-failed") return Result.fail(new ReplicaInvariantFailure({ canvasId: state.canvasId, reason: "accepted history is invalid" }))
  const acknowledgedResult = CanvasEngine.apply(onAcknowledged.projection, proposal)
  const optimisticResult = CanvasEngine.apply(current.success.projection, proposal)
  if (optimisticResult._tag === "rejected") return Result.fail(new LocalChangeRejected({ canvasId: state.canvasId, changeId, failure: optimisticResult.failure }))
  const dependencies = acknowledgedResult._tag === "applied" ? [] : state.pending.filter(active).map((record) => record.proposal.changeId)
  const next = { ...state, pending: [...current.success.state.pending, { proposal, invocation, dependencies, state: Ready.make({}) }] }
  return Result.succeed(next)
}

const incorporatePage = (state: ReplicaState, page: ChangePage) => {
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
  return rebuilt._tag === "Failure" ? rebuilt : Result.succeed({ state: rebuilt.success.state, pulled, acknowledged })
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

const rejection = (state: ReplicaState, value: ChangeRejected) => {
  const pending = state.pending.map((record) => record.proposal.changeId === value.changeId
    ? { ...record, state: Conflicted.make({ failure: value.failure }) }
    : record)
  const rebuilt = rebuild({ ...state, pending })
  return rebuilt._tag === "Failure" ? rebuilt : Result.succeed(rebuilt.success.state)
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
