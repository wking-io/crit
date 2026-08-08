import { Effect, Schema } from "effect"

import {
  CanvasDocument,
  MAX_CANVAS_DOCUMENT_BYTES,
  type CanvasDocument as CanvasDocumentValue
} from "../core/index.js"
import {
  CritClientConflict,
  CritClientInvalidDocument,
  CritClientNotFound,
  CritClientUnavailable,
  type CritClientError,
  type CritClientShape
} from "../session/crit-client.js"

export const DEFAULT_CRIT_API_PATH = "/__crit/api"
export const MAX_CRIT_HTTP_BODY_BYTES = MAX_CANVAS_DOCUMENT_BYTES + 64_000

export const CritHttpSaveRequest = Schema.Struct({
  expectedRevision: Schema.Finite.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(0)
  ),
  document: CanvasDocument
})
export type CritHttpSaveRequest = typeof CritHttpSaveRequest.Type

export const CritHttpErrorCode = Schema.Union([
  Schema.Literal("not-found"),
  Schema.Literal("conflict"),
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
    expectedRevision: Schema.optional(Schema.Number),
    currentRevision: Schema.optional(Schema.Number)
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
    readonly expectedRevision?: number
    readonly currentRevision?: number
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
  if (cause instanceof CritClientConflict) {
    return json(
      409,
      errorBody("conflict", "Canvas revision conflict", {
        id: cause.id,
        expectedRevision: cause.expectedRevision,
        currentRevision: cause.currentRevision
      })
    )
  }
  if (cause instanceof CritClientInvalidDocument) {
    return json(
      422,
      errorBody("invalid-document", cause.detail, { id: cause.id })
    )
  }
  return json(
    503,
    errorBody("unavailable", cause.detail, { id: cause.id })
  )
}

const readSaveRequest = (request: Request, maxBodyBytes: number) =>
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
    Effect.flatMap(Schema.decodeUnknownEffect(CritHttpSaveRequest)),
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

    if (request.method === "PUT") {
      return readSaveRequest(request, maxBodyBytes).pipe(
        Effect.flatMap((input) =>
          input.document.id !== id
            ? Effect.fail(
                new Error(
                  `Canvas ID ${input.document.id} does not match request path ${id}`
                )
              )
            : client.save(input.document, input.expectedRevision)
        ),
        Effect.map((document) => json(200, document)),
        Effect.catch((cause) =>
          Effect.succeed(
            cause instanceof CritClientNotFound ||
              cause instanceof CritClientConflict ||
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
        errorBody("method-not-allowed", "Only GET and PUT are supported", {
          id
        }),
        { Allow: "GET, PUT" }
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

export const encodeSaveRequest = (
  document: CanvasDocumentValue,
  expectedRevision: number
): CritHttpSaveRequest => ({ document, expectedRevision })
