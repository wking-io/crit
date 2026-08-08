import { Context, Effect, Schema } from "effect"

import type {
  CanvasChange,
  CanvasCommand,
  CanvasCommandFailed,
  CanvasDocument,
  CanvasDocumentTooLarge
} from "../core/index.js"

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

export type CanvasRepositoryError =
  | DocumentNotFound
  | DocumentAlreadyExists
  | DocumentMalformed
  | DocumentStorageFailed

export interface CanvasRepositoryMutation {
  readonly document: CanvasDocument
  readonly change: CanvasChange
}

export interface CanvasRepositoryShape {
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
  readonly apply: (
    id: string,
    commands: ReadonlyArray<CanvasCommand>
  ) => Effect.Effect<
    CanvasRepositoryMutation,
    | DocumentNotFound
    | DocumentMalformed
    | DocumentStorageFailed
    | CanvasCommandFailed
    | CanvasDocumentTooLarge
  >
}

export class CanvasRepository extends Context.Service<CanvasRepository, CanvasRepositoryShape>()(
  "@riff-refine/crit/CanvasRepository"
) {}
