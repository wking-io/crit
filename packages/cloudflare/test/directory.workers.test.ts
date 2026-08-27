import {
  AccessPersonEmail,
  CanvasTitle,
  EmailAddress,
  Id,
  PersonSnapshot,
  Sha256Digest
} from "@crit/domain"
import {
  decodeCanvasDirectoryWire,
  encodeShareCanvasWire
} from "@crit/protocol"
import { SELF } from "cloudflare:test"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

const digest = Schema.decodeUnknownSync(Sha256Digest)(`sha256:${"c".repeat(64)}`)

const share = (canvasId: string, title: string) => {
  const email = AccessPersonEmail.make({
    address: Schema.decodeUnknownSync(EmailAddress)("ada@acme.com")
  })
  const person = PersonSnapshot.make({
    personId: Id.person("person_directory"),
    displayName: "Ada Lovelace",
    email
  })
  return SELF.fetch("https://crit.example/canvas", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Cf-Access-Authenticated-User-Email": "ada@acme.com"
    },
    body: JSON.stringify(encodeShareCanvasWire({
      kind: "share-canvas",
      schemaVersion: 2,
      canvasId: Id.canvas(canvasId),
      title: Schema.decodeUnknownSync(CanvasTitle)(title),
      shareId: Id.share(`share_${canvasId}`),
      importId: Id.imported(`import_${canvasId}`),
      projectionDigest: digest,
      person: {
        ...person,
        email
      }
    }))
  })
}

describe("Worker canvas directory", () => {
  it("lists shared canvases with or without Access", async () => {
    const anonymous = await SELF.fetch("https://crit.example/canvas")
    await share("canvas_directory_one", "One")
    await share("canvas_directory_two", "Two")
    const listed = await SELF.fetch("https://crit.example/canvas", {
      headers: { "Cf-Access-Authenticated-User-Email": "ada@acme.com" }
    })
    const body = decodeCanvasDirectoryWire(await listed.json())

    expect(anonymous.status).toBe(200)
    expect(listed.status).toBe(200)
    expect(body.canvases.map((row) => row.canvasId).sort()).toEqual([
      "canvas_directory_one",
      "canvas_directory_two"
    ])
  })
})
