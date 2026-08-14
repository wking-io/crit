import { Cause } from "effect"
import { describe, expect, it } from "vitest"

import { critOpeningFailure } from "../../src/react/crit.js"
import { CritClientUnavailable } from "../../src/runtime/canvas-failure.js"

describe("critOpeningFailure", () => {
  it("preserves expected Crit Client failures", () => {
    const failure = new CritClientUnavailable({
      operation: "current-author",
      id: "current-author",
      detail: "Git user.email is not configured"
    })

    expect(critOpeningFailure(Cause.fail(failure))).toEqual({
      kind: "client",
      failure
    })
  })

  it("normalizes unexpected defects into an explicit UI failure", () => {
    expect(critOpeningFailure(Cause.die(new Error("Opening exploded"))))
      .toEqual({ kind: "defect", message: "Opening exploded" })
    expect(critOpeningFailure(Cause.die("Opening exploded")))
      .toEqual({ kind: "defect", message: "Opening exploded" })
  })

  it("does not hide a defect when a concurrent operation also fails", () => {
    const failure = new CritClientUnavailable({
      operation: "load",
      id: "review",
      detail: "Canvas unavailable"
    })

    expect(critOpeningFailure(Cause.combine(
      Cause.fail(failure),
      Cause.die(new Error("Concurrent defect"))
    ))).toEqual({ kind: "defect", message: "Concurrent defect" })
  })
})
