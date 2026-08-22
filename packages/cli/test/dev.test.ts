import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
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
}>((resolve, reject) => {
  const child = spawn(process.execPath, [
    join(import.meta.dirname, "..", "dist", "main.js"),
    "dev",
    "--data-root",
    dataRoot
  ], { stdio: ["ignore", "pipe", "pipe"] })
  children.push(child)
  let output = ""
  const timeout = setTimeout(() => {
    child.kill("SIGKILL")
    reject(new Error(`Timed out waiting for daemon readiness: ${output}`))
  }, 5_000)
  child.stdout.on("data", (chunk: Uint8Array) => {
    output += Buffer.from(chunk).toString("utf8")
    const match = /Crit daemon listening at (http:\/\/127\.0\.0\.1:\d+)/.exec(output)
    if (match?.[1] === undefined) return
    clearTimeout(timeout)
    resolve({ child, baseUrl: match[1] })
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

describe("built crit-target dev", () => {
  it("releases its stable port and descriptor on interrupt", async () => {
    const directory = mkdtempSync(join(tmpdir(), "crit-cli-dev-"))
    directories.push(directory)
    const dataRoot = join(directory, ".crit", "v1")
    const first = await start(dataRoot)
    const descriptorPath = join(dataRoot, "daemon.json")
    expect(existsSync(descriptorPath)).toBe(true)
    expect(readFileSync(descriptorPath, "utf8")).not.toContain("bearerSecret")
    await stop(first.child)
    expect(existsSync(descriptorPath)).toBe(false)

    const restarted = await start(dataRoot)
    expect(restarted.baseUrl).toBe(first.baseUrl)
    await stop(restarted.child)
    expect(existsSync(descriptorPath)).toBe(false)
  })
})
