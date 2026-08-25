import { Id } from "@crit/domain"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import {
  AnnouncePresence,
  DepartPresence,
  LocalReplicaSocketHello,
  LocalReplicaSocketServerFrame,
  PresenceLeaseReceipt
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

  it("decodes presence claims, leases, and socket rosters", () => {
    const canvasId = Id.canvas("canvas_socket_presence")
    const leaseId = "lease_0123456789abcdef0123456789abcdef"
    const claim = {
      _tag: "active-agent-execution",
      agent: {
        _tag: "agent",
        agentId: "agent_socket",
        displayName: "Socket Agent"
      },
      executionId: "execution_socket"
    }
    expect(Schema.decodeUnknownSync(AnnouncePresence)({
      _tag: "announce-presence",
      canvasId,
      claim
    })).toEqual({ _tag: "announce-presence", canvasId, claim })
    expect(Schema.decodeUnknownSync(DepartPresence)({
      _tag: "depart-presence",
      canvasId,
      leaseId
    })).toEqual({ _tag: "depart-presence", canvasId, leaseId })
    expect(Schema.decodeUnknownSync(PresenceLeaseReceipt)({
      leaseId,
      expiresAt: "2026-08-25T05:00:30.000Z"
    })).toEqual({
      leaseId,
      expiresAt: "2026-08-25T05:00:30.000Z"
    })
    expect(Schema.decodeUnknownSync(LocalReplicaSocketServerFrame)({
      kind: "presence-changed",
      schemaVersion: 1,
      roster: {
        _tag: "presence-roster",
        canvasId,
        people: [],
        agentRuns: []
      }
    })).toMatchObject({
      kind: "presence-changed",
      roster: { canvasId }
    })
  })
})
