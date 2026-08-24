import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"

import {
  AuthorityClockLive,
  AuthorityModel,
  CanvasAuthority,
  PersonInvocation,
  authorityClockLayer
} from "@crit/authority"
import { authorityConformanceScenarios } from "@crit/authority/testing"
import { CanvasEngine, DomainValue, Id, IsoTimestamp, decodeCanvasCommandBatch, emptyCanvasProjection, engineChangeFromAccepted } from "@crit/domain"
import { Context, Deferred, Effect, Exit, Fiber, Layer, Schema } from "effect"
import { describe, expect, it } from "vitest"

import { SqliteCanvasAuthority } from "../src/index.js"

const person = Schema.decodeUnknownSync(PersonInvocation)({
  _tag: "person",
  principal: {
    _tag: "person",
    subject: "oidc|local",
    person: { _tag: "person", personId: "person_local", displayName: "Local" }
  }
})

const create = (canvasId: string) => AuthorityModel.createCanvas({
  canvasId: Id.canvas(canvasId), title: "Authority"
})

const tempDatabasePath = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), "crit-local-"))),
  (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true }))
).pipe(Effect.map((directory) => join(directory, "authority.sqlite")))

const sqliteLayer = (path: string, now?: Parameters<typeof authorityClockLayer>[0]) =>
  SqliteCanvasAuthority.layer({ path }).pipe(Layer.provide(
    now === undefined ? AuthorityClockLive : authorityClockLayer(now)
  ))

const buildSqliteAuthority = (options: {
  readonly path: string
  readonly now?: Parameters<typeof authorityClockLayer>[0]
}) => Effect.gen(function*() {
  const scope = yield* Effect.scope
  const context = yield* Layer.buildWithScope(sqliteLayer(options.path, options.now), scope)
  return Context.get(context, CanvasAuthority)
})

describe("SQLite CanvasAuthority", () => {
  for (const scenario of authorityConformanceScenarios((options) => Layer.unwrap(
    tempDatabasePath.pipe(Effect.map((path) => sqliteLayer(path, options?.now)))
  ))) {
    it(scenario.name, () => Effect.runPromise(Effect.scoped(scenario.run)))
  }

  it("persists state across scoped handles", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const path = yield* tempDatabasePath
      const original = yield* Effect.scoped(Effect.gen(function*() {
      const authority = yield* buildSqliteAuthority({ path })
      const canvasId = Id.canvas("canvas_restart")
      yield* authority.create(create(canvasId), person)
      const accepted = yield* authority.submit({
        canvasId, changeId: Id.change("change_restart_accepted"), observedCursor: null,
        commands: decodeCanvasCommandBatch([{ _tag: "rename-canvas", expectedTitle: "Authority", title: "Review" }])
      }, person)
      const rejected = yield* Effect.result(authority.submit({
        canvasId, changeId: Id.change("change_restart_rejected"), observedCursor: null,
        commands: decodeCanvasCommandBatch([{ _tag: "rename-canvas", expectedTitle: "Wrong", title: "Rejected" }])
      }, person))
      return { accepted, rejected }
      }))
      yield* Effect.scoped(Effect.gen(function*() {
      const authority = yield* buildSqliteAuthority({ path })
      const canvasId = Id.canvas("canvas_restart")
      const acceptedProposal = {
        canvasId, changeId: Id.change("change_restart_accepted"), observedCursor: null,
        commands: decodeCanvasCommandBatch([{ _tag: "rename-canvas", expectedTitle: "Authority", title: "Review" }])
      }
      const acceptedRetry = yield* authority.submit(acceptedProposal, person)
      expect(acceptedRetry.disposition).toBe("identical-retry")
      expect(acceptedRetry.change).toEqual(original.accepted.change)
      const rejectedProposal = {
        canvasId, changeId: Id.change("change_restart_rejected"), observedCursor: null,
        commands: decodeCanvasCommandBatch([{ _tag: "rename-canvas", expectedTitle: "Wrong", title: "Rejected" }])
      }
      const rejectedRetry = yield* Effect.result(authority.submit(rejectedProposal, person))
      expect(rejectedRetry).toEqual(original.rejected)
      const changedRetry = yield* Effect.result(authority.submit({
        ...rejectedProposal,
        commands: decodeCanvasCommandBatch([{ _tag: "rename-canvas", expectedTitle: "Review", title: "Other" }])
      }, person))
      expect(changedRetry._tag === "Failure" && changedRetry.failure._tag).toBe("change-id-reused")
      const next = yield* authority.submit({
        canvasId, changeId: Id.change("change_restart_next"), observedCursor: null,
        commands: decodeCanvasCommandBatch([{ _tag: "rename-canvas", expectedTitle: "Review", title: "Final" }])
      }, person)
      expect(next.change.sequence).toBe(2)
      const page = yield* authority.changesAfter({
        _tag: "changes-after", canvasId, after: null, limit: AuthorityModel.pageLimit(100)
      })
      const view = yield* authority.open(canvasId)
      const replay = CanvasEngine.replay(emptyCanvasProjection(canvasId, "Authority"), page.changes.map(engineChangeFromAccepted))
      expect(view.projection.title).toBe("Final")
      expect(page.changes).toHaveLength(2)
      expect(replay._tag === "replayed" && replay.projection).toEqual(view.projection)
      }))
    })))
  })

  it("treats representation state key order as the same retry", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const path = yield* tempDatabasePath
      const authority = yield* buildSqliteAuthority({ path })
      const canvasId = Id.canvas("canvas_semantic")
      yield* authority.create(create(canvasId), person)
      const base = {
        canvasId,
        changeId: Id.change("change_semantic"),
        observedCursor: null,
        commands: decodeCanvasCommandBatch([{
          _tag: "add-frame",
          frameId: "frame_semantic",
          title: "Frame",
          representation: { _tag: "application-route", applicationId: "application_semantic", route: "/", state: { a: 1, b: 2 } },
          status: "in-progress",
          geometry: { x: 0, y: 0, width: 10, height: 10 }
        }])
      }
      yield* authority.submit(base, person)
      const retry = yield* authority.submit({
        ...base,
        commands: decodeCanvasCommandBatch([{
          _tag: "add-frame",
          frameId: "frame_semantic",
          title: "Frame",
          representation: { _tag: "application-route", applicationId: "application_semantic", route: "/", state: { b: 2, a: 1 } },
          status: "in-progress",
          geometry: { x: 0, y: 0, width: 10, height: 10 }
        }])
      }, person)
      expect(retry.disposition).toBe("identical-retry")
    })))
  })

  it("owns submitted graphs before the clock suspends", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const path = yield* tempDatabasePath
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      let reads = 0
      const timestamp = Schema.decodeUnknownSync(IsoTimestamp)("2026-08-22T12:00:00.000Z")
      const now = Effect.suspend(() => {
        reads += 1
        return reads === 2
          ? Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.as(timestamp))
          : Effect.succeed(timestamp)
      })
      const authority = yield* buildSqliteAuthority({ path, now })
      const canvasId = Id.canvas("canvas_owned")
      yield* authority.create(create(canvasId), person)
      const incomingPerson = DomainValue.detach(person)
      const incoming = {
        canvasId,
        changeId: Id.change("change_owned"),
        observedCursor: null,
        commands: decodeCanvasCommandBatch([{
          _tag: "rename-canvas", expectedTitle: "Authority", title: "Review"
        }])
      }
      const fiber = yield* Effect.forkChild(authority.submit(incoming, incomingPerson))
      yield* Deferred.await(entered)
      Reflect.set(incoming.commands[0], "title", "Mutated")
      Reflect.set(incomingPerson.principal.person, "displayName", "Mutated")
      yield* Deferred.succeed(release, undefined)
      const receipt = yield* Fiber.join(fiber)
      const view = yield* authority.open(canvasId)
      expect(receipt.change.commands[0]).toMatchObject({ title: "Review" })
      expect(receipt.change.attribution).toMatchObject({ person: { displayName: "Local" } })
      expect(view.projection.title).toBe("Review")
    })))
  })

  it("keeps sequences gap-free across independent handles", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const path = yield* tempDatabasePath
      const left = yield* buildSqliteAuthority({ path })
      const right = yield* buildSqliteAuthority({ path })
      const canvasId = Id.canvas("canvas_handles")
      yield* left.create(create(canvasId), person)
      const submit = (index: number, authority: typeof left) => authority.submit({
        canvasId,
        changeId: Id.change(`change_handle_${index}`),
        observedCursor: null,
        commands: decodeCanvasCommandBatch([{
          _tag: "add-note",
          noteId: `note_handle_${index}`,
          text: `Note ${index}`,
          geometry: { x: index, y: 0, width: 10, height: 10 },
          attachedFrameId: null,
          color: "blue"
        }])
      }, person)
      const receipts = yield* Effect.all([submit(1, left), submit(2, right)], { concurrency: "unbounded" })
      expect(receipts.map((receipt) => receipt.change.sequence).sort()).toEqual([1, 2])
    })))
  })

  it("yields while another connection holds the writer lock", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const path = yield* tempDatabasePath
      const authority = yield* buildSqliteAuthority({ path })
      const canvasId = Id.canvas("canvas_lock")
      yield* authority.create(create(canvasId), person)
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
      const submitted = authority.submit({
        canvasId,
        changeId: Id.change("change_lock"),
        observedCursor: null,
        commands: decodeCanvasCommandBatch([{
          _tag: "rename-canvas", expectedTitle: "Authority", title: "Review"
        }])
      }, person)
      const [receipt] = yield* Effect.all([submitted, release], { concurrency: "unbounded" })
      expect(receipt.change.sequence).toBe(1)
    })))
  })

  it("rolls back the ledger when checkpoint update fails", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const path = yield* tempDatabasePath
      const authority = yield* buildSqliteAuthority({ path })
      const canvasId = Id.canvas("canvas_rollback")
      yield* authority.create(create(canvasId), person)
      const fault = new DatabaseSync(path)
      fault.exec(`CREATE TRIGGER fail_checkpoint BEFORE UPDATE ON canvases
        BEGIN SELECT RAISE(ABORT, 'checkpoint fault'); END`)
      fault.close()
      const proposal = {
        canvasId,
        changeId: Id.change("change_rollback"),
        observedCursor: null,
        commands: decodeCanvasCommandBatch([{
          _tag: "rename-canvas", expectedTitle: "Authority", title: "Review"
        }])
      }
      const failed = yield* Effect.exit(authority.submit(proposal, person))
      expect(Exit.isFailure(failed)).toBe(true)
      const inspect = new DatabaseSync(path)
      expect(inspect.prepare("SELECT count(*) AS count FROM accepted_changes").get()).toEqual({ count: 0 })
      expect(inspect.prepare("SELECT count(*) AS count FROM retry_reservations").get()).toEqual({ count: 0 })
      expect(inspect.prepare("SELECT current_sequence FROM canvases").get()).toEqual({ current_sequence: 0 })
      inspect.exec("DROP TRIGGER fail_checkpoint")
      inspect.close()
      const accepted = yield* authority.submit(proposal, person)
      expect(accepted.change.sequence).toBe(1)
    })))
  })

  it("rejects a future database schema", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const path = yield* tempDatabasePath
    const database = new DatabaseSync(path)
    database.exec("PRAGMA user_version = 2")
    database.close()
    const result = yield* Effect.result(Effect.scoped(buildSqliteAuthority({ path })))
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("LocalDatabaseOpenFailure")
      expect(result.failure.reason).toContain("newer than")
    }
    })))
  })

  it("enforces relational integrity", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const path = yield* tempDatabasePath
      const authority = yield* buildSqliteAuthority({ path })
      const canvasId = Id.canvas("canvas_integrity")
      yield* authority.create(create(canvasId), person)
      yield* Effect.result(authority.submit({
        canvasId, changeId: Id.change("change_integrity"), observedCursor: null,
        commands: decodeCanvasCommandBatch([{ _tag: "rename-canvas", expectedTitle: "Wrong", title: "Rejected" }])
      }, person))
    const database = new DatabaseSync(path)
    database.exec("PRAGMA foreign_keys = ON")
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([])
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" })
    expect(() => database.prepare(`INSERT INTO retry_reservations
      (canvas_id, change_id, proposal_json, authorization_subject, accepted_sequence, rejected_failure_json)
      VALUES (?, ?, '{}', 'subject', NULL, '{}')`
    ).run("canvas_orphan", "change_orphan")).toThrow()
    expect(() => database.exec("INSERT INTO retry_reservations SELECT * FROM retry_reservations")).toThrow()
    database.close()
    })))
  })

  it("detects corrupted checkpoint JSON", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const path = yield* tempDatabasePath
    yield* Effect.scoped(Effect.gen(function*() {
      const authority = yield* buildSqliteAuthority({ path })
      const canvasId = Id.canvas("canvas_corrupt")
      yield* authority.create(create(canvasId), person)
      yield* authority.submit({
        canvasId, changeId: Id.change("change_corrupt"), observedCursor: null,
        commands: decodeCanvasCommandBatch([{ _tag: "rename-canvas", expectedTitle: "Authority", title: "Review" }])
      }, person)
    }))
    const database = new DatabaseSync(path)
    database.prepare("UPDATE canvases SET current_cursor = ?").run("cursor_corrupt_head")
    database.close()
    const exit = yield* Effect.exit(Effect.scoped(Effect.gen(function*() {
      const authority = yield* buildSqliteAuthority({ path })
      yield* authority.open(Id.canvas("canvas_corrupt"))
    })))
    expect(Exit.isFailure(exit)).toBe(true)
    })))
  })
})
