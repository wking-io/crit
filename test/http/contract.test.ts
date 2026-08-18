import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"

import { Canvas, CanvasCommand, DEVELOPMENT_FEATURES } from "../../src/core/index.js"
import { HttpCritClient } from "../../src/http/client.js"
import {
  makeCritHttpHandler,
  parseCritHttpRoute,
  type CritHttpServices
} from "../../src/http/contract.js"
import {
  CritClientCommandFailed,
  CritClient
} from "../../src/session/crit-client.js"
import { TEST_AUTHOR } from "../support/author-identity.js"

const document = Canvas.export(
  Canvas.create({ id: "homepage", title: "Homepage", owner: { id: "git:test", name: "Test Author" } })
)

const TestErrorBody = Schema.Struct({
  error: Schema.Struct({ message: Schema.String })
})

const makeServices = (): CritHttpServices & {
  readonly applied: Array<ReadonlyArray<unknown>>
  readonly capturedFrames: Array<string>
} => {
  const applied: Array<ReadonlyArray<unknown>> = []
  const capturedFrames: Array<string> = []
  return {
    applied,
    capturedFrames,
    client: {
      currentAuthor: () => Effect.succeed(TEST_AUTHOR),
      load: () => Effect.succeed(document),
      apply: (_id, commands) => {
        applied.push(commands)
        return Effect.succeed(document)
      }
    },
    snapshots: {
      snapshot: (_canvasId, frameId) => {
        capturedFrames.push(frameId)
        return Effect.succeed(document)
      }
    },
    activity: {
      activities: (canvasId) => Effect.succeed({
        schemaVersion: 1,
        canvasId,
        activities: []
      })
    }
  }
}

const canvasUrl = "http://localhost:5173/__crit/api/canvases/homepage"
const activityUrl = `${canvasUrl}/activity`
const snapshotUrl = `${canvasUrl}/frames/candidate/snapshot`

const applyBody = JSON.stringify({
  commands: [{ _tag: "SetFrameStatus", id: "candidate", status: "approved" }]
})

describe("parseCritHttpRoute", () => {
  it.each([
    [
      "/__crit/api/identity",
      { _tag: "CurrentAuthor" }
    ],
    [
      "/__crit/api/canvases/home%20page",
      { _tag: "Canvas", id: "home page" }
    ],
    [
      "/__crit/api/canvases/home%20page/activity",
      { _tag: "CanvasActivity", id: "home page" }
    ],
    [
      "/__crit/api/canvases/home%20page/frames/mobile%2Fwide/snapshot",
      { _tag: "FrameSnapshot", id: "home page", frameId: "mobile/wide" }
    ]
  ])("parses %s", (url, expected) => {
    expect(parseCritHttpRoute(url)).toEqual(expected)
  })

  it.each([
    "/__crit/api/canvases/",
    "/__crit/api/canvases/homepage/unknown",
    "/__crit/api/canvases/%invalid"
  ])("marks malformed contract routes invalid: %s", (url) => {
    expect(parseCritHttpRoute(url)).toEqual({ _tag: "Invalid" })
  })

  it("leaves requests outside the Canvas route space unclaimed", () => {
    expect(parseCritHttpRoute("/__crit/manifest.json")).toBeUndefined()
  })

  it("normalizes a trailing slash on a configured API path", () => {
    expect(
      parseCritHttpRoute("/custom/canvases/homepage", "/custom/")
    ).toEqual({ _tag: "Canvas", id: "homepage" })
  })
})

describe("makeCritHttpHandler", () => {
  it("serves Current Author through the shared client contract", async () => {
    const handler = makeCritHttpHandler(makeServices())
    const response = await Effect.runPromise(
      handler(new Request("http://localhost:5173/__crit/api/identity"))
    )
    expect(response?.status).toBe(200)
    expect(await response?.json()).toEqual(TEST_AUTHOR)
  })

  it("round-trips durable failures through HTTP without translating them", async () => {
    const services = makeServices()
    const client: CritClient["Service"] = {
      ...services.client,
      apply: () =>
        Effect.fail(
          new CritClientCommandFailed({
            id: "homepage",
            reason: "frame-not-found",
            detail: "Frame not found: candidate"
          })
        )
    }
    const handler = makeCritHttpHandler({ ...services, client })
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
        http.client.apply("homepage", [
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
    const client = makeServices()
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
    const client = makeServices()
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
    const client = makeServices()
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
    const body = Schema.decodeUnknownSync(TestErrorBody)(await response?.json())
    expect(body.error.message).toBe("Body stream exceeds transport budget")
    expect(client.applied).toHaveLength(0)
  })

  it("rejects cross-origin PATCH command batches", async () => {
    const client = makeServices()
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
    const client = makeServices()
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
    expect(client.capturedFrames).toHaveLength(0)
  })

  it("rejects snapshot capture from sandboxed documents (Origin: null)", async () => {
    const client = makeServices()
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
    expect(client.capturedFrames).toHaveLength(0)
  })

  it("allows snapshot capture without an Origin header", async () => {
    const client = makeServices()
    const handler = makeCritHttpHandler(client)
    const response = await Effect.runPromise(
      handler(new Request(snapshotUrl, { method: "POST" }))
    )
    expect(response?.status).toBe(200)
    expect(client.capturedFrames).toEqual(["candidate"])
  })

  it("returns unavailable responses for absent optional capabilities", async () => {
    const services = makeServices()
    const handler = makeCritHttpHandler({
      ...services,
      snapshots: null,
      activity: null
    })

    const activityResponse = await Effect.runPromise(
      handler(new Request(activityUrl))
    )
    const snapshotResponse = await Effect.runPromise(
      handler(new Request(snapshotUrl, { method: "POST" }))
    )

    expect(activityResponse?.status).toBe(503)
    expect(snapshotResponse?.status).toBe(503)
  })

  it("rejects AddSnapshotFrame on the public apply surface", async () => {
    const client = makeServices()
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
    const body = Schema.decodeUnknownSync(TestErrorBody)(await response?.json())
    expect(body.error.message).toContain("AddSnapshotFrame")
    expect(client.applied).toHaveLength(0)
  })

  it("rejects Comment commands when comments are disabled", async () => {
    const client = makeServices()
    const handler = makeCritHttpHandler(client)
    const response = await Effect.runPromise(
      handler(
        new Request(canvasUrl, {
          method: "PATCH",
          body: JSON.stringify({
            commands: [{
              _tag: "AddCommentThread",
              id: "thread-1",
              frameId: "candidate",
              anchor: { kind: "frame", xRatio: 0.5, yRatio: 0.5 },
              opening: {
                id: "comment-1",
                body: "Check this state",
                author: TEST_AUTHOR,
                createdAt: "2026-08-09T12:00:00.000Z",
                editedAt: null
              }
            }]
          })
        })
      )
    )
    expect(response?.status).toBe(400)
    const body = Schema.decodeUnknownSync(TestErrorBody)(await response?.json())
    expect(body.error.message).toContain("unavailable")
    expect(client.applied).toHaveLength(0)
  })

  it("accepts Comment commands when comments are enabled", async () => {
    const client = makeServices()
    const handler = makeCritHttpHandler(client, {
      features: { comments: true }
    })
    const commands = [{
      _tag: "AddCommentThread" as const,
      id: "thread-1",
      frameId: "candidate",
      anchor: { kind: "frame" as const, xRatio: 0.5, yRatio: 0.5 },
      opening: {
        id: "comment-1",
        body: "Check this state",
        author: TEST_AUTHOR,
        createdAt: "2026-08-09T12:00:00.000Z",
        editedAt: null
      }
    }]
    const response = await Effect.runPromise(
      handler(
        new Request(canvasUrl, {
          method: "PATCH",
          body: JSON.stringify({ commands })
        })
      )
    )
    expect(response?.status).toBe(200)
    expect(client.applied).toEqual([commands])
  })

  it("resolves Comment availability from a per-request feature policy", async () => {
    const client = makeServices()
    const handler = makeCritHttpHandler(client, {
      featuresForRequest: (request) => request.headers.get("cookie") === "comments=on"
        ? DEVELOPMENT_FEATURES
        : { comments: false }
    })
    const commands = [{
      _tag: "AddCommentThread" as const,
      id: "thread-1",
      frameId: "candidate",
      anchor: { kind: "frame" as const, xRatio: 0.5, yRatio: 0.5 },
      opening: {
        id: "comment-1",
        body: "Check this state",
        author: TEST_AUTHOR,
        createdAt: "2026-08-09T12:00:00.000Z",
        editedAt: null
      }
    }]
    const denied = await Effect.runPromise(
      handler(
        new Request(canvasUrl, {
          method: "PATCH",
          body: JSON.stringify({ commands })
        })
      )
    )
    expect(denied?.status).toBe(400)
    expect(client.applied).toHaveLength(0)

    const allowed = await Effect.runPromise(
      handler(
        new Request(canvasUrl, {
          method: "PATCH",
          headers: { cookie: "comments=on" },
          body: JSON.stringify({ commands })
        })
      )
    )
    expect(allowed?.status).toBe(200)
    expect(client.applied).toEqual([commands])
  })
})
