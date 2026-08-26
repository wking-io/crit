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
  displayName: "Will King",
  email: { _tag: "unspecified" }
}

const connectedPerson = {
  _tag: "connectedPerson",
  person
}

const roster = {
  _tag: "presenceRoster",
  canvasId: "canvas_presence",
  people: [connectedPerson]
}

describe("PresenceRoster", () => {
  it("round-trips connected people", () => {
    const decoded = decodePresenceRoster(roster)
    expect(Schema.encodeSync(PresenceRoster)(decoded)).toEqual(roster)
  })

  it("rejects attribution tags in people", () => {
    expect(() => decodePresenceRoster({
      ...roster,
      people: [{ _tag: "person", person }]
    })).toThrow()
  })

  it("rejects duplicate personId values", () => {
    expect(() => decodePresenceRoster({
      ...roster,
      people: [
        connectedPerson,
        {
          _tag: "connectedPerson",
          person: { ...person, displayName: "Another display name" }
        }
      ]
    })).toThrow()
  })

  it("derives person keys", () => {
    const decoded = decodePresenceRoster(roster)
    expect(decoded.people.map(presenceKey)).toEqual(["person:person_will"])
  })
})
