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
  emptyCanvasProjection,
  Id,
  Sha256Digest
} from "@crit/domain"
import {
  decodeShareCanvasWire,
  encodeAccessAuthenticatedPersonWire,
  encodeCanvasSharedWire,
  ShareDigestMismatch as ShareDigestMismatchWire
} from "@crit/protocol"
import { Effect, Layer, Schema } from "effect"
import { describe, expect, it } from "vitest"

import {
  bindAccessPerson,
  importIdForCanvas,
  LocalDevelopment,
  LocalShares,
  loginToInstallation,
  projectionDigest,
  shareCanvas,
  shareIdForCanvas
} from "../src/index.js"
import { decodeStored } from "../src/stored-json.js"

const TcpAddress = Schema.Struct({ port: Schema.Number })
const canvasId = Id.canvas("canvas_checkout")
const title = Schema.decodeUnknownSync(CanvasTitle)("Checkout")
const projection = emptyCanvasProjection(canvasId, title)
const digest = projectionDigest(projection)
const shareId = shareIdForCanvas(canvasId)
const importId = importIdForCanvas(canvasId)

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
  shareStatus = 200,
  shareBody?: Schema.Json
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
      if (request.method !== "POST" || request.url !== "/canvas") {
        response.writeHead(404).end()
        return
      }
      if (shareStatus === 409) {
        response.writeHead(409, { "content-type": "application/json" }).end(JSON.stringify(
          Schema.encodeSync(ShareDigestMismatchWire)(ShareDigestMismatchWire.make({
            shareId,
            expectedDigest: digest,
            receivedDigest: Schema.decodeUnknownSync(Sha256Digest)(
              `sha256:${"b".repeat(64)}`
            )
          }))
        ))
        return
      }
      if (shareStatus !== 200) {
        if (shareBody === undefined) {
          response.writeHead(shareStatus).end()
          return
        }
        response.writeHead(shareStatus, { "content-type": "application/json" })
          .end(JSON.stringify(shareBody))
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
          shareBody ?? encodeCanvasSharedWire({
            kind: "canvas-shared",
            schemaVersion: 2,
            canvasId: share.canvasId,
            title: share.title,
            shareId: share.shareId,
            importId: share.importId,
            projectionDigest: share.projectionDigest,
            workspaceId: Id.workspace("workspace_default"),
            personId: share.person.personId
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

      const failure = yield* shareCanvas({ dataRoot, projection }).pipe(Effect.flip)

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

      const failure = yield* shareCanvas({ dataRoot, projection }).pipe(Effect.flip)

      expect(failure._tag).toBe("ShareRequiresLogin")
      expect(existsSync(join(dataRoot, "shares.json"))).toBe(false)
    })).pipe(Effect.provide(NodeServices.layer))))

  it("posts share IDs and the projection digest, then records the receipt", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const directory = yield* temporaryRoot
      const dataRoot = join(directory, ".crit", "v1")
      yield* mintInstallation(dataRoot)
      const installation = yield* installationServer()
      const binding = yield* loginToInstallation({
        dataRoot,
        installationUrl: installation.origin
      })

      const result = yield* shareCanvas({ dataRoot, projection })

      expect(result).toEqual({
        _tag: "canvasShared",
        canvasId,
        title,
        installationOrigin: installation.origin,
        personId: binding.personId,
        shareId,
        importId,
        projectionDigest: digest,
        workspaceId: "workspace_default"
      })
      expect(installation.requests).toHaveLength(1)
      expect(installation.requests[0]).toMatchObject({
        schemaVersion: 2,
        shareId,
        importId,
        projectionDigest: digest,
        person: {
          personId: binding.personId,
          email: { _tag: "access", address: "ada@acme.com" }
        }
      })
      expect(sharesFrom(dataRoot)).toEqual({
        version: 1,
        canvases: [{
          _tag: "sharedCanvas",
          canvasId,
          installationOrigin: installation.origin,
          personId: binding.personId,
          shareId,
          importId,
          projectionDigest: digest,
          workspaceId: "workspace_default"
        }]
      })
    })).pipe(Effect.provide(NodeServices.layer))))

  it("keeps one local row and resends the same IDs when the Canvas is shared twice", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const directory = yield* temporaryRoot
      const dataRoot = join(directory, ".crit", "v1")
      yield* mintInstallation(dataRoot)
      const installation = yield* installationServer()
      yield* loginToInstallation({
        dataRoot,
        installationUrl: installation.origin
      })

      yield* shareCanvas({ dataRoot, projection })
      yield* shareCanvas({ dataRoot, projection })

      expect(installation.requests).toHaveLength(2)
      expect(installation.requests[0]?.shareId).toBe(shareId)
      expect(installation.requests[1]?.shareId).toBe(shareId)
      expect(installation.requests[0]?.importId).toBe(importId)
      expect(installation.requests[1]?.importId).toBe(importId)
      expect(installation.requests[0]?.projectionDigest).toBe(digest)
      expect(installation.requests[1]?.projectionDigest).toBe(digest)
      expect(sharesFrom(dataRoot).canvases).toHaveLength(1)
    })).pipe(Effect.provide(NodeServices.layer))))

  it("surfaces a digest mismatch without writing local state", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const directory = yield* temporaryRoot
      const dataRoot = join(directory, ".crit", "v1")
      yield* mintInstallation(dataRoot)
      const installation = yield* installationServer(409)
      yield* loginToInstallation({
        dataRoot,
        installationUrl: installation.origin
      })

      const failure = yield* shareCanvas({ dataRoot, projection }).pipe(Effect.flip)

      expect(failure._tag).toBe("ShareDigestMismatch")
      expect(failure).toMatchObject({
        shareId,
        expectedDigest: digest
      })
      expect(existsSync(join(dataRoot, "shares.json"))).toBe(false)
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

      const failure = yield* shareCanvas({ dataRoot, projection }).pipe(Effect.flip)

      expect(failure._tag).toBe("AccessPersonUnauthenticated")
      expect(existsSync(join(dataRoot, "shares.json"))).toBe(false)
    })).pipe(Effect.provide(NodeServices.layer))))

  it("rejects an unsupported share receipt version with an upgrade error", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const directory = yield* temporaryRoot
      const dataRoot = join(directory, ".crit", "v1")
      yield* mintInstallation(dataRoot)
      const installation = yield* installationServer(200, {
        kind: "canvas-shared",
        schemaVersion: 3,
        shareId
      })
      yield* loginToInstallation({
        dataRoot,
        installationUrl: installation.origin
      })

      const failure = yield* shareCanvas({ dataRoot, projection }).pipe(Effect.flip)

      expect(failure).toMatchObject({
        _tag: "unsupportedVersion",
        requestedVersion: 3,
        supportedVersion: 2
      })
      expect(failure._tag === "unsupportedVersion" && failure.message).toContain(
        "Upgrade Crit so the client and installation match."
      )
      expect(existsSync(join(dataRoot, "shares.json"))).toBe(false)
    })).pipe(Effect.provide(NodeServices.layer))))

  it("rejects a protocol-failure upgrade response without writing local state", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const directory = yield* temporaryRoot
      const dataRoot = join(directory, ".crit", "v1")
      yield* mintInstallation(dataRoot)
      const installation = yield* installationServer(426, {
        kind: "protocol-failure",
        schemaVersion: 1,
        failure: {
          _tag: "unsupportedVersion",
          location: "message",
          requestedVersion: 3,
          supportedVersion: 2,
          message:
            "Schema version 3 is unsupported. This installation speaks version 2. Upgrade Crit so the client and installation match."
        }
      })
      yield* loginToInstallation({
        dataRoot,
        installationUrl: installation.origin
      })

      const failure = yield* shareCanvas({ dataRoot, projection }).pipe(Effect.flip)

      expect(failure).toMatchObject({
        _tag: "unsupportedVersion",
        requestedVersion: 3,
        supportedVersion: 2
      })
      expect(existsSync(join(dataRoot, "shares.json"))).toBe(false)
    })).pipe(Effect.provide(NodeServices.layer))))
})
