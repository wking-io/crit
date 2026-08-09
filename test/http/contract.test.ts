import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import { Canvas, CanvasCommand } from "../../src/core/index.js"
import { HttpCritClient } from "../../src/http/client.js"
import { makeCritHttpHandler } from "../../src/http/contract.js"
import {
  CritClientCommandFailed,
  type CritClientShape
} from "../../src/session/crit-client.js"

const document = Canvas.export(
  Canvas.create({ id: "homepage", title: "Homepage" })
)

const makeClient = (): CritClientShape & {
  readonly applied: Array<ReadonlyArray<unknown>>
  readonly snapshots: Array<string>
} => {
  const applied: Array<ReadonlyArray<unknown>> = []
  const snapshots: Array<string> = []
  return {
    applied,
    snapshots,
    load: () => Effect.succeed(document),
    apply: (_id, commands) => {
      applied.push(commands)
      return Effect.succeed(document)
    },
    snapshot: (_canvasId, frameId) => {
      snapshots.push(frameId)
      return Effect.succeed(document)
    }
  }
}

const canvasUrl = "http://localhost:5173/__crit/api/canvases/homepage"
const snapshotUrl = `${canvasUrl}/frames/candidate/snapshot`

const applyBody = JSON.stringify({
  commands: [{ _tag: "SetFrameStatus", id: "candidate", status: "approved" }]
})

describe("makeCritHttpHandler", () => {
  it("round-trips durable failures through HTTP without translating them", async () => {
    const client: CritClientShape = {
      ...makeClient(),
      apply: () =>
        Effect.fail(
          new CritClientCommandFailed({
            id: "homepage",
            reason: "frame-not-found",
            detail: "Frame not found: candidate"
          })
        )
    }
    const handler = makeCritHttpHandler(client)
    const http = HttpCritClient.make({
      apiPath: "http://localhost:5173/__crit/api",
      fetch: async (input, init) => {
        const response = await Effect.runPromise(
          handler(new Request(input, init))
        )
        if (response === null) throw new Error("Request was not handled")
        return response
      }
    })

    const failure = await Effect.runPromise(
      Effect.flip(
        http.apply("homepage", [
          CanvasCommand.setFrameStatus({
            id: "candidate",
            status: "approved"
          })
        ])
      )
    )

    expect(failure).toBeInstanceOf(CritClientCommandFailed)
    expect(failure).toMatchObject({
      id: "homepage",
      reason: "frame-not-found",
      detail: "Frame not found: candidate"
    })
  })

  it("applies same-origin PATCH command batches", async () => {
    const client = makeClient()
    const handler = makeCritHttpHandler(client)
    const response = await Effect.runPromise(
      handler(
        new Request(canvasUrl, {
          method: "PATCH",
          headers: { Origin: "http://localhost:5173" },
          body: applyBody
        })
      )
    )
    expect(response?.status).toBe(200)
    expect(client.applied).toHaveLength(1)
  })

  it("returns 413 when the PATCH body exceeds the configured limit", async () => {
    const client = makeClient()
    const handler = makeCritHttpHandler(client, { maxBodyBytes: 8 })
    const response = await Effect.runPromise(
      handler(
        new Request(canvasUrl, {
          method: "PATCH",
          body: applyBody
        })
      )
    )

    expect(response?.status).toBe(413)
    expect(await response?.json()).toEqual({
      error: {
        code: "invalid-request",
        message: "Request body exceeds 8 bytes",
        id: "homepage"
      }
    })
    expect(client.applied).toHaveLength(0)
  })

  it("returns 400 when a body-read failure mentions 'exceeds'", async () => {
    const client = makeClient()
    const handler = makeCritHttpHandler(client)
    const request = new Request(canvasUrl, {
      method: "PATCH",
      body: applyBody
    })
    Object.defineProperty(request, "arrayBuffer", {
      value: () =>
        Promise.reject(new Error("Body stream exceeds transport budget"))
    })
    const response = await Effect.runPromise(handler(request))

    expect(response?.status).toBe(400)
    const body = (await response?.json()) as {
      readonly error: { readonly message: string }
    }
    expect(body.error.message).toBe("Body stream exceeds transport budget")
    expect(client.applied).toHaveLength(0)
  })

  it("rejects cross-origin PATCH command batches", async () => {
    const client = makeClient()
    const handler = makeCritHttpHandler(client)
    const response = await Effect.runPromise(
      handler(
        new Request(canvasUrl, {
          method: "PATCH",
          headers: { Origin: "https://evil.example" },
          body: applyBody
        })
      )
    )
    expect(response?.status).toBe(403)
    expect(client.applied).toHaveLength(0)
  })

  it("rejects cross-origin snapshot capture", async () => {
    const client = makeClient()
    const handler = makeCritHttpHandler(client)
    const response = await Effect.runPromise(
      handler(
        new Request(snapshotUrl, {
          method: "POST",
          headers: { Origin: "https://evil.example" }
        })
      )
    )
    expect(response?.status).toBe(403)
    expect(client.snapshots).toHaveLength(0)
  })

  it("rejects snapshot capture from sandboxed documents (Origin: null)", async () => {
    const client = makeClient()
    const handler = makeCritHttpHandler(client)
    const response = await Effect.runPromise(
      handler(
        new Request(snapshotUrl, {
          method: "POST",
          headers: { Origin: "null" }
        })
      )
    )
    expect(response?.status).toBe(403)
    expect(client.snapshots).toHaveLength(0)
  })

  it("allows snapshot capture without an Origin header", async () => {
    const client = makeClient()
    const handler = makeCritHttpHandler(client)
    const response = await Effect.runPromise(
      handler(new Request(snapshotUrl, { method: "POST" }))
    )
    expect(response?.status).toBe(200)
    expect(client.snapshots).toEqual(["candidate"])
  })

  it("rejects AddSnapshotFrame on the public apply surface", async () => {
    const client = makeClient()
    const handler = makeCritHttpHandler(client)
    const response = await Effect.runPromise(
      handler(
        new Request(canvasUrl, {
          method: "PATCH",
          body: JSON.stringify({
            commands: [
              {
                _tag: "AddSnapshotFrame",
                id: "snapshot-forged",
                sourceFrameId: "candidate",
                expectedSourceUrl: "https://app.localhost/",
                url: "/__crit/snapshots/forged",
                artifact: {
                  artifactId: "forged",
                  sourceUrl: "https://app.localhost/",
                  capturedAt: "2026-01-01T00:00:00.000Z",
                  sizeBytes: 1
                }
              }
            ]
          })
        })
      )
    )
    expect(response?.status).toBe(400)
    const body = (await response?.json()) as {
      readonly error: { readonly message: string }
    }
    expect(body.error.message).toContain("AddSnapshotFrame")
    expect(client.applied).toHaveLength(0)
  })
})
