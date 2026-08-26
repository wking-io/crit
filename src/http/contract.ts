import { Context, Effect, Layer, Match, Schema } from "effect"
import { causeMessage } from "../internal/cause-message.js"

import {
  Author,
  CanvasCommandSchema,
  CanvasDocument,
  DEFAULT_CRIT_FEATURES,
  MAX_CANVAS_DOCUMENT_BYTES,
  unavailableCommentCommandDetail,
  type CritFeatures
} from "../core/index.js"
import {
  CritClientErrorSchema,
  CritClientInvalidDocument,
  CritClientUnavailable,
  type CritClientServices,
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
  readonly features?: CritFeatures
  readonly featuresForRequest?: (request: Request) => CritFeatures
}

export type CritHttpServices = CritClientServices

type CritHttpErrorResponse = typeof CritHttpErrorBody.Encoded
type CritHttpResponseBody =
  | typeof Author.Type
  | typeof CanvasDocument.Type
  | typeof AgentActivityCollection.Type
  | CritHttpErrorResponse

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

const json = (
  status: number,
  body: CritHttpResponseBody,
  headers?: HeadersInit
) =>
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
): CritHttpErrorResponse => ({
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
  const response = (status: number) =>
    json(status, { error: encodeClientError(cause) })
  return Match.valueTags(cause, {
    CritClientNotFound: () => response(404),
    CritClientInvalidDocument: () => response(422),
    CritClientCommandFailed: () => response(409),
    CritClientUnavailable: () => response(503)
  })
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
          causeMessage(cause, "Could not read request body")
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
  services: CritHttpServices,
  options: CritHttpHandlerOptions = {}
): CritHttpHandler => {
  const apiPath = options.apiPath ?? DEFAULT_CRIT_API_PATH
  const maxBodyBytes = options.maxBodyBytes ?? MAX_CRIT_HTTP_BODY_BYTES
  const featuresForRequest = options.featuresForRequest
  const resolveFeatures = (request: Request): CritFeatures =>
    featuresForRequest === undefined
      ? options.features ?? DEFAULT_CRIT_FEATURES
      : featuresForRequest(request)
  const { activity, client, snapshots } = services

  const handleCurrentAuthor = (request: Request) => {
    if (request.method !== "GET") {
      return Effect.succeed(methodNotAllowed("current-author", ["GET"]))
    }
    return client.currentAuthor().pipe(
      Effect.map((author) => json(200, author)),
      Effect.catch((cause) => Effect.succeed(clientErrorResponse(cause)))
    )
  }

  const handleActivity = (
    request: Request,
    route: Extract<CritHttpRoute, { readonly _tag: "CanvasActivity" }>
  ) => {
    if (request.method !== "GET") {
      return Effect.succeed(methodNotAllowed(route.id, ["GET"]))
    }
    if (activity === null) {
      return Effect.succeed(
        clientErrorResponse(
          new CritClientUnavailable({
            operation: "activity",
            id: route.id,
            detail: "Agent activity is unavailable"
          })
        )
      )
    }
    return activity.activities(route.id).pipe(
      Effect.map((activities) => json(200, activities)),
      Effect.catch((cause) => Effect.succeed(clientErrorResponse(cause)))
    )
  }

  const handleSnapshot = (
    request: Request,
    route: Extract<CritHttpRoute, { readonly _tag: "FrameSnapshot" }>
  ) => {
    if (request.method !== "POST") {
      return Effect.succeed(methodNotAllowed(route.id, ["POST"]))
    }
    const rejected = crossOriginRejection(request, route.id)
    if (rejected !== undefined) return Effect.succeed(rejected)
    if (snapshots === null) {
      return Effect.succeed(
        clientErrorResponse(
          new CritClientUnavailable({
            operation: "snapshot",
            id: route.id,
            detail: "Snapshot capture is unavailable"
          })
        )
      )
    }
    return snapshots.snapshot(route.id, route.frameId).pipe(
      Effect.map((document) => json(200, document)),
      Effect.catch((cause) => Effect.succeed(clientErrorResponse(cause)))
    )
  }

  const handleCanvas = (
    request: Request,
    route: Extract<CritHttpRoute, { readonly _tag: "Canvas" }>
  ) => {
    if (request.method === "GET") {
      return client.load(route.id).pipe(
        Effect.map((document) => json(200, document)),
        Effect.catch((cause) => Effect.succeed(clientErrorResponse(cause)))
      )
    }

    if (request.method === "PATCH") {
      const rejected = crossOriginRejection(request, route.id)
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
        const commentsUnavailable = unavailableCommentCommandDetail(
          input.commands,
          resolveFeatures(request)
        )
        if (commentsUnavailable !== undefined) {
          return yield* new InvalidApplyRequest({
            detail: commentsUnavailable
          })
        }
        return yield* client.apply(route.id, input.commands)
      }).pipe(
        Effect.map((document) => json(200, document)),
        Effect.catch((cause) => Effect.succeed(Match.valueTags(cause, {
          CritClientNotFound: clientErrorResponse,
          CritClientCommandFailed: clientErrorResponse,
          CritClientInvalidDocument: clientErrorResponse,
          CritClientUnavailable: clientErrorResponse,
          ApplyRequestBodyTooLarge: (failure) => json(
            413,
            errorBody(
              "invalid-request",
              `Request body exceeds ${failure.maxBytes} bytes`,
              { id: route.id }
            )
          ),
          InvalidApplyRequest: (failure) => json(
            400,
            errorBody("invalid-request", failure.detail, { id: route.id })
          )
        })))
      )
    }

    return Effect.succeed(methodNotAllowed(route.id, ["GET", "PATCH"]))
  }

  return (request, parsedRoute) => {
    const route = parsedRoute ?? parseCritHttpRoute(request.url, apiPath)
    if (route === undefined) return Effect.succeed(null)
    return Match.valueTags(route, {
      Invalid: () => Effect.succeed(
        json(400, errorBody("invalid-request", "A Canvas ID is required"))
      ),
      CurrentAuthor: () => handleCurrentAuthor(request),
      CanvasActivity: (activityRoute) =>
        handleActivity(request, activityRoute),
      FrameSnapshot: (snapshotRoute) =>
        handleSnapshot(request, snapshotRoute),
      Canvas: (canvasRoute) => handleCanvas(request, canvasRoute)
    })
  }
}

export class CritHttp extends Context.Service<CritHttp, {
  readonly handler: (
    services: CritHttpServices,
    options?: CritHttpHandlerOptions
  ) => CritHttpHandler
}>()("@crit/http/CritHttp") {
  static readonly layer = Layer.succeed(CritHttp, {
    handler: makeCritHttpHandler
  })
}

export const decodeCanvasDocument = (input: Schema.Json, id: string) =>
  Schema.decodeUnknownEffect(CanvasDocument)(input).pipe(
    Effect.mapError(
      (cause) =>
        new CritClientInvalidDocument({ id, detail: String(cause) })
    )
  )

export const decodeCurrentAuthor = (input: Schema.Json) =>
  Schema.decodeUnknownEffect(Author)(input).pipe(
    Effect.mapError(
      (cause) =>
        new CritClientInvalidDocument({
          id: "current-author",
          detail: String(cause)
        })
    )
  )

export const decodeAgentActivities = (input: Schema.Json, id: string) =>
  Schema.decodeUnknownEffect(AgentActivityCollection)(input).pipe(
    Effect.mapError(
      (cause) =>
        new CritClientInvalidDocument({ id, detail: String(cause) })
    )
  )

export const encodeApplyRequest = (
  commands: ReadonlyArray<typeof CanvasCommandSchema.Type>
): CritHttpApplyRequest => ({ commands: [...commands] })
