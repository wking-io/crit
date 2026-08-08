import { Context, Effect, Schema } from "effect"

import type { CanvasCommand, CanvasDocument } from "../core/index.js"

export class CritClientNotFound extends Schema.TaggedError<CritClientNotFound>()(
  "CritClientNotFound",
  { id: Schema.String }
) {}

export class CritClientInvalidDocument extends Schema.TaggedError<CritClientInvalidDocument>()(
  "CritClientInvalidDocument",
  {
    id: Schema.String,
    detail: Schema.String
  }
) {}

export class CritClientCommandFailed extends Schema.TaggedError<CritClientCommandFailed>()(
  "CritClientCommandFailed",
  {
    id: Schema.String,
    reason: Schema.String,
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
  | CritClientCommandFailed
  | CritClientInvalidDocument
  | CritClientUnavailable

export interface CritClientShape {
  readonly load: (id: string) => Effect.Effect<CanvasDocument, CritClientError>
  readonly apply: (
    id: string,
    commands: ReadonlyArray<CanvasCommand>
  ) => Effect.Effect<CanvasDocument, CritClientError>
}

export class CritClient extends Context.Service<CritClient, CritClientShape>()(
  "@riff-refine/crit/CritClient"
) {}
