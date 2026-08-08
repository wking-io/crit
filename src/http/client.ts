import { Effect, Schema } from "effect"

import {
  CritClientConflict,
  CritClientInvalidDocument,
  CritClientNotFound,
  CritClientUnavailable,
  type CritClientError,
  type CritClientShape
} from "../session/crit-client.js"
import {
  CritHttpErrorBody,
  DEFAULT_CRIT_API_PATH,
  critCanvasUrl,
  decodeCanvasDocument,
  encodeSaveRequest
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
  operation: "load" | "save",
  id: string
): CritClientError => {
  const parsed = Schema.decodeUnknownOption(CritHttpErrorBody)(input)
  if (parsed._tag === "Some") {
    const body = parsed.value.error
    if (body.code === "not-found") return new CritClientNotFound({ id })
    if (
      body.code === "conflict" &&
      body.expectedRevision !== undefined &&
      body.currentRevision !== undefined
    ) {
      return new CritClientConflict({
        id,
        expectedRevision: body.expectedRevision,
        currentRevision: body.currentRevision
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
    operation: "load" | "save",
    id: string,
    init?: RequestInit
  ) =>
    Effect.tryPromise({
      try: () => request(critCanvasUrl(apiPath, id), init),
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
    save: (document, expectedRevision) =>
      execute("save", document.id, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(encodeSaveRequest(document, expectedRevision))
      })
  }
}

export const HttpCritClient = { make } as const
