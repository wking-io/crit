import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"

import {
  ConnectedPerson,
  EmailAddress,
  Id,
  PresenceRoster,
  accessConnectedPerson,
  accessPersonSnapshot,
  decodePresenceRoster,
  occupancyRoster,
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

const ada = ConnectedPerson.make({
  person: {
    _tag: "person",
    personId: Id.person("person_ada"),
    displayName: "Ada",
    email: { _tag: "unspecified" }
  }
})

const will = ConnectedPerson.make({
  person: {
    _tag: "person",
    personId: Id.person("person_will"),
    displayName: "Will",
    email: { _tag: "unspecified" }
  }
})

describe("occupancyRoster", () => {
  it("collapses one Person across seats and sorts by personId", () => {
    const canvasId = Id.canvas("canvas_occupancy")

    expect(occupancyRoster(canvasId, [will, ada, ada])).toEqual({
      _tag: "presenceRoster",
      canvasId,
      people: [ada, will]
    })
    expect(occupancyRoster(canvasId, [])).toEqual({
      _tag: "presenceRoster",
      canvasId,
      people: []
    })
  })

  it("keeps the first seat for a duplicated Person", () => {
    const canvasId = Id.canvas("canvas_occupancy_first")
    const laterAda = ConnectedPerson.make({
      person: {
        ...ada.person,
        displayName: "Ada Lovelace"
      }
    })

    expect(occupancyRoster(canvasId, [laterAda, ada]).people).toEqual([laterAda])
  })
})

describe("accessConnectedPerson", () => {
  it("stamps an Access Person from the company email", async() => {
    const address = Schema.decodeUnknownSync(EmailAddress)("ada@acme.com")
    const connected = await Effect.runPromise(accessConnectedPerson(address))
    const snapshot = await Effect.runPromise(accessPersonSnapshot(address))

    expect(connected).toEqual({
      _tag: "connectedPerson",
      person: {
        _tag: "person",
        personId: "person_154e1e0a1872533ddf397a16e5a65dcf",
        displayName: "Ada",
        email: { _tag: "access", address }
      }
    })
    expect(snapshot).toEqual(connected.person)
  })
})
