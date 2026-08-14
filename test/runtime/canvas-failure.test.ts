import { describe, expect, it } from "vitest"
import { Schema } from "effect"

import {
  CritClientCommandFailed,
  CritClientErrorSchema,
  CritClientInvalidDocument,
  CritClientNotFound,
  CritClientUnavailable,
  critClientErrorMessage,
  isCurrentAuthorError,
  type CritClientError
} from "../../src/runtime/canvas-failure.js"

describe("CritClientErrorSchema", () => {
  it("round-trips every durable Canvas failure without renaming fields", () => {
    const failures: ReadonlyArray<CritClientError> = [
      new CritClientNotFound({ id: "review" }),
      new CritClientCommandFailed({
        id: "review",
        reason: "frame-not-found",
        detail: "Frame not found: candidate"
      }),
      new CritClientInvalidDocument({
        id: "review",
        detail: "Duplicate Canvas item ID: candidate"
      }),
      new CritClientUnavailable({
        operation: "load",
        id: "review",
        detail: "Permission denied"
      })
    ]
    const encode = Schema.encodeSync(CritClientErrorSchema)
    const decode = Schema.decodeUnknownSync(CritClientErrorSchema)

    for (const failure of failures) {
      const encoded = encode(failure)
      const decoded = decode(JSON.parse(JSON.stringify(encoded)))

      expect(decoded).toMatchObject(encoded)
      expect(decoded).toBeInstanceOf(failure.constructor)
    }
  })

  it("formats every tagged failure and identifies Current Author failures", () => {
    expect(critClientErrorMessage(new CritClientNotFound({ id: "review" })))
      .toBe("Canvas not found: review")
    expect(critClientErrorMessage(new CritClientCommandFailed({
      id: "review",
      reason: "frame-not-found",
      detail: "Frame not found: candidate"
    }))).toBe("Frame not found: candidate")
    expect(critClientErrorMessage(new CritClientInvalidDocument({
      id: "review",
      detail: "Invalid Canvas"
    }))).toBe("Invalid Canvas")

    const currentAuthor = new CritClientUnavailable({
      operation: "current-author",
      id: "current-author",
      detail: "Git user.email is not configured"
    })
    expect(critClientErrorMessage(currentAuthor))
      .toBe("Git user.email is not configured")
    expect(isCurrentAuthorError(currentAuthor)).toBe(true)
    expect(isCurrentAuthorError(new CritClientUnavailable({
      operation: "load",
      id: "review",
      detail: "Permission denied"
    }))).toBe(false)
    expect(isCurrentAuthorError(new CritClientUnavailable({
      operation: "load",
      id: "current-author",
      detail: "Canvas unavailable"
    }))).toBe(false)
  })
})
