import {
  decodeAccessAuthenticatedPersonWire,
  decodeAnonymousPersonWire,
  critPersonCookieName,
  critPersonIdHeader
} from "@crit/protocol"
import { Id } from "@crit/domain"
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

  it("returns a unique anonymous Person without Access", async() => {
    const response = await SELF.fetch("https://crit.example/identity")
    const body: unknown = await response.json()
    const decoded = decodeAnonymousPersonWire(body)

    expect(response.status).toBe(200)
    expect(decoded.personId).toMatch(/^person_/)
    expect(response.headers.get("Set-Cookie")).toContain(`${critPersonCookieName}=`)
  })

  it("reuses the anonymous Person from a cookie", async() => {
    const first = await SELF.fetch("https://crit.example/identity")
    const personId = decodeAnonymousPersonWire(await first.json()).personId
    const cookie = first.headers.get("Set-Cookie") ?? ""

    const second = await SELF.fetch("https://crit.example/identity", {
      headers: { Cookie: cookie.split(";")[0] ?? "" }
    })

    expect(decodeAnonymousPersonWire(await second.json()).personId).toBe(personId)
    expect(second.headers.get("Set-Cookie")).toBeNull()
  })

  it("accepts Crit-Person-Id for anonymous callers", async() => {
    const personId = Id.person("person_identity_header")
    const response = await SELF.fetch("https://crit.example/identity", {
      headers: { [critPersonIdHeader]: personId }
    })

    expect(decodeAnonymousPersonWire(await response.json()).personId).toBe(personId)
    expect(response.headers.get("Set-Cookie")).toBeNull()
  })

  it("falls back to anonymous when the Access email is invalid", async() => {
    const response = await SELF.fetch("https://crit.example/identity", {
      headers: {
        "Cf-Access-Authenticated-User-Email": "not-an-email"
      }
    })
    const body: unknown = await response.json()

    expect(response.status).toBe(200)
    expect(decodeAnonymousPersonWire(body).personId).toMatch(/^person_/)
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
