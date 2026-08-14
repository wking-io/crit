import { Context, Effect, Schema } from "effect"

import type {
  CanvasChange,
  CanvasCommand,
  CanvasDocument
} from "../core/index.js"
import type {
  CritClientCommandFailed,
  CritClientError,
  CritClientInvalidDocument,
  CritClientNotFound,
  CritClientUnavailable
} from "./canvas-failure.js"

export class DocumentAlreadyExists extends Schema.TaggedError<DocumentAlreadyExists>()(
  "DocumentAlreadyExists",
  {
    id: Schema.String,
    currentRevision: Schema.Number
  }
) {}

export type CanvasRepositoryError =
  | DocumentAlreadyExists
  | CritClientError

export interface CanvasRepositoryMutation {
  readonly document: CanvasDocument
  readonly change: CanvasChange
}

export class CanvasRepository extends Context.Service<CanvasRepository, {
  readonly create: (
    document: CanvasDocument
  ) => Effect.Effect<CanvasDocument, DocumentAlreadyExists | CritClientInvalidDocument | CritClientUnavailable>
  readonly load: (
    id: string
  ) => Effect.Effect<CanvasDocument, CritClientNotFound | CritClientInvalidDocument | CritClientUnavailable>
  readonly list: () => Effect.Effect<
    ReadonlyArray<CanvasDocument>,
    CritClientInvalidDocument | CritClientUnavailable
  >
  readonly apply: (
    id: string,
    commands: ReadonlyArray<CanvasCommand>
  ) => Effect.Effect<
    CanvasRepositoryMutation,
    | CritClientNotFound
    | CritClientInvalidDocument
    | CritClientUnavailable
    | CritClientCommandFailed
  >
}>()(
  "@riff-refine/crit/CanvasRepository"
) {}
