import { describe, expect, it } from "vitest"

import { formatPendingConflicts } from "../src/sync-result.js"

describe("formatPendingConflicts", () => {
  it("omits a clean sync", () => {
    expect(formatPendingConflicts(0, 0)).toBeUndefined()
  })

  it("names conflicted and blocked pending work", () => {
    expect(formatPendingConflicts(1, 1)).toBe("1 conflicted  1 blocked")
    expect(formatPendingConflicts(2, 0)).toBe("2 conflicted")
    expect(formatPendingConflicts(0, 3)).toBe("3 blocked")
  })
})
