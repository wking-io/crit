import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

const directories: Array<string> = []
const children: Array<ReturnType<typeof spawn>> = []

afterEach(() => {
  for (const child of children.splice(0)) child.kill("SIGKILL")
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

const start = (dataRoot: string) => new Promise<{
  readonly child: ReturnType<typeof spawn>
  readonly baseUrl: string
  readonly browserBootstrapUrl: string
}>((resolve, reject) => {
  const child = spawn(process.execPath, [
    join(import.meta.dirname, "..", "dist", "main.js"),
    "dev",
    "--data-root",
    dataRoot,
    "--browser-origin",
    "http://127.0.0.1:5173"
  ], { stdio: ["ignore", "pipe", "pipe"] })
  children.push(child)
  let output = ""
  const timeout = setTimeout(() => {
    child.kill("SIGKILL")
    reject(new Error(`Timed out waiting for daemon readiness: ${output}`))
  }, 5_000)
  child.stdout.on("data", (chunk: Uint8Array) => {
    output += Buffer.from(chunk).toString("utf8")
    const daemonMatch = /Crit daemon listening at (http:\/\/127\.0\.0\.1:\d+)/.exec(output)
    const browserMatch = /Open Crit in your browser: (http:\/\/127\.0\.0\.1:\d+\/browser\/[0-9a-f]{32}\/#[-_A-Za-z0-9]+)/.exec(output)
    if (daemonMatch?.[1] === undefined || browserMatch?.[1] === undefined) return
    clearTimeout(timeout)
    resolve({ child, baseUrl: daemonMatch[1], browserBootstrapUrl: browserMatch[1] })
  })
  child.stderr.on("data", (chunk: Uint8Array) => {
    output += Buffer.from(chunk).toString("utf8")
  })
  child.once("error", (cause) => {
    clearTimeout(timeout)
    reject(cause)
  })
  child.once("exit", (code, signal) => {
    if (matchReady(output)) return
    clearTimeout(timeout)
    reject(new Error(`Daemon exited before readiness with code=${code} signal=${signal}: ${output}`))
  })
})

const matchReady = (output: string) => output.includes("Crit daemon listening at http://127.0.0.1:")

const startWithoutBrowser = (dataRoot: string) => new Promise<{
  readonly child: ReturnType<typeof spawn>
  readonly output: string
}>((resolve, reject) => {
  const child = spawn(process.execPath, [
    join(import.meta.dirname, "..", "dist", "main.js"),
    "dev",
    "--data-root",
    dataRoot
  ], { stdio: ["ignore", "pipe", "pipe"] })
  children.push(child)
  let output = ""
  const timeout = setTimeout(() => reject(new Error(`Timed out waiting for daemon: ${output}`)), 5_000)
  child.stdout.on("data", (chunk: Uint8Array) => {
    output += Buffer.from(chunk).toString("utf8")
    if (!matchReady(output)) return
    clearTimeout(timeout)
    setImmediate(() => resolve({ child, output }))
  })
  child.stderr.on("data", (chunk: Uint8Array) => {
    output += Buffer.from(chunk).toString("utf8")
  })
  child.once("error", (cause) => {
    clearTimeout(timeout)
    reject(cause)
  })
})

const stop = (child: ReturnType<typeof spawn>) => new Promise<void>((resolve, reject) => {
  child.once("error", reject)
  child.once("exit", (code, signal) => {
    const index = children.indexOf(child)
    if (index >= 0) children.splice(index, 1)
    return signal === "SIGINT" || code === 130
      ? resolve()
      : reject(new Error(`Expected SIGINT exit, received code=${code} signal=${signal}`))
  })
  child.kill("SIGINT")
})

const run = (dataRoot: string, args: ReadonlyArray<string>) => spawnSync(process.execPath, [
  join(import.meta.dirname, "..", "dist", "main.js"),
  ...args,
  "--data-root",
  dataRoot
], { encoding: "utf8" })

describe("built crit-target dev", () => {
  it("does not mint or print browser bootstrap access without configuration", async () => {
    const directory = mkdtempSync(join(tmpdir(), "crit-cli-dev-no-browser-"))
    directories.push(directory)
    const started = await startWithoutBrowser(join(directory, ".crit", "v1"))
    expect(started.output).not.toContain("Open Crit in your browser")
    await stop(started.child)
  })

  it("releases its stable port and descriptor on interrupt", async () => {
    const directory = mkdtempSync(join(tmpdir(), "crit-cli-dev-"))
    directories.push(directory)
    const dataRoot = join(directory, ".crit", "v1")
    const first = await start(dataRoot)
    const descriptorPath = join(dataRoot, "daemon.json")
    expect(existsSync(descriptorPath)).toBe(true)
    const firstDescriptor = readFileSync(descriptorPath, "utf8")
    expect(readFileSync(descriptorPath, "utf8")).not.toContain("bearerSecret")
    expect(readFileSync(descriptorPath, "utf8")).not.toContain(
      new URL(first.browserBootstrapUrl).hash.slice(1)
    )
    const status = run(dataRoot, ["status", "--json"])
    expect(status.status).toBe(0)
    expect(JSON.parse(status.stdout)).toMatchObject({ kind: "Running" })
    const created = run(dataRoot, ["create", "canvas_cli_flow", "--title", "CLI Flow", "--json"])
    expect(created.status, created.stderr).toBe(0)
    expect(JSON.parse(created.stdout).projection.title).toBe("CLI Flow")
    const duplicate = run(dataRoot, ["create", "canvas_cli_flow", "--title", "Duplicate"])
    expect(duplicate.status).not.toBe(0)
    expect(duplicate.stderr).toBe("Canvas already exists: canvas_cli_flow\n")
    const missing = run(dataRoot, ["open", "canvas_cli_missing"])
    expect(missing.status).not.toBe(0)
    expect(missing.stderr).toBe("Canvas not found: canvas_cli_missing\n")
    const opened = run(dataRoot, ["open", "canvas_cli_flow", "--json"])
    expect(opened.status, opened.stderr).toBe(0)
    expect(JSON.parse(opened.stdout).projection.canvasId).toBe("canvas_cli_flow")
    await stop(first.child)
    expect(existsSync(descriptorPath)).toBe(false)
    const stopped = run(dataRoot, ["status"])
    expect(stopped.status).not.toBe(0)
    expect(stopped.stdout).toBe("")
    expect(stopped.stderr).toBe("Crit daemon is stopped\n")

    writeFileSync(descriptorPath, firstDescriptor)
    const stale = run(dataRoot, ["status"])
    expect(stale.status).not.toBe(0)
    expect(stale.stdout).toBe("")
    expect(stale.stderr).toBe("Crit daemon is unavailable (connection-failed)\n")
    expect(readFileSync(descriptorPath, "utf8")).toBe(firstDescriptor)

    const restarted = await start(dataRoot)
    expect(restarted.baseUrl).toBe(first.baseUrl)
    expect(restarted.browserBootstrapUrl).not.toBe(first.browserBootstrapUrl)
    const reopened = run(dataRoot, ["open", "canvas_cli_flow", "--json"])
    expect(reopened.status, reopened.stderr).toBe(0)
    expect(JSON.parse(reopened.stdout).projection.title).toBe("CLI Flow")
    await stop(restarted.child)
    expect(existsSync(descriptorPath)).toBe(false)
  })

  it("reports malformed discovery state once without exposing stored secrets", () => {
    const directory = mkdtempSync(join(tmpdir(), "crit-cli-malformed-"))
    directories.push(directory)
    const dataRoot = join(directory, ".crit", "v1")
    mkdirSync(dataRoot, { recursive: true })
    writeFileSync(join(dataRoot, "installation.json"), '{"bearerSecret":"do-not-report"}')
    const status = run(dataRoot, ["status"])
    expect(status.status).not.toBe(0)
    expect(status.stdout).toBe("")
    expect(status.stderr).toBe("Crit daemon state is malformed\n")
    expect(status.stderr).not.toContain("do-not-report")
  })
})
