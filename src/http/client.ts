import { Effect, Schema } from "effect"

import {
  CritClient,
  CritClientCommandFailed,
  CritClientInvalidDocument,
  CritClientNotFound,
  CritClientUnavailable,
  type CritClientError
} from "../session/crit-client.js"
import {
  CritHttpErrorBody,
  DEFAULT_CRIT_API_PATH,
  critCanvasActivityUrl,
  critCanvasUrl,
  critCurrentAuthorUrl,
  critFrameSnapshotUrl,
  decodeAgentActivities,
  decodeCanvasDocument,
  decodeCurrentAuthor,
  encodeApplyRequest
} from "./contract.js"

export interface HttpCritClientOptions {
  readonly apiPath?: string
  readonly fetch?: typeof globalThis.fetch
}

const parseJson = (response: Response) =>
  Effect.tryPromise({
    try: () => response.json() as Promise<unknown>,
    catch: (cause) =>
      new Error(cause instanceof Error ? cause.message : "Invalid JSON response")
  })

const responseError = (
  response: Response,
  input: unknown,
  operation: "current-author" | "load" | "apply" | "snapshot" | "activity",
  id: string
): CritClientError => {
  const parsed = Schema.decodeUnknownOption(CritHttpErrorBody)(input)
  if (parsed._tag === "Some") {
    const body = parsed.value.error
    if (
      body instanceof CritClientNotFound ||
      body instanceof CritClientCommandFailed ||
      body instanceof CritClientInvalidDocument ||
      body instanceof CritClientUnavailable
    ) {
      return body
    }
    return new CritClientUnavailable({
      operation,
      id,
      detail: body.message
    })
  }

  return new CritClientUnavailable({
    operation,
    id,
    detail: `Crit HTTP adapter returned ${response.status}`
  })
}

const make = (options: HttpCritClientOptions = {}): CritClient["Service"] => {
  const apiPath = options.apiPath ?? DEFAULT_CRIT_API_PATH
  const request = options.fetch ?? globalThis.fetch

  const execute = (
    operation: "load" | "apply" | "snapshot" | "activity",
    id: string,
    init?: RequestInit,
    url = critCanvasUrl(apiPath, id)
  ) =>
    Effect.tryPromise({
      try: () => request(url, init),
      catch: (cause) =>
        new CritClientUnavailable({
          operation,
          id,
          detail: cause instanceof Error ? cause.message : String(cause)
        })
    }).pipe(
      Effect.flatMap((response) =>
        parseJson(response).pipe(
          Effect.mapError(
            (cause) =>
              new CritClientUnavailable({
                operation,
                id,
                detail: cause.message
              })
          ),
          Effect.flatMap((body) =>
            response.ok
              ? decodeCanvasDocument(body, id)
              : Effect.fail(responseError(response, body, operation, id))
          )
        )
      )
    )

  return {
    currentAuthor: () =>
      Effect.tryPromise({
        try: () => request(critCurrentAuthorUrl(apiPath)),
        catch: (cause) =>
          new CritClientUnavailable({
            operation: "current-author",
            id: "current-author",
            detail: cause instanceof Error ? cause.message : String(cause)
          })
      }).pipe(
        Effect.flatMap((response) =>
          parseJson(response).pipe(
            Effect.mapError(
              (cause) =>
                new CritClientUnavailable({
                  operation: "current-author",
                  id: "current-author",
                  detail: cause.message
                })
            ),
            Effect.flatMap((body) =>
              response.ok
                ? decodeCurrentAuthor(body)
                : Effect.fail(
                    responseError(
                      response,
                      body,
                      "current-author",
                      "current-author"
                    )
                  )
            )
          )
        )
      ),
    load: (id) => execute("load", id),
    apply: (id, commands) =>
      execute("apply", id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(encodeApplyRequest(commands))
      }),
    snapshot: (canvasId, frameId) =>
      execute("snapshot", canvasId, {
        method: "POST"
      }, critFrameSnapshotUrl(apiPath, canvasId, frameId)),
    activities: (canvasId) =>
      Effect.tryPromise({
        try: () => request(critCanvasActivityUrl(apiPath, canvasId)),
        catch: (cause) =>
          new CritClientUnavailable({
            operation: "activity",
            id: canvasId,
            detail: cause instanceof Error ? cause.message : String(cause)
          })
      }).pipe(
        Effect.flatMap((response) =>
          parseJson(response).pipe(
            Effect.mapError(
              (cause) =>
                new CritClientUnavailable({
                  operation: "activity",
                  id: canvasId,
                  detail: cause.message
                })
            ),
            Effect.flatMap((body) =>
              response.ok
                ? decodeAgentActivities(body, canvasId)
                : Effect.fail(
                    responseError(response, body, "activity", canvasId)
                  )
            )
          )
        )
      )
  }
}

export const HttpCritClient = { make } as const
