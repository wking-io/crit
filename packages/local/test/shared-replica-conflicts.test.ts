import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  AuthorityClockLive,
  AuthorityModel,
  CanvasAuthority,
  MemoryCanvasAuthority,
  PersonInvocation
} from "@crit/authority"
import { routeSharedCanvases } from "@crit/client"
import { Id, decodeCanvasCommandBatch } from "@crit/domain"
import { CanvasReplica, ReplicaChangeIds, ReplicaModel } from "@crit/replica"
import { Context, Effect, Layer, Schema } from "effect"
import { describe, expect, it } from "vitest"

import { SqliteCanvasReplica } from "../src/index.js"

const tempDatabasePath = (label: string) => Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), `crit-${label}-`))),
  (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true }))
).pipe(Effect.map((directory) => join(directory, "replica.sqlite")))

const person = Schema.decodeUnknownSync(PersonInvocation)({
  _tag: "person",
  principal: {
    _tag: "person",
    subject: "oidc|shared-replica-conflict",
    person: {
      _tag: "person",
      personId: "person_shared_replica_conflict",
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
    applicationId: "application_shared_replica_conflict",
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

const pendingState = (
  view: { readonly pending: ReadonlyArray<{ readonly proposal: { readonly changeId: string }; readonly state: { readonly _tag: string } }> },
  changeId: string
) => view.pending.find((item) => item.proposal.changeId === changeId)?.state._tag

const frameIds = (view: { readonly projection: { readonly frames: ReadonlyArray<{ readonly frameId: string }> } }) =>
  view.projection.frames.map((frame) => frame.frameId).sort()

describe("shared replica conflicts", () => {
  it("keeps a losing add and its dependent while independent work lands", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const canvasId = Id.canvas("canvas_shared_conflict")
      const leftPath = yield* tempDatabasePath("conflict-left")
      const rightPath = yield* tempDatabasePath("conflict-right")
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
      const rightContext = yield* Layer.buildWithScope(
        SqliteCanvasReplica.layer({ path: rightPath }).pipe(
          Layer.provide(changeIds("change_right")),
          Layer.provide(authority)
        ),
        scope
      )
      const right = Context.get(rightContext, CanvasReplica)

      yield* remote.create(AuthorityModel.createCanvas({ canvasId, title: "Shared" }), person)
      yield* right.open(canvasId)
      yield* right.change(ReplicaModel.change({
        canvasId,
        commands: addFrame("frame_shared", "Right")
      }), person)

      let parentChangeId = ""
      let childChangeId = ""
      yield* Effect.scoped(Effect.gen(function*() {
        const leftContext = yield* Layer.buildWithScope(
          SqliteCanvasReplica.layer({ path: leftPath }).pipe(
            Layer.provide(changeIds("change_left")),
            Layer.provide(authority)
          ),
          yield* Effect.scope
        )
        const left = Context.get(leftContext, CanvasReplica)
        yield* left.open(canvasId)
        const parent = yield* left.change(ReplicaModel.change({
          canvasId,
          commands: addFrame("frame_shared", "Left")
        }), person)
        const child = yield* left.change(ReplicaModel.change({
          canvasId,
          commands: decodeCanvasCommandBatch([{
            _tag: "setFrameTitle",
            frameId: "frame_shared",
            expectedChangedByChangeId: parent.changeId,
            title: "Left child"
          }])
        }), person)
        const independent = yield* left.change(ReplicaModel.change({
          canvasId,
          commands: decodeCanvasCommandBatch([{
            _tag: "renameCanvas",
            expectedTitle: "Shared",
            title: "Also left"
          }])
        }), person)
        parentChangeId = parent.changeId
        childChangeId = child.changeId

        const rightSynced = yield* right.sync(canvasId)
        const leftSynced = yield* left.sync(canvasId)
        const rightAfter = yield* right.sync(canvasId)

        expect(rightSynced.view.pending).toEqual([])
        expect(frameIds(rightSynced.view)).toEqual(["frame_shared"])
        expect(rightSynced.view.projection.frames[0]?.title).toBe("Right")

        expect(leftSynced.conflicted).toBe(1)
        expect(leftSynced.blocked).toBe(1)
        expect(pendingState(leftSynced.view, parent.changeId)).toBe("conflicted")
        expect(pendingState(leftSynced.view, child.changeId)).toBe("blocked")
        expect(pendingState(leftSynced.view, independent.changeId)).toBeUndefined()
        expect(leftSynced.view.projection.title).toBe("Also left")
        expect(leftSynced.view.projection.frames[0]?.title).toBe("Right")
        expect(leftSynced.view.pending).toHaveLength(2)

        expect(rightAfter.view.pending).toEqual([])
        expect(rightAfter.view.projection.title).toBe("Also left")
        expect(rightAfter.view.projection.frames[0]?.title).toBe("Right")
      }))

      const restoredContext = yield* Layer.buildWithScope(
        SqliteCanvasReplica.layer({ path: leftPath }).pipe(
          Layer.provide(changeIds("change_restored")),
          Layer.provide(authority)
        ),
        scope
      )
      const restored = Context.get(restoredContext, CanvasReplica)
      const current = yield* restored.current(canvasId)
      expect(pendingState(current, parentChangeId)).toBe("conflicted")
      expect(pendingState(current, childChangeId)).toBe("blocked")
      expect(current.pending).toHaveLength(2)
      expect(current.projection.title).toBe("Also left")
    }))))
})
