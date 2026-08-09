import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"

import {
  Canvas,
  CanvasAlreadyExists,
  CanvasCommandFailed,
  CanvasDocumentTooLarge,
  CanvasInvalidDocument,
  CanvasNotFound,
  CanvasUnavailable,
  type CanvasError
} from "../../src/core/index.js"
import {
  SnapshotCaptureFailed,
  SnapshotStorageFailed
} from "../../src/runtime/snapshot-archive.js"
import { HttpCritClient } from "../../src/http/client.js"
import {
  CritHttpErrorBody,
  CritHttpErrorSchema,
  RequestRejected,
  makeCritHttpHandler,
  type CritHttpError
} from "../../src/http/contract.js"
import type { CritClientShape } from "../../src/session/crit-client.js"

const canvasErrors: ReadonlyArray<CanvasError> = [
  new CanvasNotFound({ canvasId: "homepage" }),
  new CanvasAlreadyExists({ canvasId: "homepage", currentRevision: 7 }),
  new CanvasInvalidDocument({
    canvasId: "homepage",
    detail: "Duplicate Canvas item ID: candidate"
  }),
  new CanvasCommandFailed({
    canvasId: "homepage",
    reason: "note-conflict",
    detail: "Note changed since revision 3"
  }),
  new CanvasDocumentTooLarge({
    canvasId: "homepage",
    actualBytes: 10_000_001,
    maxBytes: 10_000_000
  }),
  new CanvasUnavailable({
    canvasId: "homepage",
    operation: "apply",
    detail: "EACCES: permission denied"
  })
]

const snapshotErrors = [
  new SnapshotCaptureFailed({
    sourceUrl: "https://app.localhost/",
    detail: "Fetch timed out"
  }),
  new SnapshotStorageFailed({
    operation: "write",
    artifactId: "abc123",
    detail: "Disk full"
  })
] as const

const transportErrors = [
  new RequestRejected({
    reason: "cross-origin",
    detail: "Cross-origin Canvas mutations are not allowed"
  })
] as const

const allErrors: ReadonlyArray<CritHttpError> = [
  ...canvasErrors,
  ...snapshotErrors,
  ...transportErrors
]

const expectedStatus: Record<string, number> = {
  CanvasNotFound: 404,
  CanvasAlreadyExists: 409,
  CanvasCommandFailed: 409,
  CanvasInvalidDocument: 422,
  CanvasDocumentTooLarge: 413,
  CanvasUnavailable: 503,
  SnapshotCaptureFailed: 503,
  SnapshotStorageFailed: 503
}

const canvasUrl = "http://localhost:5173/__crit/api/canvases/homepage"
const snapshotUrl = `${canvasUrl}/frames/candidate/snapshot`

// A fetch backed directly by the HTTP handler, so client tests exercise the
// real wire format end to end.
const fetchVia = (
  handler: ReturnType<typeof makeCritHttpHandler>,
  headers?: HeadersInit
): typeof globalThis.fetch =>
  (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, { ...init, headers: { ...init?.headers as Record<string, string>, ...headers as Record<string, string> } })
    const response = await Effect.runPromise(handler(request))
    if (response === null) throw new Error("Handler did not match the request")
    return response
  }) as typeof globalThis.fetch

describe("Crit HTTP error codec", () => {
  it("round-trips every member of the wire union through the body schema", () => {
    for (const error of allErrors) {
      const encoded = {
        error: {
          ...(Schema.encodeSync(CritHttpErrorSchema)(error) as object),
          message: error.message
        }
      }
      const wire = JSON.parse(JSON.stringify(encoded)) as unknown
      const decoded = Schema.decodeUnknownSync(CritHttpErrorBody)(wire)
      expect(decoded.error).toBeInstanceOf(error.constructor)
      expect(Schema.encodeSync(CritHttpErrorSchema)(decoded.error)).toEqual(
        Schema.encodeSync(CritHttpErrorSchema)(error)
      )
    }
  })

  it("maps every Canvas failure to its HTTP status", async () => {
    for (const error of canvasErrors) {
      const failing: CritClientShape = {
        load: () => Effect.fail(error),
        apply: () => Effect.fail(error)
      }
      const handler = makeCritHttpHandler(failing)
      const response = await Effect.runPromise(handler(new Request(canvasUrl)))
      expect(response?.status).toBe(expectedStatus[error._tag])
      const body = (await response?.json()) as {
        error: { _tag: string; canvasId: string; message: string }
      }
      expect(body.error._tag).toBe(error._tag)
      expect(body.error.canvasId).toBe("homepage")
      expect(body.error.message).toBe(error.message)
    }
  })

  it("maps snapshot capture failures to their HTTP status", async () => {
    for (const error of snapshotErrors) {
      const failing: CritClientShape = {
        load: () => Effect.die("unused"),
        apply: () => Effect.die("unused"),
        snapshot: () => Effect.fail(error)
      }
      const handler = makeCritHttpHandler(failing)
      const response = await Effect.runPromise(
        handler(new Request(snapshotUrl, { method: "POST" }))
      )
      expect(response?.status).toBe(expectedStatus[error._tag])
      const body = (await response?.json()) as { error: { _tag: string } }
      expect(body.error._tag).toBe(error._tag)
    }
  })

  it("returns domain failures to the HTTP client as themselves", async () => {
    for (const error of canvasErrors) {
      const failing: CritClientShape = {
        load: () => Effect.fail(error),
        apply: () => Effect.fail(error)
      }
      const client = HttpCritClient.make({
        apiPath: "http://localhost:5173/__crit/api",
        fetch: fetchVia(makeCritHttpHandler(failing))
      })
      const received = await Effect.runPromise(Effect.flip(client.load("homepage")))
      expect(received).toBeInstanceOf(error.constructor)
      expect(received).toMatchObject({ _tag: error._tag, canvasId: "homepage" })
      expect(received.message).toBe(error.message)
    }
  })

  it("returns snapshot capture failures to the HTTP client as themselves", async () => {
    const error = snapshotErrors[0]
    const failing: CritClientShape = {
      load: () => Effect.die("unused"),
      apply: () => Effect.die("unused"),
      snapshot: () => Effect.fail(error)
    }
    const client = HttpCritClient.make({
      apiPath: "http://localhost:5173/__crit/api",
      fetch: fetchVia(makeCritHttpHandler(failing))
    })
    const received = await Effect.runPromise(
      Effect.flip(client.snapshot!("homepage", "candidate"))
    )
    expect(received).toBeInstanceOf(SnapshotCaptureFailed)
    expect(received).toMatchObject({ sourceUrl: "https://app.localhost/" })
  })

  it("surfaces transport rejections to the HTTP client as CanvasUnavailable", async () => {
    const succeeding: CritClientShape = {
      load: () => Effect.die("unreachable"),
      apply: () => Effect.die("unreachable")
    }
    const client = HttpCritClient.make({
      apiPath: "http://localhost:5173/__crit/api",
      // Every request arrives with a foreign Origin, so mutations are
      // rejected at the transport layer before reaching the domain.
      fetch: fetchVia(makeCritHttpHandler(succeeding), {
        Origin: "https://evil.example"
      })
    })
    const received = await Effect.runPromise(
      Effect.flip(client.apply("homepage", [
        { _tag: "SetFrameStatus", id: "candidate", status: "approved" }
      ]))
    )
    expect(received).toBeInstanceOf(CanvasUnavailable)
    expect(received).toMatchObject({
      _tag: "CanvasUnavailable",
      canvasId: "homepage",
      operation: "apply"
    })
    expect(received.message).toContain("Cross-origin")
  })
})
