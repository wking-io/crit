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

const canvasIdFrom = (request: Request, apiPath: string) => {
  const prefix = `${stripTrailingSlash(apiPath)}/canvases/`
  const pathname = pathnameFor(request)
  if (!pathname.startsWith(prefix)) return undefined
  const encoded = pathname.slice(prefix.length)
  if (encoded.length === 0 || encoded.includes("/")) return ""
  try {
    return decodeURIComponent(encoded)
  } catch {
    return ""
  }
}

export const makeCritHttpHandler = (
  client: CritClientShape,
  options: CritHttpHandlerOptions = {}
): CritHttpHandler => {
  const apiPath = options.apiPath ?? DEFAULT_CRIT_API_PATH
  const maxBodyBytes = options.maxBodyBytes ?? MAX_CRIT_HTTP_BODY_BYTES

  return (request) => {
    const id = canvasIdFrom(request, apiPath)
    if (id === undefined) return Effect.succeed(null)
    if (id.length === 0) {
      return Effect.succeed(
        json(400, errorBody("invalid-request", "A Canvas ID is required"))
      )
    }

    if (request.method === "GET") {
      return client.load(id).pipe(
        Effect.map((document) => json(200, document)),
        Effect.catch((cause) => Effect.succeed(clientErrorResponse(cause)))
      )
    }

    if (request.method === "PATCH") {
      return readApplyRequest(request, maxBodyBytes).pipe(
        Effect.flatMap((input) =>
          input.commands.length === 0
            ? Effect.fail(new Error("At least one Canvas command is required"))
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

export const encodeApplyRequest = (
  commands: ReadonlyArray<typeof CanvasCommandSchema.Type>
): CritHttpApplyRequest => ({ commands: [...commands] })
