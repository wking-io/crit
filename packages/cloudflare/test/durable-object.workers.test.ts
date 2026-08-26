import {
  AuthorityModel,
  CanvasAuthority,
  PersonInvocation
} from "@crit/authority"
import {
  authorityConformanceScenarios,
  type AuthorityConformanceFactory
} from "@crit/authority/testing"
import {
  CanvasEngine,
  Id,
  decodeCanvasCommandBatch,
  emptyCanvasProjection
} from "@crit/domain"
import { env } from "cloudflare:workers"
import {
  abortAllDurableObjects,
  evictDurableObject,
  listDurableObjectIds,
  runInDurableObject
} from "cloudflare:test"
import { Cause, Context, Effect, Exit, Layer, Result, Schema } from "effect"
import { beforeEach, describe, expect, it } from "vitest"

import { durableObjectLayer } from "../src/durable-authority.js"
import {
  DurableSqlRowLimitExceeded,
  durableObjectSqlRowLimitBytes
} from "../src/stored-json.js"
import { registerTestClock } from "../src/worker.js"

const person = Schema.decodeUnknownSync(PersonInvocation)({
  _tag: "person",
  principal: {
    _tag: "person",
    subject: "oidc|cloudflare-workerd",
    person: {
      _tag: "person",
      personId: "person_cloudflare_workerd",
      displayName: "Cloudflare Workerd"
    }
  }
})

const create = (canvasId: string) => AuthorityModel.createCanvas({
  canvasId: Id.canvas(canvasId),
  title: "Authority"
})

const factory: AuthorityConformanceFactory = (options) => {
  const now = options?.now
  if (now === undefined) return durableObjectLayer(env.CANVASES)
  const clock = Effect.acquireRelease(
    Effect.sync(() => registerTestClock(now)),
    (registered) => Effect.sync(registered.close)
  )
  return Layer.unwrap(clock.pipe(
    Effect.map((registered) => durableObjectLayer(env.CANVASES, {
      testClockId: registered.id
    }))
  ))
}

const buildDurableAuthority = Effect.gen(function*() {
  const scope = yield* Effect.scope
  const context = yield* Layer.buildWithScope(
    durableObjectLayer(env.CANVASES),
    scope
  )
  return Context.get(context, CanvasAuthority)
})

const conformance = authorityConformanceScenarios(factory)
const interrupted = conformance.find(
  (scenario) => scenario.name === "interrupted submission is atomic"
)
if (interrupted === undefined) {
  throw new Error("interrupted submission conformance scenario is missing")
}

beforeEach(async () => {
  await abortAllDurableObjects()
  const ids = await listDurableObjectIds(env.CANVASES)
  for (const id of ids) {
    await runInDurableObject(
      env.CANVASES.get(id),
      (_instance, state) => state.storage.deleteAll()
    )
  }
  await abortAllDurableObjects()
})

describe("CanvasDurableObject", () => {
  for (const scenario of conformance.filter(
    (candidate) => candidate !== interrupted
  )) {
    it(scenario.name, () => Effect.runPromise(Effect.scoped(scenario.run)))
  }

  it("persists state across eviction and reconstruction", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const authority = yield* buildDurableAuthority
      const canvasId = Id.canvas("canvas_workerd_restart")
      yield* authority.create(create(canvasId), person)
      const acceptedProposal = {
        canvasId,
        changeId: Id.change("change_workerd_restart_accepted"),
        observedCursor: null,
        commands: decodeCanvasCommandBatch([{
          _tag: "renameCanvas",
          expectedTitle: "Authority",
          title: "Review"
        }])
      }
      const accepted = yield* authority.submit(acceptedProposal, person)
      const rejectedProposal = {
        canvasId,
        changeId: Id.change("change_workerd_restart_rejected"),
        observedCursor: null,
        commands: decodeCanvasCommandBatch([{
          _tag: "renameCanvas",
          expectedTitle: "Wrong",
          title: "Rejected"
        }])
      }
      const rejected = yield* Effect.result(
        authority.submit(rejectedProposal, person)
      )

      const stub = env.CANVASES.get(env.CANVASES.idFromName(canvasId))
      yield* Effect.promise(() => evictDurableObject(stub))

      const acceptedRetry = yield* authority.submit(acceptedProposal, person)
      expect(acceptedRetry.disposition).toBe("identical-retry")
      expect(acceptedRetry.change).toEqual(accepted.change)

      const rejectedRetry = yield* Effect.result(
        authority.submit(rejectedProposal, person)
      )
      expect(rejectedRetry).toEqual(rejected)

      const changedRetry = yield* Effect.result(authority.submit({
        ...rejectedProposal,
        commands: decodeCanvasCommandBatch([{
          _tag: "renameCanvas",
          expectedTitle: "Review",
          title: "Other"
        }])
      }, person))
      expect(
        changedRetry._tag === "Failure" && changedRetry.failure._tag
      ).toBe("change-id-reused")

      const next = yield* authority.submit({
        canvasId,
        changeId: Id.change("change_workerd_restart_next"),
        observedCursor: null,
        commands: decodeCanvasCommandBatch([{
          _tag: "renameCanvas",
          expectedTitle: "Review",
          title: "Final"
        }])
      }, person)
      expect(next.change.sequence).toBe(2)

      const page = yield* authority.changesAfter({
        _tag: "changes-after",
        canvasId,
        after: null,
        limit: AuthorityModel.pageLimit(100)
      })
      const view = yield* authority.open(canvasId)
      const replay = CanvasEngine.replay(
        emptyCanvasProjection(canvasId, "Authority"),
        page.changes
      )
      expect(page.changes).toHaveLength(2)
      expect(
        replay._tag === "replayed" && replay.projection
      ).toEqual(view.projection)
    })))
  })

  it("rolls back an oversized application route", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const authority = yield* buildDurableAuthority
      const canvasId = Id.canvas("canvas_workerd_oversized")
      yield* authority.create(create(canvasId), person)

      const failed = yield* Effect.exit(authority.submit({
        canvasId,
        changeId: Id.change("change_workerd_oversized"),
        observedCursor: null,
        commands: decodeCanvasCommandBatch([
          {
            _tag: "renameCanvas",
            expectedTitle: "Authority",
            title: "Changed"
          },
          {
            _tag: "addFrame",
            frameId: "frame_workerd_oversized",
            title: "Oversized",
            representation: {
              _tag: "application-route",
              applicationId: "application_workerd_oversized",
              route: "/",
              state: { value: "x".repeat(durableObjectSqlRowLimitBytes) }
            },
            status: "in-progress",
            geometry: { x: 0, y: 0, width: 10, height: 10 }
          }
        ])
      }, person))

      expect(Exit.isFailure(failed)).toBe(true)
      if (Exit.isSuccess(failed)) throw new Error("oversized submit succeeded")
      const defect = Result.getOrThrow(Cause.findDefect(failed.cause))
      expect(defect).toBeInstanceOf(DurableSqlRowLimitExceeded)
      expect(defect).toMatchObject({
        _tag: "DurableSqlRowLimitExceeded",
        limit: durableObjectSqlRowLimitBytes
      })

      const view = yield* authority.open(canvasId)
      expect(view.projection.title).toBe("Authority")
      expect(view.projection.frames).toHaveLength(0)
    })))
  })

  it(interrupted.name, () => Effect.runPromise(Effect.scoped(interrupted.run)))
})
