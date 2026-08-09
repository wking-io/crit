import { Effect, Schema } from "effect"

import {
  CanvasCommandSchema,
  CanvasDocument,
  MAX_CANVAS_DOCUMENT_BYTES
} from "../core/index.js"
import {
  CritClientCommandFailed,
  CritClientInvalidDocument,
  CritClientNotFound,
  CritClientUnavailable,
  type CritClientError,
  type CritClientShape
} from "../session/crit-client.js"
import { AgentActivityStatus } from "../runtime/agent-activity.js"

export const DEFAULT_CRIT_API_PATH = "/__crit/api"
export const MAX_CRIT_HTTP_BODY_BYTES = MAX_CANVAS_DOCUMENT_BYTES + 64_000

export const CritHttpApplyRequest = Schema.Struct({
  commands: Schema.Array(CanvasCommandSchema)
})
export type CritHttpApplyRequest = typeof CritHttpApplyRequest.Type

export const CritHttpErrorCode = Schema.Union([
  Schema.Literal("not-found"),
  Schema.Literal("command-rejected"),
  Schema.Literal("invalid-document"),
  Schema.Literal("unavailable"),
  Schema.Literal("invalid-request"),
  Schema.Literal("method-not-allowed")
])
export type CritHttpErrorCode = typeof CritHttpErrorCode.Type

export const CritHttpErrorBody = Schema.Struct({
  error: Schema.Struct({
    code: CritHttpErrorCode,
    message: Schema.String,
    id: Schema.optional(Schema.String),
    reason: Schema.optional(Schema.String)
  })
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

const errorBody = (
  code: CritHttpErrorCode,
  message: string,
  details: {
    readonly id?: string
    readonly reason?: string
  } = {}
): CritHttpErrorBody => ({
  error: { code, message, ...details }
})

// Mutating routes are reachable by simple cross-origin requests (form POSTs
// and preflight-free fetches), so a foreign Origin must be rejected. Requests
// without an Origin header (CLI, curl, same-origin navigations) pass. Hosts are
// compared instead of full origins because the dev server may sit behind a
// TLS-terminating proxy that rewrites the protocol.
const crossOriginRejection = (request: Request, id: string) => {
  const origin = request.headers.get("origin")
  if (origin === null) return undefined
  try {
    if (new URL(origin).host === new URL(request.url).host) return undefined
  } catch {
    // An unparsable Origin (including the literal "null" sent by sandboxed
    // documents) is never same-origin.
  }
  return json(
    403,
    errorBody(
      "invalid-request",
      "Cross-origin Canvas mutations are not allowed",
      { id }
    )
  )
}

const clientErrorResponse = (cause: CritClientError) => {
  if (cause instanceof CritClientNotFound) {
    return json(
      404,
      errorBody("not-found", `Canvas not found: ${cause.id}`, { id: cause.id })
    )
  }
  if (cause instanceof CritClientInvalidDocument) {
    return json(
      422,
      errorBody("invalid-document", cause.detail, { id: cause.id })
    )
  }
  if (cause instanceof CritClientCommandFailed) {
    return json(
      409,
      errorBody("command-rejected", cause.detail, {
        id: cause.id,
        reason: cause.reason
      })
    )
  }
  return json(
    503,
    errorBody("unavailable", cause.detail, { id: cause.id })
  )
}

const readApplyRequest = (request: Request, maxBodyBytes: number) =>
  Effect.tryPromise({
    try: () => request.arrayBuffer(),
    catch: (cause) =>
      new Error(
        cause instanceof Error ? cause.message : "Could not read request body"
      )
  }).pipe(
    Effect.flatMap((body) =>
      body.byteLength > maxBodyBytes
        ? Effect.fail(new Error(`Request body exceeds ${maxBodyBytes} bytes`))
        : Effect.succeed(new TextDecoder().decode(body))
    ),
    Effect.flatMap((body) =>
      Effect.try({
        try: () => JSON.parse(body) as unknown,
        catch: () => new Error("Request body must be valid JSON")
      })
    ),
    Effect.flatMap(Schema.decodeUnknownEffect(CritHttpApplyRequest)),
    Effect.mapError((cause) =>
      cause instanceof Error ? cause : new Error(String(cause))
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
        json(400, errorBody("invalid-request", "A Canvas ID is required"))
      )
    }
    const id = route.id

    if (route.activity === true) {
      if (request.method !== "GET") {
        return Effect.succeed(
          json(
            405,
            errorBody("method-not-allowed", "Only GET is supported", { id }),
            { Allow: "GET" }
          )
        )
      }
      if (client.activity === undefined) {
        return Effect.succeed(
          clientErrorResponse(
            new CritClientUnavailable({
              operation: "activity",
              id,
              detail: "Agent activity is unavailable"
            })
          )
        )
      }
      return client.activity(id).pipe(
        Effect.map((activity) => json(200, activity)),
        Effect.catch((cause) => Effect.succeed(clientErrorResponse(cause)))
      )
    }

    if (route.frameId !== undefined) {
      if (request.method !== "POST") {
        return Effect.succeed(
          json(
            405,
            errorBody("method-not-allowed", "Only POST is supported", { id }),
            { Allow: "POST" }
          )
        )
      }
      const rejected = crossOriginRejection(request, id)
      if (rejected !== undefined) return Effect.succeed(rejected)
      if (client.snapshot === undefined) {
        return Effect.succeed(
          clientErrorResponse(
            new CritClientUnavailable({
              operation: "snapshot",
              id,
              detail: "Snapshot capture is unavailable"
            })
          )
        )
      }
      return client.snapshot(id, route.frameId).pipe(
        Effect.map((document) => json(200, document)),
        Effect.catch((cause) => Effect.succeed(clientErrorResponse(cause)))
      )
    }

    if (request.method === "GET") {
      return client.load(id).pipe(
        Effect.map((document) => json(200, document)),
        Effect.catch((cause) => Effect.succeed(clientErrorResponse(cause)))
      )
    }

    if (request.method === "PATCH") {
      const rejected = crossOriginRejection(request, id)
      if (rejected !== undefined) return Effect.succeed(rejected)
      return readApplyRequest(request, maxBodyBytes).pipe(
        Effect.flatMap((input) =>
          input.commands.length === 0
            ? Effect.fail(new Error("At least one Canvas command is required"))
            : input.commands.some(
                  (command) => command._tag === "AddSnapshotFrame"
                )
              ? Effect.fail(
                  new Error(
                    "AddSnapshotFrame is reserved for snapshot capture; POST to the Frame snapshot route to archive an existing live Frame"
                  )
                )
              : client.apply(id, input.commands)
        ),
        Effect.map((document) => json(200, document)),
        Effect.catch((cause) =>
          Effect.succeed(
            cause instanceof CritClientNotFound ||
              cause instanceof CritClientCommandFailed ||
              cause instanceof CritClientInvalidDocument ||
              cause instanceof CritClientUnavailable
              ? clientErrorResponse(cause)
              : json(
                  cause instanceof Error && cause.message.includes("exceeds")
                    ? 413
                    : 400,
                  errorBody(
                    "invalid-request",
                    cause instanceof Error ? cause.message : String(cause),
                    { id }
                  )
                )
          )
        )
      )
    }

    return Effect.succeed(
      json(
        405,
        errorBody("method-not-allowed", "Only GET and PATCH are supported", {
          id
        }),
        { Allow: "GET, PATCH" }
      )
    )
  }
}

export const decodeCanvasDocument = (input: unknown, id: string) =>
  Schema.decodeUnknownEffect(CanvasDocument)(input).pipe(
    Effect.mapError(
      (cause) =>
        new CritClientInvalidDocument({ id, detail: String(cause) })
    )
  )

export const decodeAgentActivity = (input: unknown, id: string) =>
  Schema.decodeUnknownEffect(AgentActivityStatus)(input).pipe(
    Effect.mapError(
      (cause) =>
        new CritClientInvalidDocument({ id, detail: String(cause) })
    )
  )

export const encodeApplyRequest = (
  commands: ReadonlyArray<typeof CanvasCommandSchema.Type>
): CritHttpApplyRequest => ({ commands: [...commands] })
