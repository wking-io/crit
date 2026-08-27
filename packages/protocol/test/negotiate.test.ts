import { Option, Result } from "effect"
import { describe, expect, it } from "vitest"

import {
  formatProtocolFailure,
  isProtocolFailure,
  negotiateWire,
  protocolFailureHttpStatus,
  ProtocolFailure,
  readProtocolFailure
} from "../src/index.js"

describe("protocol negotiation", () => {
  it("accepts a matching kind and schema version", () => {
    const result = negotiateWire(
      { kind: "share-canvas", schemaVersion: 2 },
      { kind: "share-canvas", schemaVersion: 2 }
    )

    expect(result).toEqual(Result.succeed({
      kind: "share-canvas",
      schemaVersion: 2
    }))
  })

  it("classifies a missing header as malformed", () => {
    const result = negotiateWire({}, { kind: "share-canvas", schemaVersion: 2 })

    expect(result).toEqual(Result.fail(ProtocolFailure.malformedMessage({
      location: "message",
      message: "Message header is malformed"
    })))
  })

  it("classifies kind before version", () => {
    const result = negotiateWire(
      { kind: "other", schemaVersion: 99 },
      { kind: "share-canvas", schemaVersion: 2 }
    )

    expect(result).toEqual(Result.fail(ProtocolFailure.messageKindMismatch({
      location: "message",
      message: "Message kind does not match this codec"
    })))
  })

  it("rejects a mismatched schema version with an upgrade error", () => {
    const result = negotiateWire(
      { kind: "share-canvas", schemaVersion: 3 },
      { kind: "share-canvas", schemaVersion: 2 }
    )
    const failure = ProtocolFailure.unsupportedVersion({
      location: "message",
      requestedVersion: 3,
      supportedVersion: 2,
      message: "Schema version 3 is unsupported. This installation speaks version 2. Upgrade Crit so the client and installation match."
    })

    expect(Result.isFailure(result) && result.failure).toEqual(failure)
    expect(formatProtocolFailure(failure)).toBe(
      "Schema version 3 is unsupported. This installation speaks version 2. Upgrade Crit so the client and installation match."
    )
    expect(protocolFailureHttpStatus(failure)).toBe(426)
    expect(isProtocolFailure(failure)).toBe(true)
  })

  it("reads a protocol-failure envelope", () => {
    const failure = ProtocolFailure.unsupportedVersion({
      location: "message",
      requestedVersion: 3,
      supportedVersion: 2,
      message: "Schema version 3 is unsupported. This installation speaks version 2. Upgrade Crit so the client and installation match."
    })

    expect(readProtocolFailure({
      kind: "protocol-failure",
      schemaVersion: 1,
      failure
    })).toEqual(Option.some(failure))
    expect(readProtocolFailure({ _tag: "canvasNotFound" })).toEqual(Option.none())
  })
})
