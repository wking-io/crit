import {
  AccessPersonEmail,
  CanvasTitle,
  EmailAddress,
  Id,
  PersonSnapshot
} from "@crit/domain"
import {
  decodeCanvasSharedWire,
  encodeShareCanvasWire
} from "@crit/protocol"
import { SELF } from "cloudflare:test"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

const body = (
  canvasId: string,
  address = "ada@acme.com"
) => {
  const email = AccessPersonEmail.make({
    address: Schema.decodeUnknownSync(EmailAddress)(address)
  })
  const person = PersonSnapshot.make({
    personId: Id.person("person_share_worker"),
    displayName: "Ada Lovelace",
    email
  })
  return JSON.stringify(encodeShareCanvasWire({
    kind: "share-canvas",
    schemaVersion: 1,
    canvasId: Id.canvas(canvasId),
    title: Schema.decodeUnknownSync(CanvasTitle)("Checkout"),
    person: {
      ...person,
      email
    }
  }))
}

const post = (
  canvasId: string,
  address?: string
) => SELF.fetch("https://crit.example/canvas", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "Cf-Access-Authenticated-User-Email": "ada@acme.com"
  },
  body: body(canvasId, address)
})

describe("Worker Canvas share route", () => {
  it("creates a Canvas and returns the projected title", async() => {
    const response = await post("canvas_worker_share")
    const receipt: unknown = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("application/json")
    expect(decodeCanvasSharedWire(receipt)).toEqual({
      kind: "canvas-shared",
      schemaVersion: 1,
      canvasId: "canvas_worker_share",
      title: "Checkout"
    })
  })

  it("returns the existing Canvas when the share is repeated", async() => {
    const first = await post("canvas_worker_share_repeat")
    const second = await post("canvas_worker_share_repeat")
    const receipt: unknown = await second.json()

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(decodeCanvasSharedWire(receipt)).toMatchObject({
      canvasId: "canvas_worker_share_repeat",
      title: "Checkout"
    })
  })

  it("rejects a missing Access identity", async() => {
    const response = await SELF.fetch("https://crit.example/canvas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body("canvas_worker_share_missing_access")
    })

    expect(response.status).toBe(401)
    expect(await response.text()).toBe("")
  })

  it("rejects a Person email that Access did not authenticate", async() => {
    const response = await post(
      "canvas_worker_share_wrong_access",
      "grace@acme.com"
    )

    expect(response.status).toBe(401)
    expect(await response.text()).toBe("")
  })

  it("rejects a non-Access Person email as unauthenticated", async() => {
    const input = JSON.parse(body("canvas_worker_share_unspecified"))
    input.person.email = { _tag: "unspecified" }
    const response = await SELF.fetch("https://crit.example/canvas", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Cf-Access-Authenticated-User-Email": "ada@acme.com"
      },
      body: JSON.stringify(input)
    })

    expect(response.status).toBe(401)
    expect(await response.text()).toBe("")
  })

  it("rejects invalid request bodies", async() => {
    const response = await SELF.fetch("https://crit.example/canvas", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Cf-Access-Authenticated-User-Email": "ada@acme.com"
      },
      body: "{"
    })

    expect(response.status).toBe(400)
    expect(await response.text()).toBe("")
  })

  it("allows only POST on the Canvas collection", async() => {
    const response = await SELF.fetch("https://crit.example/canvas")

    expect(response.status).toBe(405)
    expect(await response.text()).toBe("")
  })
})
