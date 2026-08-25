import { Id } from "@crit/domain"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import {
  PresenceChangedSchema,
  ReplicaChangedSchema
} from "../src/index.js"

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

describe("PresenceChanged", () => {
  it("decodes a versioned full-roster notification", () => {
    const roster = {
      _tag: "presence-roster",
      canvasId: "canvas_notification_presence",
      people: [{
        _tag: "connected-person",
        person: {
          _tag: "person",
          personId: "person_notification",
          displayName: "Presence Person",
          email: { _tag: "unspecified" }
        }
      }]
    }
    expect(Schema.decodeUnknownSync(PresenceChangedSchema)({
      kind: "presence-changed",
      schemaVersion: 1,
      roster
    })).toEqual({
      kind: "presence-changed",
      schemaVersion: 1,
      roster
    })
    expect(() => Schema.decodeUnknownSync(PresenceChangedSchema)({
      kind: "presence-changed",
      schemaVersion: 2,
      roster
    })).toThrow()
  })
})
