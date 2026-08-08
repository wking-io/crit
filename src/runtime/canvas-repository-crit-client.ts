import { Effect } from "effect"

import {
  Canvas,
  CanvasCommandFailed,
  CanvasDocumentTooLarge
} from "../core/index.js"
import {
  CritClientCommandFailed,
  CritClientInvalidDocument,
  CritClientNotFound,
  CritClientUnavailable,
  type CritClientError,
  type CritClientShape
} from "../session/crit-client.js"
import {
  DocumentMalformed,
  DocumentNotFound,
  DocumentStorageFailed,
  type CanvasRepositoryError,
  type CanvasRepositoryShape
} from "./canvas-repository.js"

export interface CanvasRepositoryCritClientOptions {
  readonly createIfMissing?: boolean
  readonly title?: (id: string) => string
}

const toClientError = (
  cause: CanvasRepositoryError | CanvasCommandFailed | CanvasDocumentTooLarge
): CritClientError => {
  if (cause instanceof CanvasCommandFailed) {
    return new CritClientCommandFailed({
      id: "unknown",
      reason: cause.reason,
      detail: cause.detail
    })
  }
  if (cause instanceof CanvasDocumentTooLarge) {
    return new CritClientInvalidDocument({
      id: "unknown",
      detail: `Canvas Document is ${cause.actualBytes} bytes; maximum is ${cause.maxBytes}`
    })
  }
  if (cause instanceof DocumentNotFound) {
    return new CritClientNotFound({ id: cause.id })
  }
  if (cause instanceof DocumentMalformed) {
    return new CritClientInvalidDocument({
      id: cause.id,
      detail: cause.detail
    })
  }
  if (cause instanceof DocumentStorageFailed) {
    return new CritClientUnavailable({
      operation: cause.operation,
      id: cause.id,
      detail: cause.detail
    })
  }
  return new CritClientUnavailable({
    operation: "create",
    id: cause.id,
    detail: `Canvas already exists at revision ${cause.currentRevision}`
  })
}

const make = (
  documents: CanvasRepositoryShape,
  options: CanvasRepositoryCritClientOptions = {}
): CritClientShape => {
  const createIfMissing = options.createIfMissing ?? false
  const title = options.title ?? ((id: string) => id)

  const createCanvas = (id: string) =>
    documents
      .create(Canvas.export(Canvas.create({ id, title: title(id) })))
      .pipe(
        Effect.catchTag("DocumentAlreadyExists", () => documents.load(id)),
        Effect.catchTag("DocumentStorageFailed", (createFailure) =>
          documents.load(id).pipe(
            Effect.catch(() => Effect.fail(createFailure))
          )
        )
      )

  return {
    load: (id) =>
      documents.load(id).pipe(
        Effect.catchTag("DocumentNotFound", (cause) =>
          createIfMissing ? createCanvas(id) : Effect.fail(cause)
        ),
        Effect.mapError(toClientError)
      ),
    apply: (id, commands) =>
      documents.apply(id, commands).pipe(
        Effect.map((mutation) => mutation.document),
        Effect.mapError((cause) => {
          const mapped = toClientError(cause)
          return mapped instanceof CritClientCommandFailed && mapped.id === "unknown"
            ? new CritClientCommandFailed({
                id,
                reason: mapped.reason,
                detail: mapped.detail
              })
            : mapped instanceof CritClientInvalidDocument && mapped.id === "unknown"
              ? new CritClientInvalidDocument({ id, detail: mapped.detail })
            : mapped
        })
      )
  }
}

export const CanvasRepositoryCritClient = { make } as const
