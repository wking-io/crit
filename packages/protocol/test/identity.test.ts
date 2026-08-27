import { readFile } from "node:fs/promises"

import {
  decodeAccessAuthenticatedPersonWire,
  decodeAnonymousPersonWire,
  decodeInstallationPersonWire,
  encodeAccessAuthenticatedPersonWire,
  encodeAnonymousPersonWire,
  encodeInstallationPersonWire
} from "../src/index.js"
import { describe, expect, it } from "vitest"

const accessFixture = new URL("./fixtures/access-authenticated-person.json", import.meta.url)
const anonymousFixture = new URL("./fixtures/anonymous-person.json", import.meta.url)

describe("AccessAuthenticatedPersonWire", () => {
  it("round-trips the versioned fixture", async() => {
    const input: unknown = JSON.parse(await readFile(accessFixture, "utf8"))
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

describe("AnonymousPersonWire", () => {
  it("round-trips the versioned fixture", async() => {
    const input: unknown = JSON.parse(await readFile(anonymousFixture, "utf8"))
    const decoded = decodeAnonymousPersonWire(input)

    expect(encodeAnonymousPersonWire(decoded)).toEqual(input)
  })
})

describe("InstallationPersonWire", () => {
  it("decodes access and anonymous responses", async() => {
    const access: unknown = JSON.parse(await readFile(accessFixture, "utf8"))
    const anonymous: unknown = JSON.parse(await readFile(anonymousFixture, "utf8"))

    expect(decodeInstallationPersonWire(access)).toEqual(
      decodeAccessAuthenticatedPersonWire(access)
    )
    expect(decodeInstallationPersonWire(anonymous)).toEqual(
      decodeAnonymousPersonWire(anonymous)
    )
    expect(encodeInstallationPersonWire(decodeInstallationPersonWire(access)))
      .toEqual(access)
    expect(encodeInstallationPersonWire(decodeInstallationPersonWire(anonymous)))
      .toEqual(anonymous)
  })
})
