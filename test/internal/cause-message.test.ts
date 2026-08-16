import { describe, expect, it } from "vitest"

import { causeMessage } from "../../src/internal/cause-message.js"

describe("causeMessage", () => {
  it("preserves Error messages", () => {
    expect(causeMessage(new Error("broken"))).toBe("broken")
  })

  it("stringifies non-Error causes by default", () => {
    expect(causeMessage({ reason: "broken" })).toBe("[object Object]")
  })

  it("uses an explicit fallback for non-Error causes", () => {
    expect(causeMessage("broken", "Operation failed")).toBe("Operation failed")
  })
})
