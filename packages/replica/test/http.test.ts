import { Id } from "@crit/domain"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import {
  LocalReplicaSocketHello,
  LocalReplicaSocketServerFrame,
  LocalApiVersionUnsupported,
  formatLocalApiVersionUnsupported
} from "../src/http.js"

describe("local replica socket frames", () => {
  it("accepts only the bounded versioned bearer hello", () => {
    const bearer = "a".repeat(32)
    expect(Schema.decodeUnknownSync(LocalReplicaSocketHello)({
      kind: "authenticate",
      schemaVersion: 1,
      bearer
    })).toEqual({ kind: "authenticate", schemaVersion: 1, bearer })
    expect(() => Schema.decodeUnknownSync(LocalReplicaSocketHello)({
      kind: "authenticate",
      schemaVersion: 2,
      bearer
    })).toThrow()
    expect(() => Schema.decodeUnknownSync(LocalReplicaSocketHello)({
      kind: "authenticate",
      schemaVersion: 1,
      bearer: "a".repeat(257)
    })).toThrow()
  })

  it("decodes readiness separately from change hints", () => {
    const canvasId = Id.canvas("canvas_socket_frames")
    expect(Schema.decodeUnknownSync(LocalReplicaSocketServerFrame)({
      kind: "subscription-ready",
      schemaVersion: 1,
      canvasId
    })).toEqual({ kind: "subscription-ready", schemaVersion: 1, canvasId })
    expect(() => Schema.decodeUnknownSync(LocalReplicaSocketServerFrame)({
      kind: "presence-changed",
      schemaVersion: 1,
      roster: {
        _tag: "presenceRoster",
        canvasId,
        people: []
      }
    })).toThrow()
  })
})

describe("local API version errors", () => {
  it("formats an API version mismatch as an upgrade error", () => {
    expect(formatLocalApiVersionUnsupported(new LocalApiVersionUnsupported({
      requestedVersion: "2",
      supportedVersion: "1"
    }))).toBe(
      "The local daemon API version 2 is unsupported. This daemon speaks version 1. Upgrade Crit so the client and daemon match."
    )
    expect(formatLocalApiVersionUnsupported(new LocalApiVersionUnsupported({
      requestedVersion: null,
      supportedVersion: "1"
    }))).toBe(
      "The local daemon API version is missing. This daemon speaks version 1. Upgrade Crit so the client and daemon match."
    )
  })
})
