import { AuthorityModel, AuthorityView, CanvasAuthority, PersonInvocation } from "@crit/authority"
import { Id, IsoTimestamp, PersonAttribution, decodeCanvasCommandBatch, emptyCanvasProjection } from "@crit/domain"
import { ProtocolValue, type AcceptedCanvasChange, type ChangePage } from "@crit/protocol"
import { Data, Effect, Result, Schema } from "effect"

import { ReplicaModel } from "./model.js"
import { ReplicaPolicy } from "./policy.js"
import { CanvasReplica } from "./service.js"
import { ReplicaStore } from "./store.js"

export class ReplicaConformanceFailure extends Data.TaggedError("ReplicaConformanceFailure")<{
  readonly message: string
}> {}

const requireFact = (condition: boolean, message: string) => condition
  ? Effect.void
  : Effect.fail(new ReplicaConformanceFailure({ message }))
const person = Schema.decodeUnknownSync(PersonInvocation)({
  _tag: "person",
  principal: {
    _tag: "person",
    subject: "oidc|replica-conformance",
    person: {
      _tag: "person",
      personId: "person_replica_conformance",
      displayName: "Replica",
      email: { _tag: "unspecified" }
    }
  }
})
const addFrame = (frameId: string, title: string) => decodeCanvasCommandBatch([{
  _tag: "add-frame", frameId, title,
  representation: { _tag: "application-route", applicationId: "application_replica", route: "/", state: {} },
  status: "in-progress",
  geometry: { x: 0, y: 0, width: 800, height: 600 }
}])

export const ReplicaConformance = {
  basic: Effect.gen(function*() {
    const authority = yield* CanvasAuthority
    const replica = yield* CanvasReplica
    const canvasId = Id.canvas("canvas_replica_conformance")
    yield* authority.create(AuthorityModel.createCanvas({ canvasId, title: "Original" }), person)
    const opened = yield* replica.open(canvasId)
    yield* requireFact(opened.pending.length === 0 && opened.projection.title === "Original", "open did not initialize authority checkpoint")
    const first = yield* replica.change(ReplicaModel.change({
      canvasId,
      commands: decodeCanvasCommandBatch([{ _tag: "rename-canvas", expectedTitle: "Original", title: "First" }])
    }), person)
    const second = yield* replica.change(ReplicaModel.change({
      canvasId,
      commands: decodeCanvasCommandBatch([{ _tag: "rename-canvas", expectedTitle: "First", title: "Second" }])
    }), person)
    yield* requireFact(first.changeId !== second.changeId, "change IDs were not stable and distinct")
    yield* requireFact(second.view.pending[1]?.dependencies[0] === first.changeId, "optimistic-only change did not depend on active prefix")
    const synced = yield* replica.sync(canvasId)
    yield* requireFact(synced.view.pending.length === 0 && synced.view.projection.title === "Second", "sync did not acknowledge ordered pending changes")
    const current = yield* replica.current(canvasId)
    yield* requireFact(current.acknowledgedCursor === synced.view.acknowledgedCursor, "current view lost acknowledged cursor")
  }),
  conflictDependenciesAndIndependent: Effect.gen(function*() {
    const authority = yield* CanvasAuthority
    const replica = yield* CanvasReplica
    const canvasId = Id.canvas("canvas_replica_conformance_conflict")
    const genesis = yield* authority.create(AuthorityModel.createCanvas({ canvasId, title: "Original" }), person)
    yield* replica.open(canvasId)
    const parent = yield* replica.change(ReplicaModel.change({ canvasId, commands: addFrame("frame_conformance_shared", "Local") }), person)
    const child = yield* replica.change(ReplicaModel.change({
      canvasId,
      commands: decodeCanvasCommandBatch([{
        _tag: "set-frame-title", frameId: "frame_conformance_shared",
        expectedChangedByChangeId: parent.changeId, title: "Child"
      }])
    }), person)
    const independent = yield* replica.change(ReplicaModel.change({
      canvasId,
      commands: decodeCanvasCommandBatch([{ _tag: "rename-canvas", expectedTitle: "Original", title: "Independent" }])
    }), person)
    yield* requireFact(independent.view.pending[2]?.dependencies.length === 0, "independent work gained dependencies")
    yield* authority.submit({
      canvasId,
      changeId: Id.change("change_replica_conformance_remote"),
      observedCursor: genesis.cursor,
      commands: addFrame("frame_conformance_shared", "Remote")
    }, person)
    const synced = yield* replica.sync(canvasId)
    yield* requireFact(synced.view.projection.title === "Independent", "independent work did not survive")
    yield* requireFact(synced.view.pending.find((item) => item.proposal.changeId === parent.changeId)?.state._tag === "conflicted", "parent did not conflict")
    yield* requireFact(synced.view.pending.find((item) => item.proposal.changeId === child.changeId)?.state._tag === "blocked", "child was not blocked")
    yield* requireFact(!synced.view.pending.some((item) => item.proposal.changeId === independent.changeId), "independent work stayed pending")
  }),
  receiptAndPageIdempotency: Effect.gen(function*() {
    const canvasId = Id.canvas("canvas_replica_conformance_reconcile")
    const genesisCursor = ProtocolValue.cursor("cursor_replica_conformance_genesis")
    const acceptedCursor = ProtocolValue.cursor("cursor_replica_conformance_accepted")
    const commands = decodeCanvasCommandBatch([{ _tag: "rename-canvas", expectedTitle: "Original", title: "Accepted" }])
    const changeId = Id.change("change_replica_conformance_reconcile")
    const state = ReplicaPolicy.initialize(AuthorityView.make({
      canvasId,
      createdAt: Schema.decodeUnknownSync(IsoTimestamp)("2026-08-22T00:00:00.000Z"),
      createdBy: PersonAttribution.make({ person: person.principal.person }),
      cursor: genesisCursor,
      projection: emptyCanvasProjection(canvasId, "Original")
    }))
    const pendingResult = ReplicaPolicy.enqueue(
      state, ReplicaModel.change({ canvasId, commands }), person, changeId
    )
    if (pendingResult._tag === "Failure") throw pendingResult.failure
    const pending = pendingResult.success
    const accepted: AcceptedCanvasChange = {
      canvasId, changeId, observedCursor: genesisCursor, commands,
      sequence: ProtocolValue.sequence(1), cursor: acceptedCursor,
      acceptedAt: Schema.decodeUnknownSync(IsoTimestamp)("2026-08-22T00:00:01.000Z"),
      attribution: PersonAttribution.make({ person: person.principal.person })
    }
    const receipt = { disposition: "first-acceptance" as const, change: accepted }
    const firstReceiptResult = ReplicaPolicy.receipt(pending, receipt)
    if (firstReceiptResult._tag === "Failure") throw firstReceiptResult.failure
    const duplicateReceiptResult = ReplicaPolicy.receipt(firstReceiptResult.success, receipt)
    if (duplicateReceiptResult._tag === "Failure") throw duplicateReceiptResult.failure
    const duplicateReceipt = duplicateReceiptResult.success
    yield* requireFact(duplicateReceipt.acknowledgedCursor === genesisCursor, "receipt advanced acknowledged cursor")
    yield* requireFact(duplicateReceipt.pending[0]?.state._tag === "accepted-unconfirmed", "receipt was not retained unconfirmed")
    const page: ChangePage = { canvasId, after: genesisCursor, changes: [accepted], cursor: acceptedCursor, hasMore: false }
    const pulledResult = ReplicaPolicy.incorporatePage(duplicateReceipt, page)
    if (pulledResult._tag === "Failure") throw pulledResult.failure
    const delayedReceiptResult = ReplicaPolicy.receipt(pulledResult.success.state, receipt)
    if (delayedReceiptResult._tag === "Failure") throw delayedReceiptResult.failure
    const duplicatePageResult = ReplicaPolicy.incorporatePage(delayedReceiptResult.success, page)
    if (duplicatePageResult._tag === "Failure") throw duplicatePageResult.failure
    const duplicatePage = duplicatePageResult.success
    yield* requireFact(duplicatePage.pulled === 0, "duplicate page appended accepted history")
    yield* requireFact(duplicatePage.state.pending.length === 0, "self-acceptance did not clear pending work")
  })
}

export const ReplicaStoreConformance = Effect.gen(function*() {
  const store = yield* ReplicaStore
  const canvasId = Id.canvas("canvas_replica_store_conformance")
  const missing = yield* store.get(canvasId)
  yield* requireFact(missing === undefined, "new store was not empty")
  const initial = ReplicaPolicy.initialize(AuthorityView.make({
    canvasId,
    createdAt: Schema.decodeUnknownSync(IsoTimestamp)("2026-08-22T00:00:00.000Z"),
    createdBy: PersonAttribution.make({ person: person.principal.person }),
    cursor: ProtocolValue.cursor("cursor_replica_store_conformance"),
    projection: emptyCanvasProjection(canvasId, "Stored")
  }))
  const created = yield* store.modify(canvasId, (current) => Result.succeed([
    current === undefined,
    initial
  ] as const))
  yield* requireFact(created, "create transition did not observe an empty store")
  const retained = yield* store.modify(canvasId, () => Result.fail(new ReplicaConformanceFailure({
    message: "expected transition failure"
  }))).pipe(Effect.result)
  yield* requireFact(Result.isFailure(retained), "failed transition succeeded")
  const afterFailure = yield* store.get(canvasId)
  yield* requireFact(afterFailure?.genesisProjection.title === "Stored", "failed transition changed stored state")
  yield* store.modify(canvasId, () => Result.succeed([undefined, undefined] as const))
  const deleted = yield* store.get(canvasId)
  yield* requireFact(deleted === undefined, "delete transition retained state")
})
