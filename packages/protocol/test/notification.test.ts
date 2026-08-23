import { Id } from "@crit/domain"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import { ReplicaChangedSchema } from "../src/index.js"

describe("ReplicaChanged", () => {
  it("decodes the versioned notification and rejects another version", () => {
    const canvasId = Id.canvas("canvas_notification_protocol")
    expect(Schema.decodeUnknownSync(ReplicaChangedSchema)({
      kind: "replica-changed",
      schemaVersion: 1,
      canvasId
    })).toEqual({ kind: "replica-changed", schemaVersion: 1, canvasId })
    expect(() => Schema.decodeUnknownSync(ReplicaChangedSchema)({
      kind: "replica-changed",
      schemaVersion: 2,
      canvasId
    })).toThrow()
  })
})
