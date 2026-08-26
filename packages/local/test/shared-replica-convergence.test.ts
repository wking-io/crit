import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  AuthorityClockLive,
  AuthorityModel,
  AuthorityView,
  CanvasAuthority,
  MemoryCanvasAuthority,
  PersonInvocation
} from "@crit/authority"
import { routeSharedCanvases } from "@crit/client"
import { Id, IsoTimestamp, PersonAttribution, decodeCanvasCommandBatch, emptyCanvasProjection } from "@crit/domain"
import { ProtocolValue } from "@crit/protocol"
import { ReplicaPolicy, ReplicaStore } from "@crit/replica/adapter"
import { CanvasReplica, ReplicaChangeIds, ReplicaModel } from "@crit/replica"
import { Context, Effect, Layer, Result, Schema } from "effect"
import { describe, expect, it } from "vitest"

import { rebaseIfRemoteCursorUnknown } from "../src/linked-authority.js"
import { sqliteReplicaStoreLayer } from "../src/sqlite-replica.js"
import { SqliteCanvasReplica } from "../src/index.js"

const tempDatabasePath = (label: string) => Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), `crit-${label}-`))),
  (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true }))
).pipe(Effect.map((directory) => join(directory, "replica.sqlite")))

const person = Schema.decodeUnknownSync(PersonInvocation)({
  _tag: "person",
  principal: {
    _tag: "person",
    subject: "oidc|shared-replica",
    person: {
      _tag: "person",
      personId: "person_shared_replica",
      displayName: "Replica",
      email: { _tag: "unspecified" }
    }
  }
})

const addFrame = (frameId: string, title: string) => decodeCanvasCommandBatch([{
  _tag: "addFrame",
  frameId,
  title,
  representation: {
    _tag: "applicationRoute",
    applicationId: "application_shared_replica",
    route: "/",
    state: {}
  },
  status: "in-progress",
  geometry: { x: 0, y: 0, width: 800, height: 600 }
}])

const changeIds = (prefix: string) => {
  let next = 0
  return Layer.succeed(ReplicaChangeIds, {
    next: Effect.sync(() => Id.change(`${prefix}_${++next}`))
  })
}

const frameIds = (view: { readonly projection: { readonly frames: ReadonlyArray<{ readonly frameId: string }> } }) =>
  [...view.projection.frames.map((frame) => frame.frameId)].sort()

const converge = (order: "left-first" | "right-first") => Effect.scoped(Effect.gen(function*() {
  const canvasId = Id.canvas(`canvas_converge_${order}`)
  const leftPath = yield* tempDatabasePath(`converge-left-${order}`)
  const rightPath = yield* tempDatabasePath(`converge-right-${order}`)
  const scope = yield* Effect.scope
  const remoteContext = yield* Layer.buildWithScope(
    MemoryCanvasAuthority.layer.pipe(Layer.provide(AuthorityClockLive)),
    scope
  )
  const remote = Context.get(remoteContext, CanvasAuthority)
  const routed = routeSharedCanvases(
    remote,
    remote,
    (id) => Effect.succeed(id === canvasId)
  )
  const authority = Layer.succeed(CanvasAuthority, routed)
  const leftContext = yield* Layer.buildWithScope(
    SqliteCanvasReplica.layer({ path: leftPath }).pipe(
      Layer.provide(changeIds("change_left")),
      Layer.provide(authority)
    ),
    scope
  )
  const rightContext = yield* Layer.buildWithScope(
    SqliteCanvasReplica.layer({ path: rightPath }).pipe(
      Layer.provide(changeIds("change_right")),
      Layer.provide(authority)
    ),
    scope
  )
  const left = Context.get(leftContext, CanvasReplica)
  const right = Context.get(rightContext, CanvasReplica)

  yield* remote.create(AuthorityModel.createCanvas({ canvasId, title: "Shared" }), person)
  yield* left.open(canvasId)
  yield* right.open(canvasId)
  yield* left.change(ReplicaModel.change({
    canvasId,
    commands: addFrame("frame_left", "Left")
  }), person)
  yield* right.change(ReplicaModel.change({
    canvasId,
    commands: addFrame("frame_right", "Right")
  }), person)

  const first = order === "left-first" ? left : right
  const second = order === "left-first" ? right : left
  yield* first.sync(canvasId)
  yield* second.sync(canvasId)
  const firstAfter = yield* first.current(canvasId)
  const secondAfter = yield* second.current(canvasId)

  expect(firstAfter.pending).toEqual([])
  expect(secondAfter.pending).toEqual([])
  expect(frameIds(firstAfter)).toEqual(["frame_left", "frame_right"])
  expect(frameIds(secondAfter)).toEqual(["frame_left", "frame_right"])
  expect(firstAfter.acknowledgedCursor).toBe(secondAfter.acknowledgedCursor)
  expect(firstAfter.projection.title).toBe("Shared")
}))

describe("shared replica convergence", () => {
  it("converges when the left replica syncs first", () =>
    Effect.runPromise(converge("left-first")))

  it("converges when the right replica syncs first", () =>
    Effect.runPromise(converge("right-first")))

  it("rebases onto the remote genesis when the acknowledged cursor is unknown", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const canvasId = Id.canvas("canvas_converge_rebase")
      const path = yield* tempDatabasePath("converge-rebase")
      const scope = yield* Effect.scope
      const remoteContext = yield* Layer.buildWithScope(
        MemoryCanvasAuthority.layer.pipe(Layer.provide(AuthorityClockLive)),
        scope
      )
      const remote = Context.get(remoteContext, CanvasAuthority)
      yield* remote.create(AuthorityModel.createCanvas({ canvasId, title: "Remote" }), person)
      const storeContext = yield* Layer.buildWithScope(sqliteReplicaStoreLayer({ path }), scope)
      const store = Context.get(storeContext, ReplicaStore)
      yield* store.modify(canvasId, () => Result.succeed([undefined, ReplicaPolicy.initialize(AuthorityView.make({
        canvasId,
        createdAt: Schema.decodeUnknownSync(IsoTimestamp)("2026-08-22T00:00:00.000Z"),
        createdBy: PersonAttribution.make({ person: person.principal.person }),
        cursor: ProtocolValue.cursor("cursor_local_unknown"),
        projection: emptyCanvasProjection(canvasId, "Local leftover")
      }))] as const))

      const routed = routeSharedCanvases(
        remote,
        remote,
        (id) => Effect.succeed(id === canvasId)
      )
      const replicaContext = yield* Layer.buildWithScope(
        SqliteCanvasReplica.layer({ path }).pipe(
          Layer.provide(changeIds("change_rebase")),
          Layer.provide(Layer.succeed(CanvasAuthority, routed))
        ),
        scope
      )
      const replica = Context.get(replicaContext, CanvasReplica)
      const before = yield* replica.open(canvasId)
      expect(before.projection.title).toBe("Local leftover")

      yield* rebaseIfRemoteCursorUnknown(replica, routed)(canvasId)
      const rebased = yield* replica.current(canvasId)
      expect(rebased.projection.title).toBe("Remote")
      expect(rebased.pending).toEqual([])

      yield* replica.change(ReplicaModel.change({
        canvasId,
        commands: addFrame("frame_after_rebase", "After")
      }), person)
      const synced = yield* replica.sync(canvasId)
      expect(synced.view.pending).toEqual([])
      expect(frameIds(synced.view)).toEqual(["frame_after_rebase"])
    }))))
})
