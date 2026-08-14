import { spawnSync } from "node:child_process"
import path from "node:path"

import { describe, expect, it } from "vitest"

describe("playground seed", () => {
  it("is valid executable JavaScript", () => {
    const result = spawnSync(
      process.execPath,
      ["--check", path.resolve("playground/seed.mjs")],
      { encoding: "utf8" }
    )

    expect(result.stderr).toBe("")
    expect(result.status).toBe(0)
  })
})
