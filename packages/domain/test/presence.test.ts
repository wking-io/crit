import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import {
  PresenceRoster,
  decodePresenceRoster,
  presenceKey
} from "../src/index.js"

const person = {
  _tag: "person",
  personId: "person_will",
  displayName: "Will King"
}

const agent = {
  _tag: "agent",
  agentId: "agent_cursor",
  displayName: "Cursor"
}

const delegatedBy = {
  _tag: "person",
  personId: "person_ada",
  displayName: "Ada"
}

const connectedPerson = {
  _tag: "connected-person",
  person
}

const agentRun = {
  _tag: "active-agent-execution",
  agent,
  delegatedBy,
  executionId: "execution_cursor_1",
  reportedRuntime: {
    _tag: "reported-runtime",
    source: "client-reported",
    harness: { name: "Cursor", version: "1.0.0" },
    model: { provider: "openai", name: "gpt-5.6" }
  }
}

const roster = {
  _tag: "presence-roster",
  canvasId: "canvas_presence",
  people: [connectedPerson],
  agentRuns: [agentRun]
}

describe("PresenceRoster", () => {
  it("round-trips people and active agent executions", () => {
    const decoded = decodePresenceRoster(roster)
    expect(Schema.encodeSync(PresenceRoster)(decoded)).toEqual(roster)
  })

  it("requires delegatedBy on every active agent execution", () => {
    const { delegatedBy: _delegatedBy, ...withoutDelegation } = agentRun
    expect(() => decodePresenceRoster({
      ...roster,
      agentRuns: [withoutDelegation]
    })).toThrow()
  })

  it("rejects attribution tags in presence collections", () => {
    expect(() => decodePresenceRoster({
      ...roster,
      people: [{ _tag: "person", person }]
    })).toThrow()
    expect(() => decodePresenceRoster({
      ...roster,
      agentRuns: [{
        _tag: "agent",
        agent,
        delegatedBy,
        executionId: "execution_cursor_1"
      }]
    })).toThrow()
  })

  it("rejects duplicate personId and executionId values", () => {
    expect(() => decodePresenceRoster({
      ...roster,
      people: [
        connectedPerson,
        {
          _tag: "connected-person",
          person: { ...person, displayName: "Another display name" }
        }
      ]
    })).toThrow()
    expect(() => decodePresenceRoster({
      ...roster,
      agentRuns: [
        agentRun,
        { ...agentRun, agent: { ...agent, displayName: "Another Agent" } }
      ]
    })).toThrow()
  })

  it("derives unique keys across participant kinds", () => {
    const decoded = decodePresenceRoster(roster)
    const keys = [
      ...decoded.people.map(presenceKey),
      ...decoded.agentRuns.map(presenceKey)
    ]
    expect(keys).toEqual([
      "person:person_will",
      "execution:execution_cursor_1"
    ])
    expect(new Set(keys).size).toBe(keys.length)
  })
})
