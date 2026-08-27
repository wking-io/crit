import { mkdtempSync, rmSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { NodeServices } from "@effect/platform-node"
import {
  DeploymentChannel,
  DeploymentUrl,
  IsoTimestamp,
  SourceRevision
} from "@crit/domain"
import { Effect, Predicate, Redacted, Schema } from "effect"
import { describe, expect, it } from "vitest"

import {
  LocalProjectManifest,
  registerDeployment
} from "../src/index.js"

const TcpAddress = Schema.Struct({ port: Schema.Number })
const channel = Schema.decodeUnknownSync(DeploymentChannel)("review")
const url = Schema.decodeUnknownSync(DeploymentUrl)(
  "https://review.example.com/"
)
const sourceRevision = Schema.decodeUnknownSync(SourceRevision)("commit_abc123")
const expiresAt = Schema.decodeUnknownSync(IsoTimestamp)(
  "2026-08-27T12:00:00.000Z"
)

const temporaryRoot = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), "crit-register-deployment-"))),
  (directory) => Effect.sync(() =>
    rmSync(directory, { recursive: true, force: true })
  )
)

const initializeManifest = (root: string) => Effect.gen(function*() {
  const manifest = yield* LocalProjectManifest
  return yield* manifest.initialize
}).pipe(Effect.provide(LocalProjectManifest.layer({ root })))

interface MockResponseBody {
  readonly [key: string]: string | number
}

const mockInstallation = (
  status: number,
  responseBody: MockResponseBody
) => Effect.acquireRelease(
  Effect.promise(() => new Promise<{
    readonly origin: string
    readonly requests: Array<{
      readonly authorization: string | undefined
      readonly body: string
      readonly path: string | undefined
    }>
    readonly server: ReturnType<typeof createServer>
  }>((resolve, reject) => {
    const requests: Array<{
      readonly authorization: string | undefined
      readonly body: string
      readonly path: string | undefined
    }> = []
    const server = createServer((request, response) => {
      let body = ""
      request.on("data", (chunk: Uint8Array) => {
        body += Buffer.from(chunk).toString("utf8")
      })
      request.once("end", () => {
        requests.push({
          authorization: request.headers.authorization,
          body,
          path: request.url
        })
        response.writeHead(status, {
          "content-type": "application/json"
        }).end(JSON.stringify(responseBody))
      })
    })
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = Schema.decodeUnknownSync(TcpAddress)(server.address())
      resolve({
        origin: `http://127.0.0.1:${address.port}`,
        requests,
        server
      })
    })
  })),
  ({ server }) => Effect.promise(() => new Promise<void>((resolve) => {
    server.close(() => resolve())
  }))
)

describe("deployment registration client", () => {
  it("reads the project application and posts an authenticated registration", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const root = yield* temporaryRoot
      const initialized = yield* initializeManifest(root)
      const installation = yield* mockInstallation(200, {
        kind: "deployment-registered",
        schemaVersion: 1,
        deploymentId: "deployment_review",
        applicationId: initialized.manifest.applicationId,
        channel: "review",
        url: "https://review.example.com/",
        sourceRevision: "commit_abc123",
        expiresAt: "2026-08-27T12:00:00.000Z"
      })

      const receipt = yield* registerDeployment({
        root,
        installationUrl: `${installation.origin}/ignored?query=yes#fragment`,
        token: Redacted.make("test-deploy-token"),
        url,
        channel,
        sourceRevision,
        expiresAt
      })

      expect(receipt.deploymentId).toBe("deployment_review")
      expect(installation.requests).toHaveLength(1)
      expect(installation.requests[0]).toEqual({
        authorization: "Bearer test-deploy-token",
        path: "/deployments",
        body: JSON.stringify({
          kind: "register-deployment",
          schemaVersion: 1,
          applicationId: initialized.manifest.applicationId,
          channel: "review",
          url: "https://review.example.com/",
          sourceRevision: "commit_abc123",
          expiresAt: "2026-08-27T12:00:00.000Z"
        })
      })
    })).pipe(Effect.provide(NodeServices.layer))))

  it("classifies unauthenticated, rejected, and invalid responses", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const root = yield* temporaryRoot
      yield* initializeManifest(root)
      const unauthenticated = yield* mockInstallation(401, {})
      const rejected = yield* mockInstallation(503, {})
      const invalid = yield* mockInstallation(200, {})

      const failureFor = (installationUrl: string) => registerDeployment({
        root,
        installationUrl,
        token: "test-deploy-token",
        url,
        channel
      }).pipe(Effect.flip)

      expect(Predicate.isTagged(yield* failureFor(unauthenticated.origin), "DeploymentRegistrationUnauthenticated")).toBe(true)
      expect(yield* failureFor(rejected.origin)).toMatchObject({
        _tag: "DeploymentRegistrationResponseRejected",
        status: 503
      })
      expect(Predicate.isTagged(yield* failureFor(invalid.origin), "DeploymentRegistrationResponseInvalid")).toBe(true)
    })).pipe(Effect.provide(NodeServices.layer))))

  it("rejects an unsupported receipt schema version with an upgrade error", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const root = yield* temporaryRoot
      yield* initializeManifest(root)
      const installation = yield* mockInstallation(200, {
        kind: "deployment-registered",
        schemaVersion: 2
      })

      const failure = yield* registerDeployment({
        root,
        installationUrl: installation.origin,
        token: "test-deploy-token",
        url,
        channel
      }).pipe(Effect.flip)

      expect(failure).toMatchObject({
        _tag: "unsupportedVersion",
        requestedVersion: 2,
        supportedVersion: 1,
        message: expect.stringContaining("Upgrade Crit so the client and installation match.")
      })
    })).pipe(Effect.provide(NodeServices.layer))))

  it("classifies invalid installation URLs, request failures, and manifest failures", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const root = yield* temporaryRoot
      const missingManifest = yield* registerDeployment({
        root,
        installationUrl: "http://127.0.0.1:1",
        token: "test-deploy-token",
        url,
        channel
      }).pipe(Effect.flip)
      expect(Predicate.isTagged(missingManifest, "ProjectManifestIoFailure")).toBe(true)

      yield* initializeManifest(root)
      const invalidInstallation = yield* registerDeployment({
        root,
        installationUrl: "not-a-url",
        token: "test-deploy-token",
        url,
        channel
      }).pipe(Effect.flip)
      expect(Predicate.isTagged(invalidInstallation, "InstallationUrlInvalid")).toBe(true)

      const requestFailure = yield* registerDeployment({
        root,
        installationUrl: "http://127.0.0.1:1",
        token: "test-deploy-token",
        url,
        channel
      }).pipe(Effect.flip)
      expect(Predicate.isTagged(requestFailure, "DeploymentRegistrationRequestFailed")).toBe(true)
    })).pipe(Effect.provide(NodeServices.layer))))
})
