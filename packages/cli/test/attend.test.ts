import { spawnSync } from "node:child_process"
import path from "node:path"

import { describe, expect, it } from "vitest"

const executable = path.join(import.meta.dirname, "..", "dist", "main.js")

describe("crit attend", () => {
  it("exposes the required Agent identity and optional runtime flags", () => {
    const result = spawnSync(process.execPath, [
      executable,
      "attend",
      "--help"
    ], { encoding: "utf8" })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain("<canvas-id>")
    expect(result.stdout).toContain("--agent-id")
    expect(result.stdout).toContain("--agent-name")
    expect(result.stdout).toContain("--execution-id")
    expect(result.stdout).toContain("--harness")
    expect(result.stdout).toContain("--model")
  })
})
