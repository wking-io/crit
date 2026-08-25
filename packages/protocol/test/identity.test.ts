import { readFile } from "node:fs/promises"

import {
  decodeAccessAuthenticatedPersonWire,
  encodeAccessAuthenticatedPersonWire
} from "../src/index.js"
import { describe, expect, it } from "vitest"

const fixture = new URL("./fixtures/access-authenticated-person.json", import.meta.url)

describe("AccessAuthenticatedPersonWire", () => {
  it("round-trips the versioned fixture", async() => {
    const input: unknown = JSON.parse(await readFile(fixture, "utf8"))
    const decoded = decodeAccessAuthenticatedPersonWire(input)

    expect(encodeAccessAuthenticatedPersonWire(decoded)).toEqual(input)
  })

  it.each([
    ["excess property", {
      kind: "access-authenticated-person",
      schemaVersion: 1,
      address: "ada@acme.com",
      extra: true
    }],
    ["wrong kind", {
      kind: "person",
      schemaVersion: 1,
      address: "ada@acme.com"
    }],
    ["wrong version", {
      kind: "access-authenticated-person",
      schemaVersion: 2,
      address: "ada@acme.com"
    }],
    ["invalid email", {
      kind: "access-authenticated-person",
      schemaVersion: 1,
      address: "not-an-email"
    }]
  ])("rejects %s", (_label, input) => {
    expect(() => decodeAccessAuthenticatedPersonWire(input)).toThrow()
  })
})
