import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  AuthorityClockLive,
  AuthorityModel,
  CanvasAuthority,
  PersonInvocation,
  authorityClockLayer
} from "@crit/authority"
import { authorityConformanceScenarios } from "@crit/authority/testing"
import {
  CanvasEngine,
  Id,
  decodeCanvasCommandBatch,
  emptyCanvasProjection
} from "@crit/domain"
import { Cause, Context, Effect, Exit, Layer, Result, Schema } from "effect"
import { describe, expect, it } from "vitest"

import { CloudflareCanvasAuthority } from "../src/index.js"
import {
  DurableSqlRowLimitExceeded,
  durableObjectSqlRowLimitBytes
} from "../src/stored-json.js"

const person = Schema.decodeUnknownSync(PersonInvocation)({
  _tag: "person",
  principal: {
    _tag: "person",
    subject: "oidc|cloudflare",
    person: {
      _tag: "person",
      personId: "person_cloudflare",
      displayName: "Cloudflare",
      email: { _tag: "unspecified" }
    }
  }
})

const create = (canvasId: string) => AuthorityModel.createCanvas({
  canvasId: Id.canvas(canvasId),
  title: "Authority"
})

const tempDirectory = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), "crit-cloudflare-"))),
  (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true }))
)

const cloudflareLayer = (
  directory: string,
  now?: Parameters<typeof authorityClockLayer>[0]
) => CloudflareCanvasAuthority.layer({ directory }).pipe(Layer.provide(
  now === undefined ? AuthorityClockLive : authorityClockLayer(now)
))

const factory = (options?: { readonly now?: Parameters<typeof authorityClockLayer>[0] }) =>
  Layer.unwrap(tempDirectory.pipe(Effect.map((directory) => cloudflareLayer(
    directory,
    options?.now
  ))))

const buildCloudflareAuthority = (options: {
  readonly directory: string
  readonly now?: Parameters<typeof authorityClockLayer>[0]
}) => Effect.gen(function*() {
  const scope = yield* Effect.scope
  const context = yield* Layer.buildWithScope(
    cloudflareLayer(options.directory, options.now),
    scope
  )
  return Context.get(context, CanvasAuthority)
})

describe("Cloudflare CanvasAuthority", () => {
  for (const scenario of authorityConformanceScenarios(factory)) {
    it(scenario.name, () => Effect.runPromise(Effect.scoped(scenario.run)))
  }

  it("persists state across scoped handles", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const directory = yield* tempDirectory
      const original = yield* Effect.scoped(Effect.gen(function*() {
        const authority = yield* buildCloudflareAuthority({ directory })
        const canvasId = Id.canvas("canvas_restart")
        yield* authority.create(create(canvasId), person)
        const accepted = yield* authority.submit({
          canvasId,
          changeId: Id.change("change_restart_accepted"),
          observedCursor: null,
          commands: decodeCanvasCommandBatch([{
            _tag: "renameCanvas",
            expectedTitle: "Authority",
            title: "Review"
          }])
        }, person)
        const rejected = yield* Effect.result(authority.submit({
          canvasId,
          changeId: Id.change("change_restart_rejected"),
          observedCursor: null,
          commands: decodeCanvasCommandBatch([{
            _tag: "renameCanvas",
            expectedTitle: "Wrong",
            title: "Rejected"
          }])
        }, person))
        return { accepted, rejected }
      }))

      yield* Effect.scoped(Effect.gen(function*() {
        const authority = yield* buildCloudflareAuthority({ directory })
        const canvasId = Id.canvas("canvas_restart")
        const acceptedProposal = {
          canvasId,
          changeId: Id.change("change_restart_accepted"),
          observedCursor: null,
          commands: decodeCanvasCommandBatch([{
            _tag: "renameCanvas",
            expectedTitle: "Authority",
            title: "Review"
          }])
        }
        const acceptedRetry = yield* authority.submit(acceptedProposal, person)
        expect(acceptedRetry.disposition).toBe("identical-retry")
        expect(acceptedRetry.change).toEqual(original.accepted.change)

        const rejectedProposal = {
          canvasId,
          changeId: Id.change("change_restart_rejected"),
          observedCursor: null,
          commands: decodeCanvasCommandBatch([{
            _tag: "renameCanvas",
            expectedTitle: "Wrong",
            title: "Rejected"
          }])
        }
        const rejectedRetry = yield* Effect.result(
          authority.submit(rejectedProposal, person)
        )
        expect(rejectedRetry).toEqual(original.rejected)

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
          changeId: Id.change("change_restart_next"),
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
        expect(view.projection.title).toBe("Final")
        expect(page.changes).toHaveLength(2)
        expect(
          replay._tag === "replayed" && replay.projection
        ).toEqual(view.projection)
      }))
    })))
  })

  it("rolls back a submit whose change exceeds the Durable Object SQL row limit", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const directory = yield* tempDirectory
      const authority = yield* buildCloudflareAuthority({ directory })
      const canvasId = Id.canvas("canvas_oversized_change")
      yield* authority.create(create(canvasId), person)

      const failed = yield* Effect.exit(authority.submit({
        canvasId,
        changeId: Id.change("change_oversized"),
        observedCursor: null,
        commands: decodeCanvasCommandBatch([
          {
            _tag: "renameCanvas",
            expectedTitle: "Authority",
            title: "Changed"
          },
          {
            _tag: "addFrame",
            frameId: "frame_oversized",
            title: "Oversized",
            representation: {
              _tag: "application-route",
              applicationId: "application_oversized",
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
})
