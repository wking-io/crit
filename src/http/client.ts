import { Effect, Schema } from "effect"

import { CanvasUnavailable } from "../core/index.js"
import type {
  CritClientError,
  CritClientShape,
  CritClientSnapshotError
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

type Operation = "load" | "apply" | "snapshot" | "activity"

const parseJson = (response: Response) =>
  Effect.tryPromise({
    try: () => response.json() as Promise<unknown>,
    catch: (cause) =>
      new Error(cause instanceof Error ? cause.message : "Invalid JSON response")
  })

// The wire codec is the same schema the server encodes with, so errors arrive
// as themselves. A RequestRejected means the transport refused a request this
// client constructed — from the domain's point of view the adapter is broken,
// which is what CanvasUnavailable says.
const responseError = (
  response: Response,
  input: unknown,
  operation: Operation,
  id: string
): CritClientSnapshotError => {
  const parsed = Schema.decodeUnknownOption(CritHttpErrorBody)(input)
  if (parsed._tag === "Some") {
    const error = parsed.value.error
    return error._tag === "RequestRejected"
      ? new CanvasUnavailable({ operation, canvasId: id, detail: error.message })
      : error
  }
  return new CanvasUnavailable({
    operation,
    canvasId: id,
    detail: `Crit HTTP adapter returned ${response.status}`
  })
}

// Snapshot capture failures on a load/apply/activity response would mean the
// server answered a different question than was asked — unavailable is the
// truthful domain-level description.
const domainError = (
  operation: Operation,
  id: string,
  error: CritClientSnapshotError
): CritClientError =>
  error._tag === "SnapshotCaptureFailed" || error._tag === "SnapshotStorageFailed"
    ? new CanvasUnavailable({ operation, canvasId: id, detail: error.message })
    : error

const make = (options: HttpCritClientOptions = {}): CritClientShape => {
  const apiPath = options.apiPath ?? DEFAULT_CRIT_API_PATH
  const request = options.fetch ?? globalThis.fetch

  const execute = (
    operation: Operation,
    id: string,
    init?: RequestInit,
    url = critCanvasUrl(apiPath, id)
  ) =>
    Effect.tryPromise({
      try: () => request(url, init),
      catch: (cause) =>
        new CanvasUnavailable({
          operation,
          canvasId: id,
          detail: cause instanceof Error ? cause.message : String(cause)
        })
    }).pipe(
      Effect.flatMap((response) =>
        parseJson(response).pipe(
          Effect.mapError(
            (cause) =>
              new CanvasUnavailable({
                operation,
                canvasId: id,
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
    load: (id) =>
      execute("load", id).pipe(
        Effect.mapError((cause) => domainError("load", id, cause))
      ),
    apply: (id, commands) =>
      execute("apply", id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(encodeApplyRequest(commands))
      }).pipe(Effect.mapError((cause) => domainError("apply", id, cause))),
    snapshot: (canvasId, frameId) =>
      execute("snapshot", canvasId, {
        method: "POST"
      }, critFrameSnapshotUrl(apiPath, canvasId, frameId)),
    activity: (canvasId) =>
      Effect.tryPromise({
        try: () => request(critCanvasActivityUrl(apiPath, canvasId)),
        catch: (cause) =>
          new CanvasUnavailable({
            operation: "activity",
            canvasId,
            detail: cause instanceof Error ? cause.message : String(cause)
          })
      }).pipe(
        Effect.flatMap((response) =>
          parseJson(response).pipe(
            Effect.mapError(
              (cause) =>
                new CanvasUnavailable({
                  operation: "activity",
                  canvasId,
                  detail: cause.message
                })
            ),
            Effect.flatMap((body) =>
              response.ok
                ? decodeAgentActivity(body, canvasId)
                : Effect.fail(
                    domainError(
                      "activity",
                      canvasId,
                      responseError(response, body, "activity", canvasId)
                    )
                  )
            )
          )
        )
      )
  }
}

export const HttpCritClient = { make } as const
