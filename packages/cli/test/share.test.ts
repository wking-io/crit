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
const ShareRequest = Schema.Struct({
  canvasId: Schema.String,
  title: Schema.String
})
const StoredShares = Schema.Struct({
  version: Schema.Literal(1),
  canvases: Schema.Array(Schema.TaggedStruct("sharedCanvas", {
    canvasId: Schema.String,
    installationOrigin: Schema.String,
    personId: Schema.String
  }))
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
  const directory = mkdtempSync(join(tmpdir(), "crit-cli-share-"))
  directories.push(directory)
  return join(directory, ".crit", "v1")
}

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

interface CommandResult {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
}

const runCrit = (
  dataRoot: string,
  arguments_: ReadonlyArray<string>
) => new Promise<CommandResult>((resolve, reject) => {
  const child = spawn(process.execPath, [
    executable,
    ...arguments_,
    "--data-root",
    dataRoot
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

interface MockInstallation {
  readonly origin: string
  readonly shares: Array<typeof ShareRequest.Type>
}

const startMockInstallation = () => new Promise<MockInstallation>((resolve, reject) => {
  const shares: Array<typeof ShareRequest.Type> = []
  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/identity") {
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
        kind: "access-authenticated-person",
        schemaVersion: 1,
        address: "ada@acme.com"
      }))
      return
    }
    if (request.method !== "POST" || request.url !== "/canvas") {
      response.writeHead(404).end()
      return
    }
    let contents = ""
    request.setEncoding("utf8")
    request.on("data", (chunk: string) => {
      contents += chunk
    })
    request.on("end", () => {
      const share = Schema.decodeUnknownSync(ShareRequest)(
        JSON.parse(contents)
      )
      shares.push(share)
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
        kind: "canvas-shared",
        schemaVersion: 1,
        canvasId: share.canvasId,
        title: share.title
      }))
    })
  })
  servers.push(server)
  server.once("error", reject)
  server.listen(0, "127.0.0.1", () => {
    const tcp = Schema.decodeUnknownSync(TcpAddress)(server.address())
    resolve({
      origin: `http://127.0.0.1:${tcp.port}`,
      shares
    })
  })
})

const prepareSharedCanvas = async() => {
  const dataRoot = makeDataRoot()
  await startDevelopment(dataRoot)
  const installation = await startMockInstallation()
  const login = await runCrit(dataRoot, ["login", installation.origin])
  expect(login.code, login.stderr).toBe(0)
  const created = await runCrit(dataRoot, [
    "create",
    "canvas_share_cli",
    "--title",
    "Shared"
  ])
  expect(created.code, created.stderr).toBe(0)
  return { dataRoot, installation }
}

describe("built crit share", () => {
  it("shares a local Canvas and writes shares.json", async() => {
    const { dataRoot, installation } = await prepareSharedCanvas()

    const result = await runCrit(dataRoot, ["share", "canvas_share_cli"])

    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain("Canvas  canvas_share_cli")
    expect(result.stdout).toContain(`Installation  ${installation.origin}`)
    expect(installation.shares).toEqual([{
      canvasId: "canvas_share_cli",
      title: "Shared"
    }])
    const stored = Schema.decodeUnknownSync(StoredShares)(
      JSON.parse(readFileSync(join(dataRoot, "shares.json"), "utf8"))
    )
    expect(stored.canvases).toHaveLength(1)
    expect(stored.canvases[0]).toMatchObject({
      canvasId: "canvas_share_cli",
      installationOrigin: installation.origin
    })
  })

  it("succeeds when the same Canvas is shared again", async() => {
    const { dataRoot, installation } = await prepareSharedCanvas()
    const first = await runCrit(dataRoot, ["share", "canvas_share_cli"])

    const second = await runCrit(dataRoot, [
      "share",
      "canvas_share_cli",
      "--json"
    ])

    expect(first.code, first.stderr).toBe(0)
    expect(second.code, second.stderr).toBe(0)
    expect(JSON.parse(second.stdout)).toMatchObject({
      _tag: "canvasShared",
      canvasId: "canvas_share_cli",
      title: "Shared",
      installationOrigin: installation.origin
    })
    expect(installation.shares).toHaveLength(2)
    const stored = Schema.decodeUnknownSync(StoredShares)(
      JSON.parse(readFileSync(join(dataRoot, "shares.json"), "utf8"))
    )
    expect(stored.canvases).toHaveLength(1)
  })

  it("requires login after development initializes the installation", async() => {
    const dataRoot = makeDataRoot()
    await startDevelopment(dataRoot)
    const created = await runCrit(dataRoot, [
      "create",
      "canvas_share_cli",
      "--title",
      "Shared"
    ])
    expect(created.code, created.stderr).toBe(0)

    const result = await runCrit(dataRoot, ["share", "canvas_share_cli"])

    expect(result.code).not.toBe(0)
    expect(result.stdout).toBe("")
    expect(result.stderr).toBe("Run crit login\n")
  })

  it("requires login when the installation is missing", async() => {
    const result = await runCrit(
      makeDataRoot(),
      ["share", "canvas_share_cli"]
    )

    expect(result.code).not.toBe(0)
    expect(result.stdout).toBe("")
    expect(result.stderr).toBe("Run crit login\n")
  })

  it("lists share in help", () => {
    const result = spawnSync(process.execPath, [executable, "--help"], {
      encoding: "utf8"
    })

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain("share")
  })
})
