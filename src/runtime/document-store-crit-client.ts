import { Effect } from "effect"

import { Canvas } from "../core/index.js"
import {
  CritClientConflict,
  CritClientInvalidDocument,
  CritClientNotFound,
  CritClientUnavailable,
  type CritClientError,
  type CritClientShape
} from "../session/crit-client.js"
import {
  DocumentConflict,
  DocumentMalformed,
  DocumentNotFound,
  DocumentStorageFailed,
  type DocumentStoreError,
  type DocumentStoreShape
} from "./document-store.js"

export interface DocumentStoreCritClientOptions {
  readonly createIfMissing?: boolean
  readonly title?: (id: string) => string
}

const toClientError = (cause: DocumentStoreError): CritClientError => {
  if (cause instanceof DocumentNotFound) {
    return new CritClientNotFound({ id: cause.id })
  }
  if (cause instanceof DocumentConflict) {
    return new CritClientConflict({
      id: cause.id,
      expectedRevision: cause.expectedRevision,
      currentRevision: cause.currentRevision
    })
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
  documents: DocumentStoreShape,
  options: DocumentStoreCritClientOptions = {}
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
    save: (document, expectedRevision) =>
      documents
        .save(document, { expectedRevision })
        .pipe(Effect.mapError(toClientError))
  }
}

export const DocumentStoreCritClient = { make } as const
