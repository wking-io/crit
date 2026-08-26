import { spawnSync } from "node:child_process"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const executable = join(import.meta.dirname, "..", "dist", "main.js")

describe("crit agent begin", () => {
  it("lists begin flags in help", () => {
    const result = spawnSync(process.execPath, [executable, "agent", "begin", "--help"], {
      encoding: "utf8"
    })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain("--name")
    expect(result.stdout).toContain("--harness")
    expect(result.stdout).toContain("--json")
    expect(result.stdout).not.toContain("--agent")
  })

  it("lists agent on the root help", () => {
    const result = spawnSync(process.execPath, [executable, "--help"], {
      encoding: "utf8"
    })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain("agent")
  })
})
