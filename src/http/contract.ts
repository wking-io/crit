import { Effect, Schema } from "effect"

import {
  Author,
  CanvasCommandSchema,
  CanvasDocument,
  MAX_CANVAS_DOCUMENT_BYTES
} from "../core/index.js"
import {
  CritClient,
  CritClientCommandFailed,
  CritClientErrorSchema,
  CritClientInvalidDocument,
  CritClientNotFound,
  CritClientUnavailable,
  type CritClientError
} from "../session/crit-client.js"
import { AgentActivityCollection } from "../runtime/agent-activity.js"

export const DEFAULT_CRIT_API_PATH = "/__crit/api"
export const MAX_CRIT_HTTP_BODY_BYTES = MAX_CANVAS_DOCUMENT_BYTES + 64_000

export const CritHttpApplyRequest = Schema.Struct({
  commands: Schema.Array(CanvasCommandSchema)
})
export type CritHttpApplyRequest = typeof CritHttpApplyRequest.Type

export const CritHttpErrorCode = Schema.Union([
  Schema.Literal("invalid-request"),
  Schema.Literal("method-not-allowed")
])
export type CritHttpErrorCode = typeof CritHttpErrorCode.Type

export const CritHttpErrorBody = Schema.Struct({
  error: Schema.Union([
    CritClientErrorSchema,
    Schema.Struct({
      code: CritHttpErrorCode,
      message: Schema.String,
      id: Schema.optional(Schema.String)
    })
  ])
})
export type CritHttpErrorBody = typeof CritHttpErrorBody.Type

export type CritHttpRoute =
  | { readonly _tag: "CurrentAuthor" }
  | { readonly _tag: "Canvas"; readonly id: string }
  | { readonly _tag: "CanvasActivity"; readonly id: string }
  | {
      readonly _tag: "FrameSnapshot"
      readonly id: string
      readonly frameId: string
    }
  | { readonly _tag: "Invalid" }

export type CritHttpHandler = (
  request: Request,
  route?: CritHttpRoute
) => Effect.Effect<Response | null>

export interface CritHttpHandlerOptions {
  readonly apiPath?: string
  readonly maxBodyBytes?: number
}

const stripTrailingSlash = (value: string) => value.replace(/\/+$/, "")

export const critCanvasUrl = (apiPath: string, canvasId: string) =>
  `${stripTrailingSlash(apiPath)}/canvases/${encodeURIComponent(canvasId)}`

export const critCurrentAuthorUrl = (apiPath: string) =>
  `${stripTrailingSlash(apiPath)}/identity`

export const critFrameSnapshotUrl = (
  apiPath: string,
  canvasId: string,
  frameId: string
) =>
  `${critCanvasUrl(apiPath, canvasId)}/frames/${encodeURIComponent(frameId)}/snapshot`

export const critCanvasActivityUrl = (apiPath: string, canvasId: string) =>
  `${critCanvasUrl(apiPath, canvasId)}/activity`

export const parseCritHttpRoute = (
  requestUrl: string | undefined,
  apiPath = DEFAULT_CRIT_API_PATH
): CritHttpRoute | undefined => {
  if (requestUrl === undefined) return undefined
  let pathname: string
  try {
    pathname = new URL(requestUrl, "http://crit.local").pathname
  } catch {
    return undefined
  }
  if (pathname === critCurrentAuthorUrl(apiPath)) {
    return { _tag: "CurrentAuthor" }
  }
  const prefix = `${stripTrailingSlash(apiPath)}/canvases/`
  if (!pathname.startsWith(prefix)) return undefined
  const segments = pathname.slice(prefix.length).split("/")
  if (segments[0]?.length === 0) return { _tag: "Invalid" }
  try {
    const id = decodeURIComponent(segments[0]!)
    if (segments.length === 1) return { _tag: "Canvas", id }
    if (segments.length === 2 && segments[1] === "activity") {
      return { _tag: "CanvasActivity", id }
    }
    if (
      segments.length === 4 &&
      segments[1] === "frames" &&
      segments[2]?.length !== 0 &&
      segments[3] === "snapshot"
    ) {
      return {
        _tag: "FrameSnapshot",
        id,
        frameId: decodeURIComponent(segments[2]!)
      }
    }
    return { _tag: "Invalid" }
  } catch {
    return { _tag: "Invalid" }
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

const encodeClientError = Schema.encodeSync(CritClientErrorSchema)

const errorBody = (
  code: CritHttpErrorCode,
  message: string,
  details: {
    readonly id?: string
  } = {}
): CritHttpErrorBody => ({
  error: { code, message, ...details }
})

const methodNotAllowed = (
  id: string,
  allowedMethods: ReadonlyArray<string>
) => {
  const methods = allowedMethods.length === 1
    ? allowedMethods[0]!
    : `${allowedMethods.slice(0, -1).join(", ")} and ${allowedMethods.at(-1)!}`
  return json(
    405,
    errorBody(
      "method-not-allowed",
      `Only ${methods} ${allowedMethods.length === 1 ? "is" : "are"} supported`,
      { id }
    ),
    { Allow: allowedMethods.join(", ") }
  )
}

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
    return json(404, { error: encodeClientError(cause) })
  }
  if (cause instanceof CritClientInvalidDocument) {
    return json(422, { error: encodeClientError(cause) })
  }
  if (cause instanceof CritClientCommandFailed) {
    return json(409, { error: encodeClientError(cause) })
  }
  return json(503, { error: encodeClientError(cause) })
}

class ApplyRequestBodyTooLarge extends Schema.TaggedError<ApplyRequestBodyTooLarge>()(
  "ApplyRequestBodyTooLarge",
  { maxBytes: Schema.Number }
) {}

class InvalidApplyRequest extends Schema.TaggedError<InvalidApplyRequest>()(
  "InvalidApplyRequest",
  { detail: Schema.String }
) {}

const readApplyRequest = (request: Request, maxBodyBytes: number) =>
  Effect.tryPromise({
    try: () => request.arrayBuffer(),
    catch: (cause) =>
      new InvalidApplyRequest({
        detail:
          cause instanceof Error ? cause.message : "Could not read request body"
      })
  }).pipe(
    Effect.flatMap((body) =>
      body.byteLength > maxBodyBytes
        ? Effect.fail(new ApplyRequestBodyTooLarge({ maxBytes: maxBodyBytes }))
        : Effect.succeed(new TextDecoder().decode(body))
    ),
    Effect.flatMap((body) =>
      Effect.try({
          try: () => JSON.parse(body),
        catch: () =>
          new InvalidApplyRequest({
            detail: "Request body must be valid JSON"
          })
      })
    ),
    Effect.flatMap((body) =>
      Schema.decodeUnknownEffect(CritHttpApplyRequest)(body).pipe(
        Effect.mapError(
          (cause) => new InvalidApplyRequest({ detail: String(cause) })
        )
      )
    )
  )

export const makeCritHttpHandler = (
  client: CritClient["Service"],
  options: CritHttpHandlerOptions = {}
): CritHttpHandler => {
  const apiPath = options.apiPath ?? DEFAULT_CRIT_API_PATH
  const maxBodyBytes = options.maxBodyBytes ?? MAX_CRIT_HTTP_BODY_BYTES

  return (request, parsedRoute) => {
    const route = parsedRoute ?? parseCritHttpRoute(request.url, apiPath)
    if (route === undefined) return Effect.succeed(null)
    if (route._tag === "Invalid") {
      return Effect.succeed(
        json(400, errorBody("invalid-request", "A Canvas ID is required"))
      )
    }

    if (route._tag === "CurrentAuthor") {
      if (request.method !== "GET") {
        return Effect.succeed(methodNotAllowed("current-author", ["GET"]))
      }
      return client.currentAuthor().pipe(
        Effect.map((author) => json(200, author)),
        Effect.catch((cause) => Effect.succeed(clientErrorResponse(cause)))
      )
    }
    const id = route.id

    if (route._tag === "CanvasActivity") {
      if (request.method !== "GET") {
        return Effect.succeed(methodNotAllowed(id, ["GET"]))
      }
      if (client.activities === undefined) {
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
      return client.activities(id).pipe(
        Effect.map((activities) => json(200, activities)),
        Effect.catch((cause) => Effect.succeed(clientErrorResponse(cause)))
      )
    }

    if (route._tag === "FrameSnapshot") {
      if (request.method !== "POST") {
        return Effect.succeed(methodNotAllowed(id, ["POST"]))
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
      return Effect.gen(function*() {
        const input = yield* readApplyRequest(request, maxBodyBytes)
        if (input.commands.length === 0) {
          return yield* new InvalidApplyRequest({
            detail: "At least one Canvas command is required"
          })
        }
        if (
          input.commands.some((command) => command._tag === "AddSnapshotFrame")
        ) {
          return yield* new InvalidApplyRequest({
            detail:
              "AddSnapshotFrame is reserved for snapshot capture; POST to the Frame snapshot route to archive an existing live Frame"
          })
        }
        return yield* client.apply(id, input.commands)
      }).pipe(
        Effect.map((document) => json(200, document)),
        Effect.catch((cause) =>
          Effect.succeed(
            cause instanceof CritClientNotFound ||
              cause instanceof CritClientCommandFailed ||
              cause instanceof CritClientInvalidDocument ||
              cause instanceof CritClientUnavailable
              ? clientErrorResponse(cause)
              : cause instanceof ApplyRequestBodyTooLarge
                ? json(
                    413,
                    errorBody(
                      "invalid-request",
                      `Request body exceeds ${cause.maxBytes} bytes`,
                      { id }
                    )
                  )
                : json(
                    400,
                    errorBody(
                      "invalid-request",
                      cause.detail,
                      { id }
                    )
                  )
          )
        )
      )
    }

    return Effect.succeed(methodNotAllowed(id, ["GET", "PATCH"]))
  }
}

export const decodeCanvasDocument = (input: unknown, id: string) =>
  Schema.decodeUnknownEffect(CanvasDocument)(input).pipe(
    Effect.mapError(
      (cause) =>
        new CritClientInvalidDocument({ id, detail: String(cause) })
    )
  )

export const decodeCurrentAuthor = (input: unknown) =>
  Schema.decodeUnknownEffect(Author)(input).pipe(
    Effect.mapError(
      (cause) =>
        new CritClientInvalidDocument({
          id: "current-author",
          detail: String(cause)
        })
    )
  )

export const decodeAgentActivities = (input: unknown, id: string) =>
  Schema.decodeUnknownEffect(AgentActivityCollection)(input).pipe(
    Effect.mapError(
      (cause) =>
        new CritClientInvalidDocument({ id, detail: String(cause) })
    )
  )

export const encodeApplyRequest = (
  commands: ReadonlyArray<typeof CanvasCommandSchema.Type>
): CritHttpApplyRequest => ({ commands: [...commands] })
