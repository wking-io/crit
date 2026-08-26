import {
  AccessPersonEmail,
  CanvasTitle,
  EmailAddress,
  Id,
  PersonSnapshot,
  Sha256Digest
} from "@crit/domain"
import {
  decodeCanvasSharedWire,
  encodeShareCanvasWire,
  ShareDigestMismatch
} from "@crit/protocol"
import { SELF } from "cloudflare:test"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

const digest = (hex: string) => Schema.decodeUnknownSync(Sha256Digest)(
  `sha256:${hex.repeat(64)}`
)

const body = (
  canvasId: string,
  options?: {
    readonly address?: string
    readonly projectionDigest?: ReturnType<typeof digest>
    readonly shareId?: string
    readonly importId?: string
  }
) => {
  const email = AccessPersonEmail.make({
    address: Schema.decodeUnknownSync(EmailAddress)(options?.address ?? "ada@acme.com")
  })
  const person = PersonSnapshot.make({
    personId: Id.person("person_share_worker"),
    displayName: "Ada Lovelace",
    email
  })
  return JSON.stringify(encodeShareCanvasWire({
    kind: "share-canvas",
    schemaVersion: 2,
    canvasId: Id.canvas(canvasId),
    title: Schema.decodeUnknownSync(CanvasTitle)("Checkout"),
    shareId: Id.share(options?.shareId ?? `share_${canvasId}`),
    importId: Id.imported(options?.importId ?? `import_${canvasId}`),
    projectionDigest: options?.projectionDigest ?? digest("a"),
    person: {
      ...person,
      email
    }
  }))
}

const post = (
  canvasId: string,
  options?: {
    readonly address?: string
    readonly projectionDigest?: ReturnType<typeof digest>
    readonly shareId?: string
    readonly importId?: string
  }
) => SELF.fetch("https://crit.example/canvas", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "Cf-Access-Authenticated-User-Email": "ada@acme.com"
  },
  body: body(canvasId, options)
})

const expectedReceipt = (canvasId: string) => ({
  kind: "canvas-shared",
  schemaVersion: 2,
  canvasId,
  title: "Checkout",
  shareId: `share_${canvasId}`,
  importId: `import_${canvasId}`,
  projectionDigest: digest("a"),
  workspaceId: "workspace_default",
  personId: "person_share_worker"
})

describe("Worker Canvas share route", () => {
  it("creates a Canvas and stores the first-share receipt", async() => {
    const response = await post("canvas_worker_share")
    const receipt: unknown = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("application/json")
    expect(decodeCanvasSharedWire(receipt)).toEqual(
      expectedReceipt("canvas_worker_share")
    )
  })

  it("returns the same receipt when the share is repeated with the same digest", async() => {
    const first = await post("canvas_worker_share_repeat")
    const second = await post("canvas_worker_share_repeat")
    const receipt: unknown = await second.json()

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(decodeCanvasSharedWire(receipt)).toEqual(
      expectedReceipt("canvas_worker_share_repeat")
    )
    expect(decodeCanvasSharedWire(await first.json())).toEqual(
      decodeCanvasSharedWire(receipt)
    )
  })

  it("rejects a changed digest under the same share ID", async() => {
    const first = await post("canvas_worker_share_digest")
    const second = await post("canvas_worker_share_digest", {
      projectionDigest: digest("b")
    })
    const body: unknown = await second.json()

    expect(first.status).toBe(200)
    expect(second.status).toBe(409)
    expect(Schema.decodeUnknownSync(ShareDigestMismatch)(body)).toEqual({
      _tag: "shareDigestMismatch",
      shareId: "share_canvas_worker_share_digest",
      expectedDigest: digest("a"),
      receivedDigest: digest("b")
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
      { address: "grace@acme.com" }
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
