import { describe, expect, it } from "vitest"

import {
  defaultRuntimeCapabilities,
  runtimeId
} from "../../src/runtime/runtime-capabilities.js"

describe("runtimeId", () => {
  it("uses the injected UUID capability when available", () => {
    expect(runtimeId("frame", {
      now: () => 0,
      random: () => 0,
      randomUUID: () => "generated"
    })).toBe("frame-generated")
  })

  it("falls back deterministically when UUID generation is unavailable", () => {
    expect(runtimeId("session", {
      now: () => 123,
      random: () => 0.5,
      randomUUID: () => undefined
    })).toBe("session-123-i")
  })

  it("does not treat Node web-compatible globals as browser capabilities", () => {
    expect(defaultRuntimeCapabilities.confirm("discard changes?")).toBeUndefined()
    expect(defaultRuntimeCapabilities.document()).toBeUndefined()
    expect(defaultRuntimeCapabilities.platform()).toBe("")
    expect(defaultRuntimeCapabilities.sessionStorage()).toBeUndefined()
  })
})
