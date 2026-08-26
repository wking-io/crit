import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"

import {
  AuthorityClockLive,
  AuthorityModel,
  AuthorityView,
  CanvasAuthority,
  MemoryCanvasAuthority,
  PersonInvocation
} from "@crit/authority"
import { Id, IsoTimestamp, PersonAttribution, decodeCanvasCommandBatch, emptyCanvasProjection } from "@crit/domain"
import { ProtocolValue } from "@crit/protocol"
import { ReplicaPolicy, ReplicaStateSchema, ReplicaStore } from "@crit/replica/adapter"
import { ReplicaStoreConformance } from "@crit/replica/testing"
import { CanvasReplica, ReplicaChangeIds, ReplicaModel } from "@crit/replica"
import { Context, Data, Effect, Exit, Layer, Result, Schema } from "effect"
import { describe, expect, it } from "vitest"

import { authorityTableSql } from "../src/migrations.js"
import { sqliteReplicaStoreLayer } from "../src/sqlite-replica.js"
import { SqliteCanvasAuthority, SqliteCanvasReplica } from "../src/index.js"

const tempDatabasePath = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), "crit-local-replica-"))),
  (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true }))
).pipe(Effect.map((directory) => join(directory, "local.sqlite")))

const buildStore = (path: string) => Effect.gen(function*() {
  const scope = yield* Effect.scope
  const context = yield* Layer.buildWithScope(sqliteReplicaStoreLayer({ path }), scope)
  return Context.get(context, ReplicaStore)
})

const buildAuthority = (path: string) => Effect.gen(function*() {
  const scope = yield* Effect.scope
  const context = yield* Layer.buildWithScope(
    SqliteCanvasAuthority.layer({ path }).pipe(Layer.provide(AuthorityClockLive)),
    scope
  )
  return Context.get(context, CanvasAuthority)
})

const stateFor = (canvasId: ReturnType<typeof Id.canvas>, title: string) => ReplicaPolicy.initialize(AuthorityView.make({
  canvasId,
  createdAt: Schema.decodeUnknownSync(IsoTimestamp)("2026-08-22T00:00:00.000Z"),
  createdBy: PersonAttribution.make({
    person: {
      _tag: "person",
      personId: "person_sqlite_replica",
      displayName: "Replica",
      email: { _tag: "unspecified" }
    }
  }),
  cursor: ProtocolValue.cursor(`cursor_${canvasId}`),
  projection: emptyCanvasProjection(canvasId, title)
}))

const invocation = Schema.decodeUnknownSync(PersonInvocation)({
  _tag: "person",
  principal: {
    _tag: "person",
    subject: "oidc|sqlite-replica",
    person: {
      _tag: "person",
      personId: "person_sqlite_replica",
      displayName: "Replica",
      email: { _tag: "unspecified" }
    }
  }
})

class ExpectedFailure extends Data.TaggedError("ExpectedFailure")<{
  readonly message: string
}> {}

describe("SQLite ReplicaStore", () => {
  it("satisfies ReplicaStore conformance", () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const path = yield* tempDatabasePath
    yield* ReplicaStoreConformance.pipe(Effect.provide(sqliteReplicaStoreLayer({ path })))
  }))))

  it("persists state across scoped handles", () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const path = yield* tempDatabasePath
    const canvasId = Id.canvas("canvas_sqlite_replica_restart")
    yield* Effect.scoped(Effect.gen(function*() {
      const store = yield* buildStore(path)
      yield* store.modify(canvasId, () => Result.succeed([undefined, stateFor(canvasId, "Restart")] as const))
    }))
    const restored = yield* Effect.scoped(Effect.gen(function*() {
      const store = yield* buildStore(path)
      return yield* store.get(canvasId)
    }))
    expect(restored?.genesisProjection.title).toBe("Restart")
  }))))

  it("recovers an accepted-unconfirmed change after restart", () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const path = yield* tempDatabasePath
    const scope = yield* Effect.scope
    const authorityContext = yield* Layer.buildWithScope(
      MemoryCanvasAuthority.layer.pipe(Layer.provide(AuthorityClockLive)),
      scope
    )
    const authority = Context.get(authorityContext, CanvasAuthority)
    let id = 0
    const idLayer = Layer.succeed(ReplicaChangeIds, {
      next: Effect.sync(() => Id.change(`change_sqlite_restart_${id++}`))
    })
    let pulls = 0
    let submits = 0
    const trackedAuthority: CanvasAuthority["Service"] = {
      ...authority,
      submit: (proposal, verified) => {
        submits += 1
        return authority.submit(proposal, verified)
      }
    }
    const interruptedAuthority = Layer.succeed(CanvasAuthority, {
      ...trackedAuthority,
      changesAfter: (query) => {
        pulls += 1
        return pulls === 2 ? Effect.die("stop after receipt persistence") : authority.changesAfter(query)
      }
    })
    const firstLayer = SqliteCanvasReplica.layer({ path }).pipe(
      Layer.provide(Layer.merge(interruptedAuthority, idLayer))
    )
    const canvasId = Id.canvas("canvas_sqlite_accepted_unconfirmed")
    yield* authority.create(AuthorityModel.createCanvas({ canvasId, title: "Before" }), invocation)
    yield* Effect.scoped(Effect.gen(function*() {
      const replicaContext = yield* Layer.buildWithScope(firstLayer, yield* Effect.scope)
      const replica = Context.get(replicaContext, CanvasReplica)
      yield* replica.open(canvasId)
      yield* replica.change(ReplicaModel.change({
        canvasId,
        commands: decodeCanvasCommandBatch([{ _tag: "renameCanvas", expectedTitle: "Before", title: "After" }])
      }), invocation)
      expect(Exit.isFailure(yield* Effect.exit(replica.sync(canvasId)))).toBe(true)
    }))
    const secondLayer = SqliteCanvasReplica.layer({ path }).pipe(
      Layer.provide(Layer.merge(Layer.succeed(CanvasAuthority, trackedAuthority), idLayer))
    )
    yield* Effect.scoped(Effect.gen(function*() {
      const replicaContext = yield* Layer.buildWithScope(secondLayer, yield* Effect.scope)
      const replica = Context.get(replicaContext, CanvasReplica)
      expect((yield* replica.current(canvasId)).pending[0]?.state._tag).toBe("accepted-unconfirmed")
      const synced = yield* replica.sync(canvasId)
      expect(synced.view.pending).toEqual([])
      expect(synced.view.projection.title).toBe("After")
      expect(submits).toBe(1)
    }))
  }))))

  it("restores a ready offline change with its identity and attribution", () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const path = yield* tempDatabasePath
    const scope = yield* Effect.scope
    const authorityContext = yield* Layer.buildWithScope(
      MemoryCanvasAuthority.layer.pipe(Layer.provide(AuthorityClockLive)),
      scope
    )
    const authority = Context.get(authorityContext, CanvasAuthority)
    const originalId = Id.change("change_sqlite_ready_restart")
    const idLayer = Layer.succeed(ReplicaChangeIds, { next: Effect.succeed(originalId) })
    const dependencies = Layer.merge(Layer.succeed(CanvasAuthority, authority), idLayer)
    const replicaLayer = SqliteCanvasReplica.layer({ path }).pipe(Layer.provide(dependencies))
    const canvasId = Id.canvas("canvas_sqlite_ready_restart")
    yield* authority.create(AuthorityModel.createCanvas({ canvasId, title: "Before" }), invocation)
    yield* Effect.scoped(Effect.gen(function*() {
      const context = yield* Layer.buildWithScope(replicaLayer, yield* Effect.scope)
      const replica = Context.get(context, CanvasReplica)
      yield* replica.open(canvasId)
      yield* replica.change(ReplicaModel.change({
        canvasId,
        commands: decodeCanvasCommandBatch([{ _tag: "renameCanvas", expectedTitle: "Before", title: "Offline" }])
      }), invocation)
    }))
    yield* Effect.scoped(Effect.gen(function*() {
      const context = yield* Layer.buildWithScope(replicaLayer, yield* Effect.scope)
      const replica = Context.get(context, CanvasReplica)
      const restored = yield* replica.current(canvasId)
      expect(restored.pending[0]).toMatchObject({
        proposal: { changeId: originalId },
        state: { _tag: "ready" }
      })
      yield* replica.sync(canvasId)
      const page = yield* authority.changesAfter(AuthorityModel.changesAfter({
        canvasId,
        after: restored.acknowledgedCursor,
        limit: AuthorityModel.pageLimit(10)
      }))
      expect(page.changes[0]).toMatchObject({
        changeId: originalId,
        attribution: { person: { personId: "person_sqlite_replica" } }
      })
    }))
  }))))

  it("serializes independent handles without losing an update", () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const path = yield* tempDatabasePath
    const left = yield* buildStore(path)
    const right = yield* buildStore(path)
    const canvasId = Id.canvas("canvas_sqlite_replica_handles")
    yield* left.modify(canvasId, () => Result.succeed([undefined, stateFor(canvasId, "0")] as const))
    const increment = (store: ReplicaStore["Service"]) => store.modify(canvasId, (current) => {
      if (current === undefined) return Result.fail(new ExpectedFailure({ message: "replica missing" }))
      const value = Number(current.genesisProjection.title) + 1
      return Result.succeed([value, {
        ...current,
        genesisProjection: { ...current.genesisProjection, title: String(value) }
      }] as const)
    })
    const values = yield* Effect.all([increment(left), increment(right)], { concurrency: "unbounded" })
    expect(values.sort()).toEqual([1, 2])
    expect((yield* left.get(canvasId))?.genesisProjection.title).toBe("2")
  }))))

  it("yields while another connection holds the writer lock", () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const path = yield* tempDatabasePath
    const store = yield* buildStore(path)
    const canvasId = Id.canvas("canvas_sqlite_replica_lock")
    const lock = new DatabaseSync(path)
    lock.exec("BEGIN IMMEDIATE")
    const release = Effect.callback<void>((resume) => {
      const timer = setTimeout(() => {
        lock.exec("COMMIT")
        lock.close()
        resume(Effect.void)
      }, 10)
      return Effect.sync(() => clearTimeout(timer))
    })
    const write = store.modify(canvasId, () => Result.succeed([undefined, stateFor(canvasId, "Lock")] as const))
    yield* Effect.all([write, release], { concurrency: "unbounded" })
    expect((yield* store.get(canvasId))?.genesisProjection.title).toBe("Lock")
  }))))

  it("rolls back a state update after a SQL failure", () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const path = yield* tempDatabasePath
    const store = yield* buildStore(path)
    const canvasId = Id.canvas("canvas_sqlite_replica_rollback")
    yield* store.modify(canvasId, () => Result.succeed([undefined, stateFor(canvasId, "Before")] as const))
    const fault = new DatabaseSync(path)
    fault.exec("CREATE TRIGGER fail_replica_update BEFORE UPDATE ON replica_states BEGIN SELECT RAISE(ABORT, 'fault'); END")
    fault.close()
    const exit = yield* Effect.exit(store.modify(canvasId, (current) => current === undefined
      ? Result.fail(new ExpectedFailure({ message: "replica missing" }))
      : Result.succeed([
        undefined,
        { ...current, genesisProjection: { ...current.genesisProjection, title: "After" } }
      ] as const)))
    expect(Exit.isFailure(exit)).toBe(true)
    expect((yield* store.get(canvasId))?.genesisProjection.title).toBe("Before")
  }))))

  it("rejects corrupted stored state at the row boundary", () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const path = yield* tempDatabasePath
    const store = yield* buildStore(path)
    const canvasId = Id.canvas("canvas_sqlite_replica_corrupt")
    yield* store.modify(canvasId, () => Result.succeed([undefined, stateFor(canvasId, "Valid")] as const))
    const corrupt = new DatabaseSync(path)
    const other = Id.canvas("canvas_sqlite_replica_other")
    corrupt.prepare("UPDATE replica_states SET state_json = ?").run(JSON.stringify(
      Schema.encodeUnknownSync(ReplicaStateSchema)({
        ...stateFor(canvasId, "Valid"),
        genesisProjection: emptyCanvasProjection(other, "Wrong")
      })
    ))
    corrupt.close()
    expect(Exit.isFailure(yield* Effect.exit(store.get(canvasId)))).toBe(true)
  }))))

  it("strictly adopts a valid legacy authority database", () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const path = yield* tempDatabasePath
    const legacy = new DatabaseSync(path)
    legacy.exec(authorityTableSql.canvases)
    legacy.exec(authorityTableSql.accepted_changes)
    legacy.exec(authorityTableSql.retry_reservations)
    legacy.exec("PRAGMA user_version = 1")
    legacy.close()
    yield* buildStore(path)
    const inspect = new DatabaseSync(path)
    expect(inspect.prepare("SELECT migration_id, name FROM crit_migrations ORDER BY migration_id").all()).toEqual([
      { migration_id: 1, name: "authority" },
      { migration_id: 2, name: "replica_state" },
      { migration_id: 3, name: "agent_identities" }
    ])
    expect(inspect.prepare("PRAGMA user_version").get()).toEqual({ user_version: 0 })
    inspect.close()
  }))))

  it("preserves legacy authority data while authority and replica open together", () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const path = yield* tempDatabasePath
    const canvasId = Id.canvas("canvas_sqlite_legacy_data")
    const acceptedProposal = {
      canvasId,
      changeId: Id.change("change_sqlite_legacy_accepted"),
      observedCursor: null,
      commands: decodeCanvasCommandBatch([{ _tag: "renameCanvas", expectedTitle: "Before", title: "After" }])
    }
    const rejectedProposal = {
      canvasId,
      changeId: Id.change("change_sqlite_legacy_rejected"),
      observedCursor: null,
      commands: decodeCanvasCommandBatch([{ _tag: "renameCanvas", expectedTitle: "Wrong", title: "Rejected" }])
    }
    yield* Effect.scoped(Effect.gen(function*() {
      const authority = yield* buildAuthority(path)
      yield* authority.create(AuthorityModel.createCanvas({ canvasId, title: "Before" }), invocation)
      yield* authority.submit(acceptedProposal, invocation)
      yield* Effect.result(authority.submit(rejectedProposal, invocation))
    }))
    const legacy = new DatabaseSync(path)
    legacy.exec("DROP TABLE replica_states")
    legacy.exec("DROP TABLE agent_identities")
    legacy.exec("DROP TABLE crit_migrations")
    legacy.exec("PRAGMA user_version = 1")
    legacy.close()

    const [authority] = yield* Effect.all([buildAuthority(path), buildStore(path)], { concurrency: "unbounded" })
    expect((yield* authority.open(canvasId)).projection.title).toBe("After")
    expect((yield* authority.submit(acceptedProposal, invocation)).disposition).toBe("identical-retry")
    expect(Result.isFailure(yield* Effect.result(authority.submit(rejectedProposal, invocation)))).toBe(true)
    const replicaLayer = SqliteCanvasReplica.layer({ path }).pipe(Layer.provide(Layer.merge(
      Layer.succeed(CanvasAuthority, authority),
      Layer.succeed(ReplicaChangeIds, { next: Effect.succeed(Id.change("change_sqlite_legacy_next")) })
    )))
    const replicaContext = yield* Layer.buildWithScope(replicaLayer, yield* Effect.scope)
    const replica = Context.get(replicaContext, CanvasReplica)
    expect((yield* replica.open(canvasId)).projection.title).toBe("After")
  }))))

  it("rejects a partial legacy authority schema", () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const path = yield* tempDatabasePath
    const legacy = new DatabaseSync(path)
    legacy.exec(authorityTableSql.canvases)
    legacy.exec("PRAGMA user_version = 1")
    legacy.close()
    const result = yield* Effect.result(Effect.scoped(buildStore(path)))
    expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "LocalDatabaseOpenFailure" } })
  }))))

  it("rejects a future native migration", () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const path = yield* tempDatabasePath
    yield* Effect.scoped(buildStore(path))
    const future = new DatabaseSync(path)
    future.prepare("INSERT INTO crit_migrations (migration_id, name) VALUES (?, ?)").run(4, "future")
    future.close()
    const result = yield* Effect.result(Effect.scoped(buildStore(path)))
    expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "LocalDatabaseOpenFailure" } })
    if (Result.isFailure(result)) expect(result.failure.reason).toContain("newer than")
  }))))

  it.each([
    ["renamed", "UPDATE crit_migrations SET name = 'renamed' WHERE migration_id = 1"],
    ["gapped", "DELETE FROM crit_migrations WHERE migration_id = 1"],
    ["missing table", "DROP TABLE replica_states"]
  ])("rejects a %s native migration history", (_name, mutation) => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const path = yield* tempDatabasePath
    yield* Effect.scoped(buildStore(path))
    const invalid = new DatabaseSync(path)
    invalid.exec(mutation)
    invalid.close()
    const result = yield* Effect.result(Effect.scoped(buildStore(path)))
    expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "LocalDatabaseOpenFailure" } })
  }))))
})
