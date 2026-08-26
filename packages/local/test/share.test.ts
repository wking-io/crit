import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync
} from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { NodeServices } from "@effect/platform-node"
import {
  AccessPersonEmail,
  CanvasTitle,
  EmailAddress,
  Id
} from "@crit/domain"
import {
  decodeShareCanvasWire,
  encodeAccessAuthenticatedPersonWire,
  encodeCanvasSharedWire
} from "@crit/protocol"
import { Effect, Layer, Schema } from "effect"
import { describe, expect, it } from "vitest"

import {
  bindAccessPerson,
  LocalDevelopment,
  LocalShares,
  loginToInstallation,
  shareCanvas
} from "../src/index.js"
import { decodeStored } from "../src/stored-json.js"

const TcpAddress = Schema.Struct({ port: Schema.Number })
const canvasId = Id.canvas("canvas_checkout")
const title = Schema.decodeUnknownSync(CanvasTitle)("Checkout")

const temporaryRoot = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), "crit-share-"))),
  (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true }))
)

const mintInstallation = (dataRoot: string) => Effect.scoped(Effect.gen(function*() {
  yield* Layer.buildWithScope(
    LocalDevelopment.layer({ dataRoot }).pipe(Layer.provide(NodeServices.layer)),
    yield* Effect.scope
  )
}))

const accessEmail = (address: string) => AccessPersonEmail.make({
  address: Schema.decodeUnknownSync(EmailAddress)(address)
})

const sharesFrom = (dataRoot: string) => decodeStored(
  LocalShares,
  readFileSync(join(dataRoot, "shares.json"), "utf8")
)

interface MockInstallation {
  readonly origin: string
  readonly requests: Array<ReturnType<typeof decodeShareCanvasWire>>
}

const installationServer = (
  shareStatus = 200
) => Effect.acquireRelease(
  Effect.promise(() => new Promise<{
    readonly server: ReturnType<typeof createServer>
    readonly requests: Array<ReturnType<typeof decodeShareCanvasWire>>
  }>((resolve, reject) => {
    const requests: Array<ReturnType<typeof decodeShareCanvasWire>> = []
    const server = createServer((request, response) => {
      if (request.method === "GET" && request.url === "/identity") {
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(
          encodeAccessAuthenticatedPersonWire({
            kind: "access-authenticated-person",
            schemaVersion: 1,
            address: Schema.decodeUnknownSync(EmailAddress)("ada@acme.com")
          })
        ))
        return
      }
      if (request.method !== "POST" || request.url !== "/canvases") {
        response.writeHead(404).end()
        return
      }
      if (shareStatus !== 200) {
        response.writeHead(shareStatus).end()
        return
      }
      let contents = ""
      request.setEncoding("utf8")
      request.on("data", (chunk: string) => {
        contents += chunk
      })
      request.on("end", () => {
        const share = decodeShareCanvasWire(JSON.parse(contents))
        requests.push(share)
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(
          encodeCanvasSharedWire({
            kind: "canvas-shared",
            schemaVersion: 1,
            canvasId: share.canvasId,
            title: share.title
          })
        ))
      })
    })
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => resolve({ server, requests }))
  })),
  ({ server }) => Effect.promise(() => new Promise<void>((resolve) => {
    server.close(() => resolve())
  }))
).pipe(Effect.map(({ requests, server }): MockInstallation => {
  const address = Schema.decodeUnknownSync(TcpAddress)(server.address())
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests
  }
}))

describe("shareCanvas", () => {
  it("requires login when the Person email is unspecified", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const directory = yield* temporaryRoot
      const dataRoot = join(directory, ".crit", "v1")
      yield* mintInstallation(dataRoot)

      const failure = yield* shareCanvas({ dataRoot, canvasId, title }).pipe(Effect.flip)

      expect(failure._tag).toBe("ShareRequiresLogin")
      expect(existsSync(join(dataRoot, "shares.json"))).toBe(false)
    })).pipe(Effect.provide(NodeServices.layer))))

  it("requires login when an Access Person has no installation origin", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const directory = yield* temporaryRoot
      const dataRoot = join(directory, ".crit", "v1")
      yield* mintInstallation(dataRoot)
      yield* bindAccessPerson({
        dataRoot,
        email: accessEmail("ada@acme.com")
      })

      const failure = yield* shareCanvas({ dataRoot, canvasId, title }).pipe(Effect.flip)

      expect(failure._tag).toBe("ShareRequiresLogin")
      expect(existsSync(join(dataRoot, "shares.json"))).toBe(false)
    })).pipe(Effect.provide(NodeServices.layer))))

  it("posts the stored Access Person and records the shared Canvas", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const directory = yield* temporaryRoot
      const dataRoot = join(directory, ".crit", "v1")
      yield* mintInstallation(dataRoot)
      const installation = yield* installationServer()
      const binding = yield* loginToInstallation({
        dataRoot,
        installationUrl: installation.origin
      })

      const result = yield* shareCanvas({ dataRoot, canvasId, title })

      expect(result).toEqual({
        _tag: "canvas-shared",
        canvasId,
        title,
        installationOrigin: installation.origin,
        personId: binding.personId
      })
      expect(installation.requests).toHaveLength(1)
      expect(installation.requests[0]?.person).toMatchObject({
        personId: binding.personId,
        email: { _tag: "access", address: "ada@acme.com" }
      })
      expect(sharesFrom(dataRoot)).toEqual({
        version: 1,
        canvases: [{
          _tag: "shared-canvas",
          canvasId,
          installationOrigin: installation.origin,
          personId: binding.personId
        }]
      })
    })).pipe(Effect.provide(NodeServices.layer))))

  it("keeps one local row when the same Canvas is shared twice", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const directory = yield* temporaryRoot
      const dataRoot = join(directory, ".crit", "v1")
      yield* mintInstallation(dataRoot)
      const installation = yield* installationServer()
      yield* loginToInstallation({
        dataRoot,
        installationUrl: installation.origin
      })

      yield* shareCanvas({ dataRoot, canvasId, title })
      yield* shareCanvas({ dataRoot, canvasId, title })

      expect(installation.requests).toHaveLength(2)
      expect(sharesFrom(dataRoot).canvases).toHaveLength(1)
    })).pipe(Effect.provide(NodeServices.layer))))

  it("does not write local state when Access rejects the share", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const directory = yield* temporaryRoot
      const dataRoot = join(directory, ".crit", "v1")
      yield* mintInstallation(dataRoot)
      const installation = yield* installationServer(401)
      yield* loginToInstallation({
        dataRoot,
        installationUrl: installation.origin
      })

      const failure = yield* shareCanvas({ dataRoot, canvasId, title }).pipe(Effect.flip)

      expect(failure._tag).toBe("AccessPersonUnauthenticated")
      expect(existsSync(join(dataRoot, "shares.json"))).toBe(false)
    })).pipe(Effect.provide(NodeServices.layer))))
})
