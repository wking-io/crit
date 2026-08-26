import { spawn, spawnSync } from "node:child_process"
import {
  mkdtempSync,
  readFileSync,
  rmSync
} from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Schema } from "effect"
import { afterEach, describe, expect, it } from "vitest"

const executable = join(import.meta.dirname, "..", "dist", "main.js")
const TcpAddress = Schema.Struct({ port: Schema.Number })
const StoredPerson = Schema.Struct({
  principal: Schema.Struct({
    person: Schema.Struct({
      personId: Schema.String,
      email: Schema.Union([
        Schema.TaggedStruct("unspecified", {}),
        Schema.TaggedStruct("access", { address: Schema.String })
      ])
    })
  })
})
const directories: Array<string> = []
const children: Array<ReturnType<typeof spawn>> = []
const servers: Array<ReturnType<typeof createServer>> = []

afterEach(async() => {
  for (const child of children.splice(0)) child.kill("SIGKILL")
  await Promise.all(servers.splice(0).map((server) =>
    new Promise<void>((resolve) => server.close(() => resolve()))
  ))
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

const makeDataRoot = () => {
  const directory = mkdtempSync(join(tmpdir(), "crit-cli-login-"))
  directories.push(directory)
  return join(directory, ".crit", "v1")
}

const installationPerson = (dataRoot: string) => Schema.decodeUnknownSync(
  StoredPerson
)(JSON.parse(readFileSync(join(dataRoot, "installation.json"), "utf8")))

const startDevelopment = (dataRoot: string) => new Promise<ReturnType<typeof spawn>>(
  (resolve, reject) => {
    const child = spawn(process.execPath, [
      executable,
      "dev",
      "--no-host",
      "--data-root",
      dataRoot
    ], { stdio: ["ignore", "pipe", "pipe"] })
    children.push(child)
    let output = ""
    const timeout = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error(`Timed out waiting for daemon readiness: ${output}`))
    }, 5_000)
    const read = (chunk: Uint8Array) => {
      output += Buffer.from(chunk).toString("utf8")
      if (!output.includes("Crit daemon listening at http://127.0.0.1:")) return
      clearTimeout(timeout)
      resolve(child)
    }
    child.stdout.on("data", read)
    child.stderr.on("data", read)
    child.once("error", (cause) => {
      clearTimeout(timeout)
      reject(cause)
    })
    child.once("exit", (code, signal) => {
      if (output.includes("Crit daemon listening at http://127.0.0.1:")) return
      clearTimeout(timeout)
      reject(new Error(
        `Daemon exited before readiness with code=${code} signal=${signal}: ${output}`
      ))
    })
  }
)

const stopDevelopment = (child: ReturnType<typeof spawn>) => new Promise<void>(
  (resolve, reject) => {
    child.once("error", reject)
    child.once("exit", (code, signal) => {
      const index = children.indexOf(child)
      if (index >= 0) children.splice(index, 1)
      if (signal === "SIGINT" || code === 130) {
        resolve()
        return
      }
      reject(new Error(`Expected SIGINT exit, received code=${code} signal=${signal}`))
    })
    child.kill("SIGINT")
  }
)

const mintInstallation = async(dataRoot: string) => {
  const child = await startDevelopment(dataRoot)
  await stopDevelopment(child)
}

interface MockInstallation {
  readonly origin: string
  readonly setAddress: (address: string) => void
  readonly setStatus: (status: number) => void
}

const startMockInstallation = () => new Promise<MockInstallation>((resolve, reject) => {
  let address = "ada@acme.com"
  let status = 200
  const server = createServer((request, response) => {
    expect(request.url).toBe("/identity")
    if (status !== 200) {
      response.writeHead(status).end()
      return
    }
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
      kind: "access-authenticated-person",
      schemaVersion: 1,
      address
    }))
  })
  servers.push(server)
  server.once("error", reject)
  server.listen(0, "127.0.0.1", () => {
    const tcp = Schema.decodeUnknownSync(TcpAddress)(server.address())
    resolve({
      origin: `http://127.0.0.1:${tcp.port}`,
      setAddress: (next) => {
        address = next
      },
      setStatus: (next) => {
        status = next
      }
    })
  })
})

const runLogin = (
  dataRoot: string,
  installationUrl: string,
  extraArguments: ReadonlyArray<string> = []
) => new Promise<{
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
}>((resolve, reject) => {
  const child = spawn(process.execPath, [
    executable,
    "login",
    installationUrl,
    "--data-root",
    dataRoot,
    ...extraArguments
  ], { stdio: ["ignore", "pipe", "pipe"] })
  let stdout = ""
  let stderr = ""
  child.stdout.on("data", (chunk: Uint8Array) => {
    stdout += Buffer.from(chunk).toString("utf8")
  })
  child.stderr.on("data", (chunk: Uint8Array) => {
    stderr += Buffer.from(chunk).toString("utf8")
  })
  child.once("error", reject)
  child.once("exit", (code) => resolve({ code, stdout, stderr }))
})

describe("built crit login", () => {
  it("binds once, accepts the same address, and rejects a different address", async() => {
    const dataRoot = makeDataRoot()
    await mintInstallation(dataRoot)
    const before = installationPerson(dataRoot)
    const installation = await startMockInstallation()

    const first = await runLogin(dataRoot, installation.origin)

    expect(first.code, first.stderr).toBe(0)
    expect(first.stdout).toContain(`Person  ${before.principal.person.personId}`)
    expect(first.stdout).toContain("Access  ada@acme.com")
    const bound = installationPerson(dataRoot)
    expect(bound.principal.person.personId).toBe(before.principal.person.personId)
    expect(bound.principal.person.email).toEqual({
      _tag: "access",
      address: "ada@acme.com"
    })

    const second = await runLogin(dataRoot, installation.origin, ["--json"])

    expect(second.code, second.stderr).toBe(0)
    expect(JSON.parse(second.stdout)).toEqual({
      _tag: "accessPersonBound",
      personId: before.principal.person.personId,
      email: { _tag: "access", address: "ada@acme.com" }
    })
    const installationPath = join(dataRoot, "installation.json")
    const identical = readFileSync(installationPath, "utf8")
    installation.setAddress("grace@acme.com")

    const different = await runLogin(dataRoot, installation.origin)

    expect(different.code).not.toBe(0)
    expect(different.stdout).toBe("")
    expect(different.stderr).toBe(
      "Crit Person is already bound to ada@acme.com\n"
    )
    expect(readFileSync(installationPath, "utf8")).toBe(identical)
  })

  it("fails when Crit is not initialized", async() => {
    const dataRoot = makeDataRoot()
    const installation = await startMockInstallation()

    const result = await runLogin(dataRoot, installation.origin)

    expect(result.code).not.toBe(0)
    expect(result.stdout).toBe("")
    expect(result.stderr).toBe("Crit is not initialized at this data root\n")
  })

  it("fails when Access rejects the request without changing the Person", async() => {
    const dataRoot = makeDataRoot()
    await mintInstallation(dataRoot)
    const installationPath = join(dataRoot, "installation.json")
    const first = readFileSync(installationPath, "utf8")
    const installation = await startMockInstallation()
    installation.setStatus(401)

    const result = await runLogin(dataRoot, installation.origin)

    expect(result.code).not.toBe(0)
    expect(result.stdout).toBe("")
    expect(result.stderr).toBe(
      "Installation did not return an Access-authenticated Person\n"
    )
    expect(readFileSync(installationPath, "utf8")).toBe(first)
    expect(installationPerson(dataRoot).principal.person.email).toEqual({
      _tag: "unspecified"
    })
  })

  it("reports an invalid installation URL", async() => {
    const result = await runLogin(makeDataRoot(), "not-a-url")

    expect(result.code).not.toBe(0)
    expect(result.stderr).toBe("Invalid installation URL: not-a-url\n")
  })

  it("lists login in help", () => {
    const result = spawnSync(process.execPath, [executable, "--help"], {
      encoding: "utf8"
    })

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain("login")
  })
})
