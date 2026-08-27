import {
  decodeAccessAuthenticatedPersonWire,
  decodeAnonymousPersonWire
} from "@crit/protocol"
import { SELF } from "cloudflare:test"
import { describe, expect, it } from "vitest"

describe("Worker identity route", () => {
  it("returns the Access-authenticated Person", async() => {
    const response = await SELF.fetch("https://crit.example/identity", {
      headers: {
        "Cf-Access-Authenticated-User-Email": "ada@acme.com"
      }
    })
    const body: unknown = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("application/json")
    expect(decodeAccessAuthenticatedPersonWire(body)).toEqual({
      kind: "access-authenticated-person",
      schemaVersion: 1,
      address: "ada@acme.com"
    })
  })

  it("returns an anonymous Person without Access", async() => {
    const response = await SELF.fetch("https://crit.example/identity")
    const body: unknown = await response.json()

    expect(response.status).toBe(200)
    expect(decodeAnonymousPersonWire(body)).toEqual({
      kind: "anonymous-person",
      schemaVersion: 1,
      personId: "person_anonymous"
    })
  })

  it("falls back to anonymous when the Access email is invalid", async() => {
    const response = await SELF.fetch("https://crit.example/identity", {
      headers: {
        "Cf-Access-Authenticated-User-Email": "not-an-email"
      }
    })
    const body: unknown = await response.json()

    expect(response.status).toBe(200)
    expect(decodeAnonymousPersonWire(body).personId).toBe("person_anonymous")
  })

  it("rejects other methods and leaves unrelated paths missing", async() => {
    const wrongMethod = await SELF.fetch("https://crit.example/identity", {
      method: "POST",
      headers: {
        "Cf-Access-Authenticated-User-Email": "ada@acme.com"
      }
    })
    const unrelated = await SELF.fetch("https://crit.example/unrelated")

    expect(wrongMethod.status).toBe(405)
    expect(unrelated.status).toBe(404)
  })
})
