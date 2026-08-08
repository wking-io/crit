import { Effect, Schema } from "effect"

import {
  CritClientCommandFailed,
  CritClientInvalidDocument,
  CritClientNotFound,
  CritClientUnavailable,
  type CritClientError,
  type CritClientShape
} from "../session/crit-client.js"
import {
  CritHttpErrorBody,
  DEFAULT_CRIT_API_PATH,
  critCanvasActivityUrl,
  critCanvasUrl,
  critFrameSnapshotUrl,
  decodeAgentActivity,
  decodeCanvasDocument,
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
  operation: "load" | "apply" | "snapshot" | "activity",
  id: string
): CritClientError => {
  const parsed = Schema.decodeUnknownOption(CritHttpErrorBody)(input)
  if (parsed._tag === "Some") {
    const body = parsed.value.error
    if (body.code === "not-found") return new CritClientNotFound({ id })
    if (body.code === "command-rejected") {
      return new CritClientCommandFailed({
        id,
        reason: body.reason ?? "command-rejected",
        detail: body.message
      })
    }
    if (
      body.code === "invalid-document" ||
      body.code === "invalid-request"
    ) {
      return new CritClientInvalidDocument({ id, detail: body.message })
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

const make = (options: HttpCritClientOptions = {}): CritClientShape => {
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
    activity: (canvasId) =>
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
                ? decodeAgentActivity(body, canvasId)
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
