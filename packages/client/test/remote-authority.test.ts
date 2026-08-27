import { createServer, type Server } from "node:http"

import {
  AuthorityClockLive,
  AuthorityModel,
  AuthorityView,
  CanvasAuthority,
  CanvasNotFound,
  CursorNotFound,
  MemoryCanvasAuthority,
  PersonInvocation
} from "@crit/authority"
import { EmailAddress, Id, decodeCanvasCommandBatch } from "@crit/domain"
import {
  ChangeProtocol,
  decodeSubmitCanvasChangeWire,
  parseChangesAfterSearch,
  parseRemoteAuthorityPath,
  RemoteAuthorityRoute
} from "@crit/protocol"
import {
  CanvasReplica,
  MemoryCanvasReplicaLive,
  ReplicaChangeIds,
  ReplicaModel
} from "@crit/replica"
import { Effect, Layer, Predicate, Result, Schema } from "effect"
import { describe, expect, it } from "vitest"

import {
  overlayRemoteLedger,
  RemoteAuthorityOptions,
  RemoteCanvasAuthority,
  routeSharedCanvases
} from "../src/remote-authority.js"

const TcpAddress = Schema.Struct({
  port: Schema.Int.check(Schema.isGreaterThan(0))
})

const accessEmail = Schema.decodeUnknownSync(EmailAddress)("ada@acme.com")
const person = Schema.decodeUnknownSync(PersonInvocation)({
  _tag: "person",
  principal: {
    _tag: "person",
    subject: "access|ada@acme.com",
    person: {
      _tag: "person",
      personId: "person_ada",
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
      personId: "person_grace",
      displayName: "Grace Hopper",
      email: { _tag: "access", address: "grace@acme.com" }
    }
  }
})

const rename = decodeCanvasCommandBatch([{
  _tag: "renameCanvas",
  expectedTitle: "Checkout",
  title: "Review"
}])

const writeJson = (
  response: import("node:http").ServerResponse,
  status: number,
  body: string
) => {
  response.writeHead(status, { "content-type": "application/json" }).end(body)
}

const readBody = (request: import("node:http").IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    let contents = ""
    request.setEncoding("utf8")
    request.on("data", (chunk: string) => {
      contents += chunk
    })
    request.on("end", () => resolve(contents))
    request.on("error", reject)
  })

const serveAuthority = (
  authority: CanvasAuthority["Service"]
) => Effect.acquireRelease(
  Effect.promise(() => new Promise<{
    readonly origin: string
    readonly server: Server
  }>((resolve, reject) => {
    const server = createServer((request, response) => {
      void (async() => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1")
        if (request.headers["cf-access-authenticated-user-email"] !== accessEmail) {
          response.writeHead(401).end()
          return
        }
        const route = parseRemoteAuthorityPath(url.pathname)
        if (route === undefined) {
          response.writeHead(404).end()
          return
        }
        if (RemoteAuthorityRoute.$is("canvas")(route)) {
          if (request.method !== "GET") {
            response.writeHead(405).end()
            return
          }
          const opened = await Effect.runPromise(Effect.result(authority.open(route.canvasId)))
          if (Result.isSuccess(opened)) {
            writeJson(response, 200, JSON.stringify(Schema.encodeSync(AuthorityView)(opened.success)))
            return
          }
          writeJson(response, 404, JSON.stringify(Schema.encodeSync(CanvasNotFound)(opened.failure)))
          return
        }
        if (request.method === "GET") {
          const query = parseChangesAfterSearch(url.search)
          if (query === undefined) {
            response.writeHead(400).end()
            return
          }
          const page = await Effect.runPromise(Effect.result(authority.changesAfter(
            AuthorityModel.changesAfter({
              canvasId: route.canvasId,
              after: query.after,
              limit: AuthorityModel.pageLimit(query.limit)
            })
          )))
          if (Result.isSuccess(page)) {
            writeJson(response, 200, JSON.stringify(ChangeProtocol.page.encode(page.success)))
            return
          }
          const schema = Predicate.isTagged(page.failure, "canvasNotFound") ? CanvasNotFound : CursorNotFound
          writeJson(response, 404, JSON.stringify(Schema.encodeSync(schema)(page.failure)))
          return
        }
        if (request.method !== "POST") {
          response.writeHead(405).end()
          return
        }
        const decoded = decodeSubmitCanvasChangeWire(JSON.parse(await readBody(request)))
        if (Result.isFailure(decoded) || decoded.success.proposal.canvasId !== route.canvasId) {
          response.writeHead(400).end()
          return
        }
        const submitted = await Effect.runPromise(Effect.result(
          authority.submit(decoded.success.proposal, decoded.success.invocation)
        ))
        if (Result.isSuccess(submitted)) {
          writeJson(response, 200, JSON.stringify(ChangeProtocol.receipt.encode(submitted.success)))
          return
        }
        const status = Predicate.isTagged(submitted.failure, "changeRejected")
          || Predicate.isTagged(submitted.failure, "changeIdReused")
          ? 409
          : 404
        writeJson(response, status, JSON.stringify(submitted.failure))
      })().catch(() => {
        if (!response.headersSent) response.writeHead(500).end()
      })
    })
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = Schema.decodeUnknownSync(TcpAddress)(server.address())
      resolve({
        origin: `http://127.0.0.1:${address.port}`,
        server
      })
    })
  })),
  ({ server }) => Effect.promise(() => new Promise<void>((finish) => {
    server.close(() => finish())
  }))
)

const remoteFrom = (origin: string) => RemoteCanvasAuthority.pipe(
  Effect.provide(RemoteCanvasAuthority.layer(RemoteAuthorityOptions.make({
    baseUrl: origin,
    accessEmail
  })))
)

const memoryAuthority = MemoryCanvasAuthority.layer.pipe(Layer.provide(AuthorityClockLive))

describe("RemoteCanvasAuthority", () => {
  it("pushes by change ID and pulls after the cursor", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const authority = yield* CanvasAuthority
      const served = yield* serveAuthority(authority)
      const remote = yield* remoteFrom(served.origin)
      const canvasId = Id.canvas("canvas_remote_ledger")
      const created = yield* authority.create(
        AuthorityModel.createCanvas({ canvasId, title: "Checkout" }),
        person
      )
      const first = yield* remote.submit({
        changeId: Id.change("change_remote_rename"),
        canvasId,
        observedCursor: created.cursor,
        commands: rename
      }, person)
      const retry = yield* remote.submit({
        changeId: Id.change("change_remote_rename"),
        canvasId,
        observedCursor: created.cursor,
        commands: rename
      }, person)
      const pulled = yield* remote.changesAfter(AuthorityModel.changesAfter({
        canvasId,
        after: created.cursor,
        limit: AuthorityModel.pageLimit(100)
      }))
      const tail = yield* remote.changesAfter(AuthorityModel.changesAfter({
        canvasId,
        after: first.change.cursor,
        limit: AuthorityModel.pageLimit(100)
      }))

      expect(first.disposition).toBe("first-acceptance")
      expect(retry.disposition).toBe("identical-retry")
      expect(retry.change.changeId).toBe(first.change.changeId)
      expect(pulled.changes.map((change) => change.changeId)).toEqual(["change_remote_rename"])
      expect(pulled.hasMore).toBe(false)
      expect(tail.changes).toEqual([])
      expect(tail.cursor).toBe(first.change.cursor)
    }).pipe(Effect.provide(memoryAuthority))))
  )

  it("opens a missing Canvas as canvasNotFound", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const authority = yield* CanvasAuthority
      const served = yield* serveAuthority(authority)
      const remote = yield* remoteFrom(served.origin)
      const failure = yield* remote.open(Id.canvas("canvas_remote_missing")).pipe(Effect.flip)

      expect(Predicate.isTagged(failure, "canvasNotFound")).toBe(true)
    }).pipe(Effect.provide(memoryAuthority))))
  )

  it("lets a replica sync through the remote ledger", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const memory = yield* CanvasAuthority
      const served = yield* serveAuthority(memory)
      const remote = yield* remoteFrom(served.origin)
      const canvasId = Id.canvas("canvas_remote_replica")
      yield* memory.create(
        AuthorityModel.createCanvas({ canvasId, title: "Checkout" }),
        person
      )
      const overlay = Layer.succeed(
        CanvasAuthority,
        overlayRemoteLedger(memory.create, remote)
      )
      const ids = Layer.succeed(ReplicaChangeIds, {
        next: Effect.succeed(Id.change("change_remote_replica_rename"))
      })
      const replica = yield* CanvasReplica.pipe(Effect.provide(
        MemoryCanvasReplicaLive.pipe(Layer.provide(overlay), Layer.provide(ids))
      ))
      yield* replica.open(canvasId)
      yield* replica.change(ReplicaModel.change({ canvasId, commands: rename }), person)
      const synced = yield* replica.sync(canvasId)

      expect(synced.view.pending).toEqual([])
      expect(synced.view.projection.title).toBe("Review")
      expect(synced.pulled + synced.acknowledged).toBeGreaterThan(0)
    }).pipe(Effect.provide(memoryAuthority))))
  )

  it("pulls a reviewer's accepted change through the remote ledger", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const memory = yield* CanvasAuthority
      const served = yield* serveAuthority(memory)
      const remote = yield* remoteFrom(served.origin)
      const canvasId = Id.canvas("canvas_remote_reviewer")
      yield* memory.create(
        AuthorityModel.createCanvas({ canvasId, title: "Checkout" }),
        person
      )
      const overlay = Layer.succeed(
        CanvasAuthority,
        overlayRemoteLedger(memory.create, remote)
      )
      const ids = Layer.succeed(ReplicaChangeIds, {
        next: Effect.succeed(Id.change("change_remote_reviewer_author"))
      })
      const replica = yield* CanvasReplica.pipe(Effect.provide(
        MemoryCanvasReplicaLive.pipe(Layer.provide(overlay), Layer.provide(ids))
      ))
      yield* replica.open(canvasId)
      const added = yield* replica.change(ReplicaModel.change({
        canvasId,
        commands: decodeCanvasCommandBatch([{
          _tag: "addFrame",
          frameId: "frame_checkout",
          title: "Checkout",
          representation: {
            _tag: "applicationRoute",
            applicationId: "application_remote_reviewer",
            route: "/",
            state: {}
          },
          status: "in-progress",
          geometry: { x: 0, y: 0, width: 800, height: 600 }
        }])
      }), person)
      const pushed = yield* replica.sync(canvasId)
      yield* memory.submit({
        canvasId,
        changeId: Id.change("change_remote_reviewer_approve"),
        observedCursor: pushed.view.acknowledgedCursor,
        commands: decodeCanvasCommandBatch([{
          _tag: "setFrameStatus",
          frameId: "frame_checkout",
          expectedChangedByChangeId: added.changeId,
          status: "approved"
        }])
      }, reviewer)
      const synced = yield* replica.sync(canvasId)

      expect(synced.pulled).toBe(1)
      expect(synced.view.pending).toEqual([])
      expect(synced.view.projection.frames[0]?.status).toBe("approved")
    }).pipe(Effect.provide(memoryAuthority))))
  )

  it("keeps unshared canvases on the local ledger", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const local = yield* CanvasAuthority
      const served = yield* serveAuthority(local)
      const remote = yield* remoteFrom(served.origin)
      const canvasId = Id.canvas("canvas_route_local")
      const routed = routeSharedCanvases(local, remote, () => Effect.succeed(false))
      yield* routed.create(
        AuthorityModel.createCanvas({ canvasId, title: "Local" }),
        person
      )
      const opened = yield* routed.open(canvasId)
      expect(opened.projection.title).toBe("Local")
    }).pipe(Effect.provide(memoryAuthority))))
  )

  it("opens a shared canvas on the remote ledger", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const memory = yield* CanvasAuthority
      const served = yield* serveAuthority(memory)
      const remote = yield* remoteFrom(served.origin)
      const canvasId = Id.canvas("canvas_route_shared")
      yield* memory.create(
        AuthorityModel.createCanvas({ canvasId, title: "Remote" }),
        person
      )
      const routed = routeSharedCanvases(memory, remote, (id) => Effect.succeed(id === canvasId))
      const opened = yield* routed.open(canvasId)
      expect(opened.projection.title).toBe("Remote")
    }).pipe(Effect.provide(memoryAuthority))))
  )

  it("fails a mismatched change page with an upgrade error", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const served = yield* Effect.acquireRelease(
        Effect.promise(() => new Promise<{
          readonly origin: string
          readonly server: Server
        }>((resolve, reject) => {
          const server = createServer((_request, response) => {
            writeJson(response, 200, JSON.stringify({
              kind: "canvas-change-page",
              schemaVersion: 3,
              canvasId: "canvas_protocol",
              after: null,
              changes: [],
              cursor: "cursor_a",
              hasMore: false
            }))
          })
          server.once("error", reject)
          server.listen(0, "127.0.0.1", () => {
            const address = Schema.decodeUnknownSync(TcpAddress)(server.address())
            resolve({
              origin: `http://127.0.0.1:${address.port}`,
              server
            })
          })
        })),
        ({ server }) => Effect.promise(() => new Promise<void>((finish) => {
          server.close(() => finish())
        }))
      )
      const remote = yield* remoteFrom(served.origin)
      const failure = yield* remote.changesAfter(AuthorityModel.changesAfter({
        canvasId: Id.canvas("canvas_protocol"),
        after: null,
        limit: AuthorityModel.pageLimit(10)
      })).pipe(Effect.flip)

      expect(failure).toEqual({
        _tag: "unsupportedVersion",
        location: "message",
        requestedVersion: 3,
        supportedVersion: 2,
        message: "Schema version 3 is unsupported. This installation speaks version 2. Upgrade Crit so the client and installation match."
      })
    })))
  )

  it("fails a protocol-failure upgrade response from submit", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const served = yield* Effect.acquireRelease(
        Effect.promise(() => new Promise<{
          readonly origin: string
          readonly server: Server
        }>((resolve, reject) => {
          const server = createServer((_request, response) => {
            writeJson(response, 426, JSON.stringify(ChangeProtocol.failure.encode({
              _tag: "unsupportedVersion",
              location: "message",
              requestedVersion: 2,
              supportedVersion: 1,
              message: "Schema version 2 is unsupported. This installation speaks version 1. Upgrade Crit so the client and installation match."
            })))
          })
          server.once("error", reject)
          server.listen(0, "127.0.0.1", () => {
            const address = Schema.decodeUnknownSync(TcpAddress)(server.address())
            resolve({
              origin: `http://127.0.0.1:${address.port}`,
              server
            })
          })
        })),
        ({ server }) => Effect.promise(() => new Promise<void>((finish) => {
          server.close(() => finish())
        }))
      )
      const remote = yield* remoteFrom(served.origin)
      const failure = yield* remote.submit({
        changeId: Id.change("change_protocol"),
        canvasId: Id.canvas("canvas_protocol"),
        observedCursor: null,
        commands: rename
      }, person).pipe(Effect.flip)

      expect(failure).toEqual({
        _tag: "unsupportedVersion",
        location: "message",
        requestedVersion: 2,
        supportedVersion: 1,
        message: "Schema version 2 is unsupported. This installation speaks version 1. Upgrade Crit so the client and installation match."
      })
    })))
  )
})
