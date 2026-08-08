import { Context, Effect, Schema } from "effect"

import type { CanvasDocument } from "../core/index.js"

export class CritClientNotFound extends Schema.TaggedError<CritClientNotFound>()(
  "CritClientNotFound",
  { id: Schema.String }
) {}

export class CritClientConflict extends Schema.TaggedError<CritClientConflict>()(
  "CritClientConflict",
  {
    id: Schema.String,
    expectedRevision: Schema.Number,
    currentRevision: Schema.Number
  }
) {}

export class CritClientInvalidDocument extends Schema.TaggedError<CritClientInvalidDocument>()(
  "CritClientInvalidDocument",
  {
    id: Schema.String,
    detail: Schema.String
  }
) {}

export class CritClientUnavailable extends Schema.TaggedError<CritClientUnavailable>()(
  "CritClientUnavailable",
  {
    operation: Schema.String,
    id: Schema.String,
    detail: Schema.String
  }
) {}

export type CritClientError =
  | CritClientNotFound
  | CritClientConflict
  | CritClientInvalidDocument
  | CritClientUnavailable

export interface CritClientShape {
  readonly load: (id: string) => Effect.Effect<CanvasDocument, CritClientError>
  readonly save: (
    document: CanvasDocument,
    expectedRevision: number
  ) => Effect.Effect<CanvasDocument, CritClientError>
}

export class CritClient extends Context.Service<CritClient, CritClientShape>()(
  "@riff-refine/crit/CritClient"
) {}
