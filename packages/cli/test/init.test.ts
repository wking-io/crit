import { spawn, spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

const executable = path.join(import.meta.dirname, "..", "dist", "main.js")
let root = ""

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "crit-cli-init-"))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const run = () => spawnSync(process.execPath, [
  executable,
  "init",
  "--root",
  root,
  "--json"
], { encoding: "utf8" })

const runAsync = () => new Promise<{
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
}>((resolve, reject) => {
  const child = spawn(process.execPath, [
    executable,
    "init",
    "--root",
    root,
    "--json"
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
  child.once("close", (status) => resolve({ status, stdout, stderr }))
})

describe("built crit-target init", () => {
  it("creates once and preserves the same project identity", () => {
    const created = run()
    expect(created.status, created.stderr).toBe(0)
    const first = JSON.parse(created.stdout)
    expect(first._tag).toBe("created")
    expect(first.manifest).toMatchObject({
      schemaVersion: 2,
      applicationId: expect.stringMatching(/^application_/)
    })
    const firstBytes = readFileSync(path.join(root, "crit.manifest.json"), "utf8")

    const unchanged = run()
    expect(unchanged.status, unchanged.stderr).toBe(0)
    const second = JSON.parse(unchanged.stdout)
    expect(second._tag).toBe("unchanged")
    expect(second.manifest).toEqual(first.manifest)
    expect(readFileSync(path.join(root, "crit.manifest.json"), "utf8")).toBe(firstBytes)
    const skillPath = path.join(root, ".agents", "skills", "crit", "SKILL.md")
    expect(readFileSync(skillPath, "utf8")).toContain("crit add-frame")
    writeFileSync(skillPath, "agent owned\n")
    const again = run()
    expect(again.status, again.stderr).toBe(0)
    expect(readFileSync(skillPath, "utf8")).toBe("agent owned\n")
  })

  it("converges concurrent processes on one project identity", async() => {
    const results = await Promise.all(Array.from({ length: 8 }, runAsync))
    expect(results.every((result) => result.status === 0), results.map((result) => result.stderr).join("\n")).toBe(true)
    const outputs = results.map((result) => JSON.parse(result.stdout))
    expect(outputs.filter((result) => result._tag === "created")).toHaveLength(1)
    expect(new Set(outputs.map((result) => result.manifest.applicationId)).size).toBe(1)
    expect(JSON.parse(readFileSync(path.join(root, "crit.manifest.json"), "utf8"))).toEqual(outputs[0]?.manifest)
  })

  it("rejects an invalid manifest without changing its bytes", () => {
    const manifestPath = path.join(root, "crit.manifest.json")
    const invalid = "{\"schemaVersion\":1,\"private\":\"do-not-print\"}\n"
    writeFileSync(manifestPath, invalid)
    const result = run()
    expect(result.status).not.toBe(0)
    expect(result.stdout).toBe("")
    expect(result.stderr).toBe(
      `Crit project manifest is invalid: ${manifestPath} (Manifest does not match schema version 2)\n`
    )
    expect(result.stderr).not.toContain("do-not-print")
    expect(readFileSync(manifestPath, "utf8")).toBe(invalid)
  })
})
