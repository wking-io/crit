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

const author = Schema.decodeUnknownSync(PersonInvocation)({
  _tag: "person",
  principal: {
    _tag: "person",
    subject: "access|ada@acme.com",
    person: {
      _tag: "person",
      personId: "person_author_replica",
      displayName: "Ada Lovelace",
      email: { _tag: "access", address: "ada@acme.com" }
    }
  }
})

const reviewer = Schema.decodeUnknownSync(PersonInvocation)({
  _tag: "person",
  principal: {
    _tag: "person",
    subject: "access|grace@acme.com",
    person: {
      _tag: "person",
      personId: "person_reviewer_hosted",
      displayName: "Grace Hopper",
      email: { _tag: "access", address: "grace@acme.com" }
    }
  }
})

const addFrame = (frameId: string, title: string) => decodeCanvasCommandBatch([{
  _tag: "addFrame",
  frameId,
  title,
  representation: {
    _tag: "applicationRoute",
    applicationId: "application_shared_reviewer",
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

const approve = (
  frameId: string,
  expectedChangedByChangeId: string
) => decodeCanvasCommandBatch([{
  _tag: "setFrameStatus",
  frameId,
  expectedChangedByChangeId,
  status: "approved"
}])

describe("shared replica reviewer changes", () => {
  it("pulls a reviewer's accepted Frame status onto the author's replica", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const canvasId = Id.canvas("canvas_reviewer_status")
      const path = yield* tempDatabasePath("reviewer-status")
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
      const replicaContext = yield* Layer.buildWithScope(
        SqliteCanvasReplica.layer({ path }).pipe(
          Layer.provide(changeIds("change_author")),
          Layer.provide(Layer.succeed(CanvasAuthority, routed))
        ),
        scope
      )
      const replica = Context.get(replicaContext, CanvasReplica)

      yield* remote.create(AuthorityModel.createCanvas({ canvasId, title: "Shared" }), author)
      yield* replica.open(canvasId)
      const added = yield* replica.change(ReplicaModel.change({
        canvasId,
        commands: addFrame("frame_checkout", "Checkout")
      }), author)
      const pushed = yield* replica.sync(canvasId)
      expect(pushed.view.pending).toEqual([])
      expect(pushed.view.projection.frames[0]?.status).toBe("in-progress")

      yield* remote.submit({
        canvasId,
        changeId: Id.change("change_reviewer_approve"),
        observedCursor: pushed.view.acknowledgedCursor,
        commands: approve("frame_checkout", added.changeId)
      }, reviewer)

      const synced = yield* replica.sync(canvasId)
      expect(synced.pulled).toBe(1)
      expect(synced.view.pending).toEqual([])
      expect(synced.view.projection.frames[0]?.status).toBe("approved")
      expect(synced.view.projection.frames[0]?.statusChangedByChangeId).toBe(
        "change_reviewer_approve"
      )

      const page = yield* remote.changesAfter(AuthorityModel.changesAfter({
        canvasId,
        after: pushed.view.acknowledgedCursor,
        limit: AuthorityModel.pageLimit(10)
      }))
      expect(page.changes).toHaveLength(1)
      expect(page.changes[0]?.changeId).toBe("change_reviewer_approve")
      expect(page.changes[0]?.attribution).toEqual(
        PersonAttribution.make({ person: reviewer.principal.person })
      )
    }))))

  it("rebases an unknown local cursor, then pulls later reviewer work", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const canvasId = Id.canvas("canvas_reviewer_rebase")
      const path = yield* tempDatabasePath("reviewer-rebase")
      const scope = yield* Effect.scope
      const remoteContext = yield* Layer.buildWithScope(
        MemoryCanvasAuthority.layer.pipe(Layer.provide(AuthorityClockLive)),
        scope
      )
      const remote = Context.get(remoteContext, CanvasAuthority)
      yield* remote.create(AuthorityModel.createCanvas({ canvasId, title: "Remote" }), author)
      const storeContext = yield* Layer.buildWithScope(sqliteReplicaStoreLayer({ path }), scope)
      const store = Context.get(storeContext, ReplicaStore)
      yield* store.modify(canvasId, () => Result.succeed([undefined, ReplicaPolicy.initialize(AuthorityView.make({
        canvasId,
        createdAt: Schema.decodeUnknownSync(IsoTimestamp)("2026-08-22T00:00:00.000Z"),
        createdBy: PersonAttribution.make({ person: author.principal.person }),
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
          Layer.provide(changeIds("change_rebased_author")),
          Layer.provide(Layer.succeed(CanvasAuthority, routed))
        ),
        scope
      )
      const replica = Context.get(replicaContext, CanvasReplica)
      yield* rebaseIfRemoteCursorUnknown(replica, routed)(canvasId)

      const added = yield* replica.change(ReplicaModel.change({
        canvasId,
        commands: addFrame("frame_after_rebase", "After")
      }), author)
      const pushed = yield* replica.sync(canvasId)
      yield* remote.submit({
        canvasId,
        changeId: Id.change("change_reviewer_after_rebase"),
        observedCursor: pushed.view.acknowledgedCursor,
        commands: approve("frame_after_rebase", added.changeId)
      }, reviewer)

      const synced = yield* replica.sync(canvasId)
      expect(synced.pulled).toBe(1)
      expect(synced.view.pending).toEqual([])
      expect(synced.view.projection.frames[0]?.status).toBe("approved")
      expect(synced.view.projection.frames[0]?.frameId).toBe("frame_after_rebase")
    }))))

  it("keeps independent local work while pulling the reviewer's status", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const canvasId = Id.canvas("canvas_reviewer_independent")
      const path = yield* tempDatabasePath("reviewer-independent")
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
      const replicaContext = yield* Layer.buildWithScope(
        SqliteCanvasReplica.layer({ path }).pipe(
          Layer.provide(changeIds("change_author_independent")),
          Layer.provide(Layer.succeed(CanvasAuthority, routed))
        ),
        scope
      )
      const replica = Context.get(replicaContext, CanvasReplica)

      yield* remote.create(AuthorityModel.createCanvas({ canvasId, title: "Shared" }), author)
      yield* replica.open(canvasId)
      const added = yield* replica.change(ReplicaModel.change({
        canvasId,
        commands: addFrame("frame_checkout", "Checkout")
      }), author)
      const pushed = yield* replica.sync(canvasId)

      yield* replica.change(ReplicaModel.change({
        canvasId,
        commands: decodeCanvasCommandBatch([{
          _tag: "renameCanvas",
          expectedTitle: "Shared",
          title: "Also local"
        }])
      }), author)
      yield* remote.submit({
        canvasId,
        changeId: Id.change("change_reviewer_independent"),
        observedCursor: pushed.view.acknowledgedCursor,
        commands: approve("frame_checkout", added.changeId)
      }, reviewer)

      const synced = yield* replica.sync(canvasId)
      expect(synced.view.pending).toEqual([])
      expect(synced.view.projection.title).toBe("Also local")
      expect(synced.view.projection.frames[0]?.status).toBe("approved")
    }))))
})
