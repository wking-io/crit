import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { NodeServices } from "@effect/platform-node"
import { AccessPersonEmail, EmailAddress } from "@crit/domain"
import { Effect, Layer, Schema } from "effect"
import { describe, expect, it } from "vitest"

import {
  bindAccessPerson,
  LocalDevelopment,
  loginToInstallation
} from "../src/index.js"
import { LocalInstallation } from "../src/development.js"
import { decodeStored } from "../src/stored-json.js"

const TcpAddress = Schema.Struct({ port: Schema.Number })

const temporaryRoot = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), "crit-login-"))),
  (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true }))
)

const mintInstallation = (dataRoot: string) => Effect.scoped(Effect.gen(function*() {
  yield* Layer.buildWithScope(
    LocalDevelopment.layer({ dataRoot }).pipe(Layer.provide(NodeServices.layer)),
    yield* Effect.scope
  )
}))

const installationFrom = (dataRoot: string) => decodeStored(
  LocalInstallation,
  readFileSync(join(dataRoot, "installation.json"), "utf8")
)

const accessEmail = (address: string) => AccessPersonEmail.make({
  address: Schema.decodeUnknownSync(EmailAddress)(address)
})

const identityServer = (
  status: number,
  address: string = "ada@acme.com",
  schemaVersion = 1
) => Effect.acquireRelease(
  Effect.promise(() => new Promise<ReturnType<typeof createServer>>((resolve, reject) => {
    const server = createServer((request, response) => {
      expect(request.url).toBe("/identity")
      if (status !== 200) {
        response.writeHead(status).end()
        return
      }
      const body = JSON.stringify({
        kind: "access-authenticated-person",
        schemaVersion,
        address: Schema.decodeUnknownSync(EmailAddress)(address)
      })
      response.writeHead(200, { "content-type": "application/json" }).end(body)
    })
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => resolve(server))
  })),
  (server) => Effect.promise(() => new Promise<void>((resolve) => {
    server.close(() => resolve())
  }))
)

const serverOrigin = (server: ReturnType<typeof createServer>) => {
  const address = Schema.decodeUnknownSync(TcpAddress)(server.address())
  return `http://127.0.0.1:${address.port}`
}

describe("Access Person login", () => {
  it("binds an unspecified Person without replacing its identity", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const directory = yield* temporaryRoot
      const dataRoot = join(directory, ".crit", "v1")
      yield* mintInstallation(dataRoot)
      const before = installationFrom(dataRoot)

      const result = yield* bindAccessPerson({
        dataRoot,
        email: accessEmail("ada@acme.com")
      })
      const after = installationFrom(dataRoot)

      expect(result).toEqual({
        _tag: "accessPersonBound",
        personId: before.principal.person.personId,
        email: { _tag: "access", address: "ada@acme.com" }
      })
      expect(after.principal.person.personId).toBe(before.principal.person.personId)
      expect(after.principal.subject).toBe(before.principal.subject)
      expect(after.principal.person.email).toEqual({
        _tag: "access",
        address: "ada@acme.com"
      })
    })).pipe(Effect.provide(NodeServices.layer))))

  it("succeeds without rewriting an identical binding", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const directory = yield* temporaryRoot
      const dataRoot = join(directory, ".crit", "v1")
      yield* mintInstallation(dataRoot)
      const email = accessEmail("ada@acme.com")
      yield* bindAccessPerson({ dataRoot, email })
      const installationPath = join(dataRoot, "installation.json")
      const first = readFileSync(installationPath, "utf8")

      const result = yield* bindAccessPerson({ dataRoot, email })

      expect(result.email).toEqual(email)
      expect(readFileSync(installationPath, "utf8")).toBe(first)
    })).pipe(Effect.provide(NodeServices.layer))))

  it("rejects a different address without changing the installation", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const directory = yield* temporaryRoot
      const dataRoot = join(directory, ".crit", "v1")
      yield* mintInstallation(dataRoot)
      yield* bindAccessPerson({
        dataRoot,
        email: accessEmail("ada@acme.com")
      })
      const installationPath = join(dataRoot, "installation.json")
      const first = readFileSync(installationPath, "utf8")

      const failure = yield* bindAccessPerson({
        dataRoot,
        email: accessEmail("grace@acme.com")
      }).pipe(Effect.flip)

      expect(failure).toMatchObject({
        _tag: "AccessPersonAlreadyBound",
        existingAddress: "ada@acme.com",
        requestedAddress: "grace@acme.com"
      })
      expect(readFileSync(installationPath, "utf8")).toBe(first)
    })).pipe(Effect.provide(NodeServices.layer))))

  it("reports a missing installation", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const directory = yield* temporaryRoot
      const failure = yield* bindAccessPerson({
        dataRoot: join(directory, ".crit", "v1"),
        email: accessEmail("ada@acme.com")
      }).pipe(Effect.flip)

      expect(failure._tag).toBe("LocalDaemonStateMissing")
    })).pipe(Effect.provide(NodeServices.layer))))

  it("rejects malformed installation state without exposing its contents", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const directory = yield* temporaryRoot
      const dataRoot = join(directory, ".crit", "v1")
      mkdirSync(dataRoot, { recursive: true })
      writeFileSync(
        join(dataRoot, "installation.json"),
        '{"bearerSecret":"do-not-report"}'
      )

      const failure = yield* bindAccessPerson({
        dataRoot,
        email: accessEmail("ada@acme.com")
      }).pipe(Effect.flip)

      expect(failure._tag).toBe("LocalDaemonStateMalformed")
      expect(String(failure)).not.toContain("do-not-report")
    })).pipe(Effect.provide(NodeServices.layer))))

  it("fetches the Access Person and binds the local Person", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const directory = yield* temporaryRoot
      const dataRoot = join(directory, ".crit", "v1")
      yield* mintInstallation(dataRoot)
      const personId = installationFrom(dataRoot).principal.person.personId
      const server = yield* identityServer(200)

      const result = yield* loginToInstallation({
        dataRoot,
        installationUrl: `${serverOrigin(server)}/ignored?query=yes#fragment`
      })

      expect(result.personId).toBe(personId)
      expect(installationFrom(dataRoot).principal.person.email).toEqual({
        _tag: "access",
        address: "ada@acme.com"
      })
      expect(installationFrom(dataRoot).installationOrigin).toBe(serverOrigin(server))
    })).pipe(Effect.provide(NodeServices.layer))))

  it("keeps the Person unchanged when logging in to the same origin again", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const directory = yield* temporaryRoot
      const dataRoot = join(directory, ".crit", "v1")
      yield* mintInstallation(dataRoot)
      const server = yield* identityServer(200)
      const origin = serverOrigin(server)
      yield* loginToInstallation({ dataRoot, installationUrl: origin })
      const first = installationFrom(dataRoot)
      const firstContents = readFileSync(join(dataRoot, "installation.json"), "utf8")

      yield* loginToInstallation({ dataRoot, installationUrl: origin })

      const second = installationFrom(dataRoot)
      expect(second.principal.person.personId).toBe(first.principal.person.personId)
      expect(second.principal.person.email).toEqual(first.principal.person.email)
      expect(readFileSync(join(dataRoot, "installation.json"), "utf8")).toBe(firstContents)
    })).pipe(Effect.provide(NodeServices.layer))))

  it("updates the origin after logging in through another installation URL", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const directory = yield* temporaryRoot
      const dataRoot = join(directory, ".crit", "v1")
      yield* mintInstallation(dataRoot)
      const firstServer = yield* identityServer(200)
      yield* loginToInstallation({
        dataRoot,
        installationUrl: serverOrigin(firstServer)
      })
      const first = installationFrom(dataRoot)
      const secondServer = yield* identityServer(200)
      const secondOrigin = serverOrigin(secondServer)

      yield* loginToInstallation({
        dataRoot,
        installationUrl: `${secondOrigin}/path?query=yes`
      })

      const second = installationFrom(dataRoot)
      expect(second.principal.person.personId).toBe(first.principal.person.personId)
      expect(second.principal.person.email).toEqual(first.principal.person.email)
      expect(second.installationOrigin).toBe(secondOrigin)
    })).pipe(Effect.provide(NodeServices.layer))))

  it("leaves the Person unspecified when Access rejects the request", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const directory = yield* temporaryRoot
      const dataRoot = join(directory, ".crit", "v1")
      yield* mintInstallation(dataRoot)
      const installationPath = join(dataRoot, "installation.json")
      const first = readFileSync(installationPath, "utf8")
      const server = yield* identityServer(401)

      const failure = yield* loginToInstallation({
        dataRoot,
        installationUrl: serverOrigin(server)
      }).pipe(Effect.flip)

      expect(failure._tag).toBe("AccessPersonUnauthenticated")
      expect(installationFrom(dataRoot).principal.person.email).toEqual({
        _tag: "unspecified"
      })
      expect(readFileSync(installationPath, "utf8")).toBe(first)
    })).pipe(Effect.provide(NodeServices.layer))))

  it("rejects an unsupported identity schema version with an upgrade error", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const directory = yield* temporaryRoot
      const dataRoot = join(directory, ".crit", "v1")
      yield* mintInstallation(dataRoot)
      const installationPath = join(dataRoot, "installation.json")
      const first = readFileSync(installationPath, "utf8")
      const server = yield* identityServer(200, "ada@acme.com", 2)

      const failure = yield* loginToInstallation({
        dataRoot,
        installationUrl: serverOrigin(server)
      }).pipe(Effect.flip)

      expect(failure).toMatchObject({
        _tag: "unsupportedVersion",
        requestedVersion: 2,
        supportedVersion: 1
      })
      expect(failure._tag === "unsupportedVersion" && failure.message).toContain(
        "Upgrade Crit so the client and installation match."
      )
      expect(readFileSync(installationPath, "utf8")).toBe(first)
    })).pipe(Effect.provide(NodeServices.layer))))
})
