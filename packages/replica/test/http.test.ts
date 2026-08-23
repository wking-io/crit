import { Id } from "@crit/domain"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import {
  LocalReplicaSocketHello,
  LocalReplicaSocketServerFrame
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
  })
})
