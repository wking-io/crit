import { AuthorityModel, CanvasAuthority } from "@crit/authority"
import type { VerifiedInvocation } from "@crit/authority"
import type { CanvasId } from "@crit/domain"
import { ReplicaChangedSchema, type ReplicaChanged } from "@crit/protocol"
import { Context, Effect, Layer, PubSub, Result, Scope, Semaphore, Stream, SynchronizedRef } from "effect"

import {
  ReplicaCanvasNotFound,
  type ReplicaChange,
  type ReplicaChangeReceipt,
  ReplicaChangeIds,
  ReplicaDiverged,
  type ReplicaOpenFailure,
  ReplicaNotOpen,
  type ReplicaChangeFailure,
  type ReplicaSyncFailure,
  type ReplicaView,
  SyncResult,
  type ReplicaInvariantFailure,
  type ReplicaState
} from "./model.js"
import { ReplicaPolicy } from "./policy.js"
import { ReplicaStore } from "./store.js"

const pageLimit = AuthorityModel.pageLimit(1_000)

export interface CanvasReplicaService {
  readonly open: (canvasId: CanvasId) => Effect.Effect<ReplicaView, ReplicaOpenFailure>
  readonly current: (canvasId: CanvasId) => Effect.Effect<ReplicaView, ReplicaNotOpen | ReplicaInvariantFailure>
  readonly change: (input: ReplicaChange, invocation: VerifiedInvocation) => Effect.Effect<ReplicaChangeReceipt, ReplicaChangeFailure>
  readonly sync: (canvasId: CanvasId) => Effect.Effect<SyncResult, ReplicaSyncFailure>
  readonly subscribe: (canvasId: CanvasId) => Effect.Effect<Stream.Stream<ReplicaChanged>, ReplicaNotOpen, Scope.Scope>
}

const makeCanvasReplica = Effect.gen(function*() {
  const authority = yield* CanvasAuthority
  const ids = yield* ReplicaChangeIds
  const store = yield* ReplicaStore
  const subscriptions = yield* SynchronizedRef.make<ReadonlyMap<CanvasId, PubSub.PubSub<ReplicaChanged>>>(new Map())
  const notificationsFor = (canvasId: CanvasId) => SynchronizedRef.modifyEffect(
    subscriptions,
    (current) => {
      const existing = current.get(canvasId)
      if (existing !== undefined) return Effect.succeed([existing, current] as const)
      return PubSub.sliding<ReplicaChanged>(1).pipe(
        Effect.map((created) => [created, new Map(current).set(canvasId, created)] as const)
      )
    }
  )
  const publish = (canvasId: CanvasId) => notificationsFor(canvasId).pipe(
    Effect.flatMap((pubsub) => PubSub.publish(pubsub, ReplicaChangedSchema.make({
      kind: "replica-changed",
      schemaVersion: 1,
      canvasId
    }))),
    Effect.asVoid
  )
  const modify = <A, E>(
    canvasId: CanvasId,
    transition: (state: ReplicaState | undefined) => Result.Result<readonly [A, ReplicaState | undefined], E>
  ): Effect.Effect<A, E> => store.modify<A, E>(canvasId, transition).pipe(
    Effect.tap(() => publish(canvasId))
  )
  const syncLocks = new Map<CanvasId, Semaphore.Semaphore>()
  const lockFor = (canvasId: CanvasId) => {
    const existing = syncLocks.get(canvasId)
    if (existing !== undefined) return existing
    const created = Semaphore.makeUnsafe(1)
    syncLocks.set(canvasId, created)
    return created
  }
  const requireState = (canvasId: CanvasId) => store.get(canvasId).pipe(Effect.flatMap((state) => state === undefined
    ? Effect.fail(new ReplicaNotOpen({ canvasId }))
    : Effect.succeed(state)))
  const render = (state: ReplicaState) => {
    const result = ReplicaPolicy.view(state)
    return result._tag === "Success" ? Effect.succeed(ReplicaPolicy.detach(result.success)) : Effect.fail(result.failure)
  }
  const current: CanvasReplicaService["current"] = (canvasId) => requireState(canvasId).pipe(
    Effect.flatMap(render),
    Effect.withSpan("crit.replica.current", { attributes: { "crit.canvas.id": canvasId } })
  )
  const open: CanvasReplicaService["open"] = (canvasId) => Effect.gen(function*() {
    const local = yield* store.get(canvasId)
    if (local !== undefined) return yield* render(local)
    const authorityView = yield* authority.open(canvasId).pipe(
      Effect.mapError(() => new ReplicaCanvasNotFound({ canvasId }))
    )
    const state = yield* modify<ReplicaState, never>(canvasId, (latest) => Result.succeed([
      latest ?? ReplicaPolicy.initialize(ReplicaPolicy.detach(authorityView)),
      latest ?? ReplicaPolicy.initialize(ReplicaPolicy.detach(authorityView))
    ] as const))
    return yield* render(state)
  }).pipe(Effect.withSpan("crit.replica.open", { attributes: { "crit.canvas.id": canvasId } }))
  const change: CanvasReplicaService["change"] = (input, invocation) => Effect.suspend(() => {
    const ownedInput = ReplicaPolicy.detach(input)
    const ownedInvocation = ReplicaPolicy.detach(invocation)
    return Effect.gen(function*() {
      const changeId = yield* ids.next
      const state = yield* modify<ReplicaState, ReplicaChangeFailure>(ownedInput.canvasId, (current): Result.Result<readonly [ReplicaState, ReplicaState], ReplicaChangeFailure> => {
        if (current === undefined) return Result.fail(new ReplicaNotOpen({ canvasId: ownedInput.canvasId }))
        const result = ReplicaPolicy.enqueue(current, ownedInput, ownedInvocation, changeId)
        return result._tag === "Success"
          ? Result.succeed([result.success, result.success] as const)
          : Result.fail(result.failure)
      })
      const view = yield* render(state)
      return { changeId, view }
    })
  }).pipe(Effect.withSpan("crit.replica.change", { attributes: { "crit.canvas.id": input.canvasId } }))

  const pull = (canvasId: CanvasId) => Effect.gen(function*() {
    let pulled = 0
    let acknowledged = 0
    let more = true
    while (more) {
      const state = yield* requireState(canvasId)
      const page = yield* authority.changesAfter(AuthorityModel.changesAfter({
        canvasId,
        after: state.acknowledgedCursor,
        limit: pageLimit
      })).pipe(Effect.mapError((failure) => failure._tag === "canvas-not-found"
        ? new ReplicaCanvasNotFound({ canvasId })
        : new ReplicaDiverged({ canvasId, reason: `authority rejected acknowledged cursor: ${failure.cursor}` })))
      if (page.hasMore && page.cursor === state.acknowledgedCursor) {
        return yield* Effect.fail(new ReplicaDiverged({
          canvasId,
          reason: "authority page promised more changes without advancing its cursor"
        }))
      }
      const counts = yield* modify<{ readonly pulled: number; readonly acknowledged: number }, ReplicaSyncFailure>(canvasId, (current): Result.Result<readonly [{ readonly pulled: number; readonly acknowledged: number }, ReplicaState], ReplicaSyncFailure> => {
        if (current === undefined) return Result.fail(new ReplicaNotOpen({ canvasId }))
        const result = ReplicaPolicy.incorporatePage(current, ReplicaPolicy.detach(page))
        return result._tag === "Success"
          ? Result.succeed([{ pulled: result.success.pulled, acknowledged: result.success.acknowledged }, result.success.state] as const)
          : Result.fail(result.failure)
      })
      pulled += counts.pulled
      acknowledged += counts.acknowledged
      more = page.hasMore
    }
    return { pulled, acknowledged }
  })

  const sync: CanvasReplicaService["sync"] = (canvasId) => lockFor(canvasId).withPermits(1)(Effect.gen(function*() {
    yield* requireState(canvasId)
    let pulled = 0
    let acknowledged = 0
    let result = yield* pull(canvasId)
    pulled += result.pulled
    acknowledged += result.acknowledged
    for (;;) {
      const state = yield* requireState(canvasId)
      const eligible = state.pending.find((record) => record.state._tag === "ready")
      if (eligible === undefined) break
      const submitted = yield* authority.submit(ReplicaPolicy.detach(eligible.proposal), ReplicaPolicy.detach(eligible.invocation)).pipe(Effect.result)
      if (submitted._tag === "Failure") {
        const failure = submitted.failure
        if (failure._tag === "change-rejected") {
          yield* modify<undefined, ReplicaSyncFailure>(canvasId, (current): Result.Result<readonly [undefined, ReplicaState], ReplicaSyncFailure> => {
            if (current === undefined) return Result.fail(new ReplicaNotOpen({ canvasId }))
            const next = ReplicaPolicy.rejection(current, failure)
            return next._tag === "Success"
              ? Result.succeed([undefined, next.success] as const)
              : Result.fail(next.failure)
          })
          continue
        }
        if (failure._tag === "canvas-not-found") return yield* Effect.fail(new ReplicaCanvasNotFound({ canvasId }))
        return yield* Effect.fail(new ReplicaDiverged({ canvasId, reason: `authority rejected pending identity: ${failure._tag}` }))
      }
      yield* modify<undefined, ReplicaSyncFailure>(canvasId, (current): Result.Result<readonly [undefined, ReplicaState], ReplicaSyncFailure> => {
        if (current === undefined) return Result.fail(new ReplicaNotOpen({ canvasId }))
        const next = ReplicaPolicy.receipt(current, submitted.success)
        return next._tag === "Success"
          ? Result.succeed([undefined, next.success] as const)
          : Result.fail(next.failure)
      })
      result = yield* pull(canvasId)
      pulled += result.pulled
      acknowledged += result.acknowledged
    }
    result = yield* pull(canvasId)
    pulled += result.pulled
    acknowledged += result.acknowledged
    const state = yield* requireState(canvasId)
    const view = yield* render(state)
    return SyncResult.make({
      canvasId,
      pulled,
      acknowledged,
      conflicted: view.pending.filter((pending) => pending.state._tag === "conflicted").length,
      blocked: view.pending.filter((pending) => pending.state._tag === "blocked").length,
      view
    })
  })).pipe(Effect.withSpan("crit.replica.sync", { attributes: { "crit.canvas.id": canvasId } }))
  const subscribe: CanvasReplicaService["subscribe"] = (canvasId) => requireState(canvasId).pipe(
    Effect.andThen(notificationsFor(canvasId)),
    Effect.flatMap(PubSub.subscribe),
    Effect.map((subscription) => Stream.fromEffectRepeat(PubSub.take(subscription)))
  )
  return { open, current, change, sync, subscribe }
})

export class CanvasReplica extends Context.Service<CanvasReplica, CanvasReplicaService>()(
  "@crit/replica/CanvasReplica",
  { make: makeCanvasReplica }
) {}

export const CanvasReplicaLive = Layer.effect(CanvasReplica, CanvasReplica.make)
