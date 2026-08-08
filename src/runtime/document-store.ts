import { Context, Effect, Schema } from "effect"

import type { CanvasDocument } from "../core/index.js"

export class DocumentNotFound extends Schema.TaggedError<DocumentNotFound>()(
  "DocumentNotFound",
  {
    id: Schema.String
  }
) {}

export class DocumentAlreadyExists extends Schema.TaggedError<DocumentAlreadyExists>()(
  "DocumentAlreadyExists",
  {
    id: Schema.String,
    currentRevision: Schema.Number
  }
) {}

export class DocumentConflict extends Schema.TaggedError<DocumentConflict>()(
  "DocumentConflict",
  {
    id: Schema.String,
    expectedRevision: Schema.Number,
    currentRevision: Schema.Number
  }
) {}

export class DocumentMalformed extends Schema.TaggedError<DocumentMalformed>()(
  "DocumentMalformed",
  {
    id: Schema.String,
    detail: Schema.String
  }
) {}

export class DocumentStorageFailed extends Schema.TaggedError<DocumentStorageFailed>()(
  "DocumentStorageFailed",
  {
    operation: Schema.String,
    id: Schema.String,
    detail: Schema.String
  }
) {}

export type DocumentStoreError =
  | DocumentNotFound
  | DocumentAlreadyExists
  | DocumentConflict
  | DocumentMalformed
  | DocumentStorageFailed

export interface DocumentStoreShape {
  readonly create: (
    document: CanvasDocument
  ) => Effect.Effect<CanvasDocument, DocumentAlreadyExists | DocumentMalformed | DocumentStorageFailed>
  readonly load: (
    id: string
  ) => Effect.Effect<CanvasDocument, DocumentNotFound | DocumentMalformed | DocumentStorageFailed>
  readonly list: () => Effect.Effect<
    ReadonlyArray<CanvasDocument>,
    DocumentMalformed | DocumentStorageFailed
  >
  readonly save: (
    document: CanvasDocument,
    options: { readonly expectedRevision: number }
  ) => Effect.Effect<CanvasDocument, DocumentNotFound | DocumentConflict | DocumentMalformed | DocumentStorageFailed>
}

export class DocumentStore extends Context.Service<DocumentStore, DocumentStoreShape>()(
  "@riff-refine/crit/DocumentStore"
) {}
