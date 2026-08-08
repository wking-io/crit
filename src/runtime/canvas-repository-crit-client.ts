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
import {
  SnapshotCaptureFailed,
  SnapshotStorageFailed
} from "./snapshot-archive.js"
import type {
  SnapshotFrameError,
  SnapshotServiceShape
} from "./snapshot-service.js"

export interface CanvasRepositoryCritClientOptions {
  readonly createIfMissing?: boolean
  readonly title?: (id: string) => string
  readonly snapshotFrame?: SnapshotServiceShape["snapshotFrame"]
}

const toClientError = (
  cause:
    | CanvasRepositoryError
    | CanvasCommandFailed
    | CanvasDocumentTooLarge
    | SnapshotFrameError
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
  if (cause instanceof SnapshotCaptureFailed) {
    return new CritClientUnavailable({
      operation: "snapshot",
      id: "unknown",
      detail: cause.detail
    })
  }
  if (cause instanceof SnapshotStorageFailed) {
    return new CritClientUnavailable({
      operation: cause.operation,
      id: "unknown",
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

  const mapForId = (id: string, cause: Parameters<typeof toClientError>[0]) => {
    const mapped = toClientError(cause)
    if (mapped.id !== "unknown") return mapped
    if (mapped instanceof CritClientCommandFailed) {
      return new CritClientCommandFailed({
        id,
        reason: mapped.reason,
        detail: mapped.detail
      })
    }
    if (mapped instanceof CritClientInvalidDocument) {
      return new CritClientInvalidDocument({ id, detail: mapped.detail })
    }
    if (mapped instanceof CritClientNotFound) {
      return new CritClientNotFound({ id })
    }
    return new CritClientUnavailable({
      operation: mapped.operation,
      id,
      detail: mapped.detail
    })
  }

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
        Effect.mapError((cause) => mapForId(id, cause))
      ),
    ...(options.snapshotFrame === undefined
      ? {}
      : {
          snapshot: (id: string, frameId: string) =>
            options.snapshotFrame!(id, frameId).pipe(
              Effect.mapError((cause) => mapForId(id, cause))
            )
        })
  }
}

export const CanvasRepositoryCritClient = { make } as const
