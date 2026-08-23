import { AuthorityClockLive, AuthorityFailure, AuthorityModel, CanvasAuthority, MemoryCanvasAuthority, PersonInvocation } from "@crit/authority"
import { DomainValue, Id, decodeCanvasCommandBatch } from "@crit/domain"
import { ProtocolValue } from "@crit/protocol"
import { Deferred, Effect, Fiber, Layer, Option, Schema, Stream } from "effect"
import { describe, expect, it } from "vitest"

import { CanvasReplica, MemoryCanvasReplicaLive, ReplicaChangeIds, ReplicaModel } from "../src/index.js"
import { ReplicaConformance, ReplicaStoreConformance } from "../src/testing.js"
import { MemoryReplicaStore } from "../src/memory.js"

const ids = [
  Id.change("change_replica_1"), Id.change("change_replica_2"), Id.change("change_replica_3"),
  Id.change("change_replica_4"), Id.change("change_replica_5")
]

const makeLayer = (
  nextId?: Effect.Effect<ReturnType<typeof Id.change>>,
  decorate?: (authority: CanvasAuthority["Service"]) => CanvasAuthority["Service"]
) => {
  let position = 0
  const idLayer = Layer.succeed(ReplicaChangeIds, {
    next: nextId ?? Effect.sync(() => ids[position++] ?? Id.change(`change_replica_${position + 10}`))
  })
  const baseAuthority = MemoryCanvasAuthority.layer.pipe(Layer.provide(AuthorityClockLive))
  const authority = decorate === undefined
    ? baseAuthority
    : Layer.effect(CanvasAuthority, Effect.map(CanvasAuthority, decorate)).pipe(Layer.provide(baseAuthority))
  const dependencies = Layer.merge(authority, idLayer)
  const replica = MemoryCanvasReplicaLive.pipe(Layer.provide(dependencies))
  return Layer.merge(dependencies, replica)
}

const person = Schema.decodeUnknownSync(PersonInvocation)({
  _tag: "person",
  principal: {
    _tag: "person",
    subject: "oidc|replica-test",
    person: { _tag: "person", personId: "person_replica_test", displayName: "Replica" }
  }
})

const addFrame = (frameId: string, title = "Frame") => decodeCanvasCommandBatch([{
  _tag: "add-frame",
  frameId,
  title,
  representation: { _tag: "application-route", applicationId: "application_replica", route: "/", state: {} },
  status: "in-progress",
  geometry: { x: 0, y: 0, width: 800, height: 600 }
}])

describe("MemoryCanvasReplica", () => {
  it("satisfies ReplicaStore conformance", async () => {
    await Effect.runPromise(ReplicaStoreConformance.pipe(Effect.provide(MemoryReplicaStore)))
  })
  it("satisfies the reusable core conformance", async () => {
    await Effect.runPromise(ReplicaConformance.basic.pipe(Effect.provide(makeLayer())))
  })

  it("keeps Canvas state isolated", async () => {
    await Effect.runPromise(Effect.gen(function*() {
      const authority = yield* CanvasAuthority
      const replica = yield* CanvasReplica
      const canvasA = Id.canvas("canvas_replica_isolated_a")
      const canvasB = Id.canvas("canvas_replica_isolated_b")
      yield* authority.create(AuthorityModel.createCanvas({ canvasId: canvasA, title: "A" }), person)
      yield* authority.create(AuthorityModel.createCanvas({ canvasId: canvasB, title: "B" }), person)
      yield* replica.open(canvasA)
      yield* replica.open(canvasB)
      yield* replica.change(ReplicaModel.change({ canvasId: canvasA, commands: addFrame("frame_isolated") }), person)
      const other = yield* replica.current(canvasB)
      expect(other.projection.title).toBe("B")
      expect(other.projection.frames).toEqual([])
      expect(other.pending).toEqual([])
    }).pipe(Effect.provide(makeLayer())))
  })

  it("coalesces mutation hints per Canvas and stays silent for rejected changes", async () => {
    const program = Effect.gen(function*() {
      const authority = yield* CanvasAuthority
      const replica = yield* CanvasReplica
      const canvasA = Id.canvas("canvas_notifications_a")
      const canvasB = Id.canvas("canvas_notifications_b")
      yield* authority.create(AuthorityModel.createCanvas({ canvasId: canvasA, title: "A" }), person)
      yield* authority.create(AuthorityModel.createCanvas({ canvasId: canvasB, title: "B" }), person)
      yield* replica.open(canvasA)
      yield* replica.open(canvasB)
      const notificationsA = yield* replica.subscribe(canvasA)
      const notificationsB = yield* replica.subscribe(canvasB)
      const pullA = yield* Stream.toPull(notificationsA)
      const pullB = yield* Stream.toPull(notificationsB)
      yield* replica.change(ReplicaModel.change({
        canvasId: canvasA,
        commands: decodeCanvasCommandBatch([{ _tag: "rename-canvas", expectedTitle: "A", title: "A1" }])
      }), person)
      yield* replica.change(ReplicaModel.change({
        canvasId: canvasA,
        commands: decodeCanvasCommandBatch([{ _tag: "rename-canvas", expectedTitle: "A1", title: "A2" }])
      }), person)
      expect(yield* pullA).toEqual([{ kind: "replica-changed", schemaVersion: 1, canvasId: canvasA }])
      expect(Option.isNone(yield* pullB.pipe(Effect.timeoutOption("10 millis")))).toBe(true)

      const rejectedNotifications = yield* replica.subscribe(canvasB)
      const rejectedPull = yield* Stream.toPull(rejectedNotifications)
      yield* replica.change(ReplicaModel.change({
        canvasId: canvasB,
        commands: decodeCanvasCommandBatch([{ _tag: "rename-canvas", expectedTitle: "wrong", title: "B2" }])
      }), person).pipe(Effect.result)
      expect(Option.isNone(yield* rejectedPull.pipe(Effect.timeoutOption("10 millis")))).toBe(true)
    }).pipe(Effect.provide(makeLayer()))
    await Effect.runPromise(Effect.scoped(program))
  })

  it("rejects subscriptions for unopened Canvas IDs", async () => {
    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const replica = yield* CanvasReplica
      return yield* replica.subscribe(Id.canvas("canvas_notifications_unopened")).pipe(Effect.result)
    }).pipe(Effect.provide(makeLayer()))))
    expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "ReplicaNotOpen" } })
  })

  it("owns input and invocation before a suspended ID allocation", async () => {
    await Effect.runPromise(Effect.gen(function*() {
      const gate = yield* Deferred.make<ReturnType<typeof Id.change>>()
      const program = Effect.gen(function*() {
        const authority = yield* CanvasAuthority
        const replica = yield* CanvasReplica
        const canvasId = Id.canvas("canvas_replica_owned")
        yield* authority.create(AuthorityModel.createCanvas({ canvasId, title: "Original" }), person)
        yield* replica.open(canvasId)
        const input = ReplicaModel.change({
          canvasId,
          commands: decodeCanvasCommandBatch([{ _tag: "rename-canvas", expectedTitle: "Original", title: "Owned" }])
        })
        const incoming = DomainValue.detach(person)
        const fiber = yield* Effect.forkChild(replica.change(input, incoming))
        yield* Effect.yieldNow
        Reflect.set(input.commands[0], "title", "Mutated")
        Reflect.set(incoming.principal, "subject", "oidc|mutated")
        yield* Deferred.succeed(gate, Id.change("change_replica_owned"))
        const receipt = yield* Fiber.join(fiber)
        expect(receipt.view.projection.title).toBe("Owned")
        yield* replica.sync(canvasId)
        const accepted = yield* authority.changesAfter(AuthorityModel.changesAfter({
          canvasId,
          after: receipt.view.acknowledgedCursor,
          limit: AuthorityModel.pageLimit(10)
        }))
        expect(accepted.changes[0]?.attribution).toMatchObject({ person: { personId: "person_replica_test" } })
      }).pipe(Effect.provide(makeLayer(Deferred.await(gate))))
      yield* program
    }))
  })

  it("serializes concurrent changes without losing either commit", async () => {
    await Effect.runPromise(Effect.gen(function*() {
      const authority = yield* CanvasAuthority
      const replica = yield* CanvasReplica
      const canvasId = Id.canvas("canvas_replica_concurrent")
      yield* authority.create(AuthorityModel.createCanvas({ canvasId, title: "Concurrent" }), person)
      yield* replica.open(canvasId)
      const receipts = yield* Effect.all([
        replica.change(ReplicaModel.change({ canvasId, commands: addFrame("frame_concurrent_a") }), person),
        replica.change(ReplicaModel.change({ canvasId, commands: addFrame("frame_concurrent_b") }), person)
      ], { concurrency: "unbounded" })
      expect(new Set(receipts.map((receipt) => receipt.changeId)).size).toBe(2)
      const current = yield* replica.current(canvasId)
      expect(current.pending).toHaveLength(2)
      expect(current.projection.frames.map((frame) => frame.frameId).sort()).toEqual(["frame_concurrent_a", "frame_concurrent_b"])
    }).pipe(Effect.provide(makeLayer())))
  })

  it("pulls before submission and performs a final empty pull", async () => {
    const events: string[] = []
    await Effect.runPromise(Effect.gen(function*() {
      const authority = yield* CanvasAuthority
      const replica = yield* CanvasReplica
      const canvasId = Id.canvas("canvas_replica_sync_order")
      yield* authority.create(AuthorityModel.createCanvas({ canvasId, title: "Original" }), person)
      yield* replica.open(canvasId)
      yield* replica.change(ReplicaModel.change({
        canvasId,
        commands: decodeCanvasCommandBatch([{ _tag: "rename-canvas", expectedTitle: "Original", title: "Synced" }])
      }), person)
      yield* replica.sync(canvasId)
      expect(events).toEqual(["pull", "submit", "pull", "pull"])
    }).pipe(Effect.provide(makeLayer(undefined, (authority) => ({
      ...authority,
      changesAfter: (query) => Effect.sync(() => events.push("pull")).pipe(Effect.andThen(authority.changesAfter(query))),
      submit: (proposal, invocation) => Effect.sync(() => events.push("submit")).pipe(Effect.andThen(authority.submit(proposal, invocation)))
    })))))
  })

  it("publishes commits completed before a later sync failure", async () => {
    let pulls = 0
    const program = Effect.gen(function*() {
      const authority = yield* CanvasAuthority
      const replica = yield* CanvasReplica
      const canvasId = Id.canvas("canvas_replica_partial_sync")
      const genesis = yield* authority.create(AuthorityModel.createCanvas({ canvasId, title: "Original" }), person)
      yield* replica.open(canvasId)
      yield* authority.submit({
        canvasId,
        changeId: Id.change("change_replica_partial_sync_remote"),
        observedCursor: genesis.cursor,
        commands: decodeCanvasCommandBatch([{ _tag: "rename-canvas", expectedTitle: "Original", title: "Remote" }])
      }, person)
      const notifications = yield* replica.subscribe(canvasId)
      const pull = yield* Stream.toPull(notifications)
      const result = yield* replica.sync(canvasId).pipe(Effect.result)
      expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "ReplicaDiverged" } })
      expect(yield* pull).toEqual([{ kind: "replica-changed", schemaVersion: 1, canvasId }])
      expect((yield* replica.current(canvasId)).projection.title).toBe("Remote")
    }).pipe(Effect.provide(makeLayer(undefined, (authority) => ({
      ...authority,
      changesAfter: (query) => pulls++ === 0
        ? authority.changesAfter(query).pipe(Effect.map((page) => ({ ...page, hasMore: true })))
        : Effect.fail(AuthorityFailure.cursorNotFound({
          canvasId: query.canvasId,
          cursor: query.after ?? ProtocolValue.cursor("cursor_partial_sync_missing")
        }))
    }))))
    await Effect.runPromise(Effect.scoped(program))
  })

  it("fails a hasMore page that makes no cursor progress", async () => {
    await Effect.runPromise(Effect.gen(function*() {
      const authority = yield* CanvasAuthority
      const replica = yield* CanvasReplica
      const canvasId = Id.canvas("canvas_replica_stalled_page")
      yield* authority.create(AuthorityModel.createCanvas({ canvasId, title: "Original" }), person)
      yield* replica.open(canvasId)
      const exit = yield* Effect.result(replica.sync(canvasId))
      expect(exit).toMatchObject({ _tag: "Failure", failure: { _tag: "ReplicaDiverged" } })
    }).pipe(Effect.provide(makeLayer(undefined, (authority) => ({
      ...authority,
      changesAfter: (query) => authority.open(query.canvasId).pipe(Effect.map((view) => ({
        canvasId: query.canvasId,
        after: query.after,
        changes: [],
        cursor: view.cursor,
        hasMore: true
      })))
    })))))
  })

  it("pulls a remote conflict before submitting local work", async () => {
    await Effect.runPromise(Effect.gen(function*() {
      const authority = yield* CanvasAuthority
      const replica = yield* CanvasReplica
      const canvasId = Id.canvas("canvas_replica_remote_conflict")
      const genesis = yield* authority.create(AuthorityModel.createCanvas({ canvasId, title: "Original" }), person)
      yield* replica.open(canvasId)
      const local = yield* replica.change(ReplicaModel.change({
        canvasId,
        commands: decodeCanvasCommandBatch([{ _tag: "rename-canvas", expectedTitle: "Original", title: "Local" }])
      }), person)
      yield* authority.submit({
        canvasId,
        changeId: Id.change("change_remote_conflict"),
        observedCursor: genesis.cursor,
        commands: decodeCanvasCommandBatch([{ _tag: "rename-canvas", expectedTitle: "Original", title: "Remote" }])
      }, person)
      const synced = yield* replica.sync(canvasId)
      expect(synced.view.projection.title).toBe("Remote")
      expect(synced.view.pending[0]).toMatchObject({ proposal: { changeId: local.changeId }, state: { _tag: "conflicted" } })
    }).pipe(Effect.provide(makeLayer())))
  })

  it("blocks conservative dependents while preserving independent work", async () => {
    await Effect.runPromise(ReplicaConformance.conflictDependenciesAndIndependent.pipe(Effect.provide(makeLayer())))
  })
})
