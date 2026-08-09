import { Effect, Schema } from "effect"

import {
  Canvas,
  CanvasAlreadyExists,
  CanvasCommandFailed,
  CanvasDocumentTooLarge,
  CanvasInvalidDocument,
  CanvasNotFound,
  CanvasUnavailable,
  CanvasCommandSchema,
  MAX_CANVAS_DOCUMENT_BYTES
} from "../core/index.js"
import type { CritClientShape } from "../session/crit-client.js"
import { AgentActivityStatus } from "../runtime/agent-activity.js"
import {
  SnapshotCaptureFailed,
  SnapshotStorageFailed
} from "../runtime/snapshot-archive.js"

export const DEFAULT_CRIT_API_PATH = "/__crit/api"
export const MAX_CRIT_HTTP_BODY_BYTES = MAX_CANVAS_DOCUMENT_BYTES + 64_000

export const CritHttpApplyRequest = Schema.Struct({
  commands: Schema.Array(CanvasCommandSchema)
})
export type CritHttpApplyRequest = typeof CritHttpApplyRequest.Type

// A transport-level rejection: the request never reached the Canvas domain.
// Owned by the HTTP contract — core has no business knowing about origins or
// request bodies — and composed into the transportable error union below.
export class RequestRejected extends Schema.TaggedError<RequestRejected>()(
  "RequestRejected",
  {
    reason: Schema.Union([
      Schema.Literal("invalid-body"),
      Schema.Literal("missing-canvas-id"),
      Schema.Literal("cross-origin"),
      Schema.Literal("body-too-large"),
      Schema.Literal("method-not-allowed")
    ]),
    detail: Schema.String
  }
) {
  override get message(): string {
    return this.detail
  }
}

// Everything a Crit HTTP error body can carry: the core Canvas failure
// vocabulary, the snapshot archive's capture failures, and transport
// rejections. One schema derives both directions of the wire codec.
export const CritHttpErrorSchema = Schema.Union([
  CanvasNotFound,
  CanvasAlreadyExists,
  CanvasInvalidDocument,
  CanvasCommandFailed,
  CanvasDocumentTooLarge,
  CanvasUnavailable,
  SnapshotCaptureFailed,
  SnapshotStorageFailed,
  RequestRejected
])
export type CritHttpError = typeof CritHttpErrorSchema.Type

export const CritHttpErrorBody = Schema.Struct({
  error: CritHttpErrorSchema
})
export type CritHttpErrorBody = typeof CritHttpErrorBody.Type

export type CritHttpHandler = (
  request: Request
) => Effect.Effect<Response | null>

export interface CritHttpHandlerOptions {
  readonly apiPath?: string
  readonly maxBodyBytes?: number
}

const stripTrailingSlash = (value: string) => value.replace(/\/+$/, "")

export const critCanvasUrl = (apiPath: string, canvasId: string) =>
  `${stripTrailingSlash(apiPath)}/canvases/${encodeURIComponent(canvasId)}`

export const critFrameSnapshotUrl = (
  apiPath: string,
  canvasId: string,
  frameId: string
) =>
  `${critCanvasUrl(apiPath, canvasId)}/frames/${encodeURIComponent(frameId)}/snapshot`

export const critCanvasActivityUrl = (apiPath: string, canvasId: string) =>
  `${critCanvasUrl(apiPath, canvasId)}/activity`

const pathnameFor = (request: Request) => {
  try {
    return new URL(request.url).pathname
  } catch {
    return ""
  }
}

export const isCritHttpRequest = (
  requestUrl: string | undefined,
  apiPath = DEFAULT_CRIT_API_PATH
) => {
  if (requestUrl === undefined) return false
  try {
    const pathname = new URL(requestUrl, "http://crit.local").pathname
    const prefix = `${stripTrailingSlash(apiPath)}/canvases/`
    return pathname.startsWith(prefix)
  } catch {
    return false
  }
}

const json = (status: number, body: unknown, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      ...headers
    }
  })

// The one table mapping the transportable error union to HTTP statuses.
const statusFor = (error: CritHttpError): number => {
  switch (error._tag) {
    case "CanvasNotFound":
      return 404
    case "CanvasAlreadyExists":
    case "CanvasCommandFailed":
      return 409
    case "CanvasDocumentTooLarge":
      return 413
    case "CanvasInvalidDocument":
      return 422
    case "CanvasUnavailable":
    case "SnapshotCaptureFailed":
    case "SnapshotStorageFailed":
      return 503
    case "RequestRejected":
      switch (error.reason) {
        case "cross-origin":
          return 403
        case "body-too-large":
          return 413
        case "method-not-allowed":
          return 405
        default:
          return 400
      }
  }
}

const errorResponse = (error: CritHttpError, headers?: HeadersInit) =>
  json(
    statusFor(error),
    {
      error: {
        ...(Schema.encodeSync(CritHttpErrorSchema)(error) as object),
        message: error.message
      }
    },
    headers
  )

// Mutating routes are reachable by simple cross-origin requests (form POSTs
// and preflight-free fetches), so a foreign Origin must be rejected. Requests
// without an Origin header (CLI, curl, same-origin navigations) pass. Hosts are
// compared instead of full origins because the dev server may sit behind a
// TLS-terminating proxy that rewrites the protocol.
const crossOriginRejection = (request: Request) => {
  const origin = request.headers.get("origin")
  if (origin === null) return undefined
  try {
    if (new URL(origin).host === new URL(request.url).host) return undefined
  } catch {
    // An unparsable Origin (including the literal "null" sent by sandboxed
    // documents) is never same-origin.
  }
  return errorResponse(
    new RequestRejected({
      reason: "cross-origin",
      detail: "Cross-origin Canvas mutations are not allowed"
    })
  )
}

const readApplyRequest = (
  request: Request,
  maxBodyBytes: number
): Effect.Effect<CritHttpApplyRequest, RequestRejected> =>
  Effect.tryPromise({
    try: () => request.arrayBuffer(),
    catch: (cause) =>
      new RequestRejected({
        reason: "invalid-body",
        detail:
          cause instanceof Error ? cause.message : "Could not read request body"
      })
  }).pipe(
    Effect.flatMap((body) =>
      body.byteLength > maxBodyBytes
        ? Effect.fail(
            new RequestRejected({
              reason: "body-too-large",
              detail: `Request body exceeds ${maxBodyBytes} bytes`
            })
          )
        : Effect.succeed(new TextDecoder().decode(body))
    ),
    Effect.flatMap((body) =>
      Effect.try({
        try: () => JSON.parse(body) as unknown,
        catch: () =>
          new RequestRejected({
            reason: "invalid-body",
            detail: "Request body must be valid JSON"
          })
      })
    ),
    Effect.flatMap((input) =>
      Schema.decodeUnknownEffect(CritHttpApplyRequest)(input).pipe(
        Effect.mapError(
          (cause) =>
            new RequestRejected({
              reason: "invalid-body",
              detail: String(cause)
            })
        )
      )
    )
  )

const canvasRouteFrom = (request: Request, apiPath: string) => {
  const prefix = `${stripTrailingSlash(apiPath)}/canvases/`
  const pathname = pathnameFor(request)
  if (!pathname.startsWith(prefix)) return undefined
  const segments = pathname.slice(prefix.length).split("/")
  if (segments[0]?.length === 0) return { id: "" }
  try {
    const id = decodeURIComponent(segments[0]!)
    if (segments.length === 1) return { id }
    if (segments.length === 2 && segments[1] === "activity") {
      return { id, activity: true as const }
    }
    if (
      segments.length === 4 &&
      segments[1] === "frames" &&
      segments[2]?.length !== 0 &&
      segments[3] === "snapshot"
    ) {
      return { id, frameId: decodeURIComponent(segments[2]!) }
    }
    return { id: "" }
  } catch {
    return { id: "" }
  }
}

export const makeCritHttpHandler = (
  client: CritClientShape,
  options: CritHttpHandlerOptions = {}
): CritHttpHandler => {
  const apiPath = options.apiPath ?? DEFAULT_CRIT_API_PATH
  const maxBodyBytes = options.maxBodyBytes ?? MAX_CRIT_HTTP_BODY_BYTES

  return (request) => {
    const route = canvasRouteFrom(request, apiPath)
    if (route === undefined) return Effect.succeed(null)
    if (route.id.length === 0) {
      return Effect.succeed(
        errorResponse(
          new RequestRejected({
            reason: "missing-canvas-id",
            detail: "A Canvas ID is required"
          })
        )
      )
    }
    const id = route.id

    if (route.activity === true) {
      if (request.method !== "GET") {
        return Effect.succeed(
          errorResponse(
            new RequestRejected({
              reason: "method-not-allowed",
              detail: "Only GET is supported"
            }),
            { Allow: "GET" }
          )
        )
      }
      if (client.activity === undefined) {
        return Effect.succeed(
          errorResponse(
            new CanvasUnavailable({
              operation: "activity",
              canvasId: id,
              detail: "Agent activity is unavailable"
            })
          )
        )
      }
      return client.activity(id).pipe(
        Effect.map((activity) => json(200, activity)),
        Effect.catch((cause) => Effect.succeed(errorResponse(cause)))
      )
    }

    if (route.frameId !== undefined) {
      if (request.method !== "POST") {
        return Effect.succeed(
          errorResponse(
            new RequestRejected({
              reason: "method-not-allowed",
              detail: "Only POST is supported"
            }),
            { Allow: "POST" }
          )
        )
      }
      const rejected = crossOriginRejection(request)
      if (rejected !== undefined) return Effect.succeed(rejected)
      if (client.snapshot === undefined) {
        return Effect.succeed(
          errorResponse(
            new CanvasUnavailable({
              operation: "snapshot",
              canvasId: id,
              detail: "Snapshot capture is unavailable"
            })
          )
        )
      }
      return client.snapshot(id, route.frameId).pipe(
        Effect.map((document) => json(200, document)),
        Effect.catch((cause) => Effect.succeed(errorResponse(cause)))
      )
    }

    if (request.method === "GET") {
      return client.load(id).pipe(
        Effect.map((document) => json(200, document)),
        Effect.catch((cause) => Effect.succeed(errorResponse(cause)))
      )
    }

    if (request.method === "PATCH") {
      const rejected = crossOriginRejection(request)
      if (rejected !== undefined) return Effect.succeed(rejected)
      return readApplyRequest(request, maxBodyBytes).pipe(
        Effect.flatMap(
          (input): Effect.Effect<unknown, CritHttpError> =>
            input.commands.some(
              (command) => command._tag === "AddSnapshotFrame"
            )
              ? Effect.fail(
                  new RequestRejected({
                    reason: "invalid-body",
                    detail:
                      "AddSnapshotFrame is reserved for snapshot capture; POST to the Frame snapshot route to archive an existing live Frame"
                  })
                )
              : client.apply(id, input.commands)
        ),
        Effect.map((document) => json(200, document)),
        Effect.catch((cause) => Effect.succeed(errorResponse(cause)))
      )
    }

    return Effect.succeed(
      errorResponse(
        new RequestRejected({
          reason: "method-not-allowed",
          detail: "Only GET and PATCH are supported"
        }),
        { Allow: "GET, PATCH" }
      )
    )
  }
}

// The HTTP client's trust edge: documents from the wire must pass the full
// Canvas invariant validation (not just the schema) so downstream consumers
// can re-open them with Canvas.fromDocument without handling failures.
export const decodeCanvasDocument = (input: unknown, id: string) =>
  Canvas.open(id, input).pipe(Effect.map(Canvas.export))

export const decodeAgentActivity = (input: unknown, id: string) =>
  Schema.decodeUnknownEffect(AgentActivityStatus)(input).pipe(
    Effect.mapError(
      (cause) =>
        new CanvasInvalidDocument({ canvasId: id, detail: String(cause) })
    )
  )

export const encodeApplyRequest = (
  commands: ReadonlyArray<typeof CanvasCommandSchema.Type>
): CritHttpApplyRequest => ({ commands: [...commands] })
