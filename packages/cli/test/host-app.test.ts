import { fileURLToPath } from "node:url"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { HOST_ORIGIN, resolveHostRoot } from "../src/host-app.js"

describe("resolveHostRoot", () => {
  it("finds the monorepo host package", () => {
    expect(resolveHostRoot()).toBe(
      path.resolve(fileURLToPath(new URL("../../host", import.meta.url)))
    )
    expect(HOST_ORIGIN).toBe("http://127.0.0.1:5173")
  })

  it("returns undefined when the host package is missing", () => {
    expect(resolveHostRoot("/tmp/crit-missing-host")).toBeUndefined()
  })
})
