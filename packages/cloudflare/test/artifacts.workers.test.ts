import { Id } from "@crit/domain"
import {
  decodeArtifactStoredWire,
  remoteArtifactPath
} from "@crit/protocol"
import { SELF } from "cloudflare:test"
import { describe, expect, it } from "vitest"

const artifactId = Id.artifact("artifact_hosted")
const path = `https://crit.example${remoteArtifactPath(artifactId)}`
const bytes = new Uint8Array([1, 2, 3, 4])
const other = new Uint8Array([4, 3, 2, 1])

const put = (body: Uint8Array, email?: string) => SELF.fetch(path, {
  method: "PUT",
  headers: email === undefined
    ? { "content-type": "application/octet-stream" }
    : {
      "content-type": "application/octet-stream",
      "Cf-Access-Authenticated-User-Email": email
    },
  body
})

describe("Worker artifact routes", () => {
  it("allows anonymous artifact put and get", async () => {
    const written = await put(bytes)
    const stored = decodeArtifactStoredWire(await written.json())
    const read = await SELF.fetch(`${path}?digest=${stored.digest}`)

    expect(written.status).toBe(200)
    expect(read.status).toBe(200)
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(bytes)
  })

  it("stores bytes and converges on an identical retry", async () => {
    const first = await put(bytes, "ada@acme.com")
    const stored = decodeArtifactStoredWire(await first.json())
    const retry = await put(bytes, "ada@acme.com")
    const conflict = await put(other, "ada@acme.com")
    const read = await SELF.fetch(`${path}?digest=${stored.digest}`, {
      headers: { "Cf-Access-Authenticated-User-Email": "ada@acme.com" }
    })

    expect(first.status).toBe(200)
    expect(retry.status).toBe(200)
    expect(decodeArtifactStoredWire(await retry.json())).toEqual(stored)
    expect(conflict.status).toBe(409)
    expect(read.status).toBe(200)
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(bytes)
  })
})
