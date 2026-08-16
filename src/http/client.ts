import { Effect, Schema } from "effect"
import { causeMessage } from "../internal/cause-message.js"

import {
  CritActivityClient,
  CritClient,
  CritClientCommandFailed,
  CritClientInvalidDocument,
  CritClientNotFound,
  CritSnapshotClient,
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
  encodeApplyRequest,
  type CritHttpServices
} from "./contract.js"

export interface HttpCritClientOptions {
  readonly apiPath?: string
  readonly fetch?: typeof globalThis.fetch
}

export interface HttpCritClientServices extends CritHttpServices {
  readonly snapshots: CritSnapshotClient["Service"]
  readonly activity: CritActivityClient["Service"]
}

const parseJson = (response: Response) =>
  Effect.tryPromise({
    try: async () =>
      Schema.decodeUnknownSync(Schema.Json)(await response.json()),
    catch: (cause) =>
      new Error(causeMessage(cause, "Invalid JSON response"))
  })

const responseError = (
  response: Response,
  input: Schema.Json,
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

const make = (
  options: HttpCritClientOptions = {}
): HttpCritClientServices => {
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
          detail: causeMessage(cause)
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

  const client: CritClient["Service"] = {
    currentAuthor: () =>
      Effect.tryPromise({
        try: () => request(critCurrentAuthorUrl(apiPath)),
        catch: (cause) =>
          new CritClientUnavailable({
            operation: "current-author",
            id: "current-author",
            detail: causeMessage(cause)
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
      })
  }
  const snapshots: CritSnapshotClient["Service"] = {
    snapshot: (canvasId, frameId) =>
      execute("snapshot", canvasId, {
        method: "POST"
      }, critFrameSnapshotUrl(apiPath, canvasId, frameId))
  }
  const activity: CritActivityClient["Service"] = {
    activities: (canvasId) =>
      Effect.tryPromise({
        try: () => request(critCanvasActivityUrl(apiPath, canvasId)),
        catch: (cause) =>
          new CritClientUnavailable({
            operation: "activity",
            id: canvasId,
            detail: causeMessage(cause)
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
  return { client, snapshots, activity }
}

export const HttpCritClient = { make } as const
