import { describe, expect, it } from "vitest"
import { Schema } from "effect"

import {
  CritClientCommandFailed,
  CritClientErrorSchema,
  CritClientInvalidDocument,
  CritClientNotFound,
  CritClientUnavailable,
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
})
