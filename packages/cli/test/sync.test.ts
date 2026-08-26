import { spawnSync } from "node:child_process"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const executable = join(import.meta.dirname, "..", "dist", "main.js")

describe("built crit sync", () => {
  it("lists sync in help", () => {
    const result = spawnSync(process.execPath, [executable, "--help"], {
      encoding: "utf8"
    })

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain("sync")
  })
})
