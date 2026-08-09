import { Context, Effect } from "effect"

import type {
  CanvasAlreadyExists,
  CanvasChange,
  CanvasCommand,
  CanvasCommandFailed,
  CanvasDocument,
  CanvasDocumentTooLarge,
  CanvasInvalidDocument,
  CanvasNotFound,
  CanvasUnavailable
} from "../core/index.js"

export interface CanvasRepositoryMutation {
  readonly document: CanvasDocument
  readonly change: CanvasChange
}

export interface CanvasRepositoryShape {
  readonly create: (
    document: CanvasDocument
  ) => Effect.Effect<
    CanvasDocument,
    | CanvasAlreadyExists
    | CanvasInvalidDocument
    | CanvasDocumentTooLarge
    | CanvasUnavailable
  >
  readonly load: (
    id: string
  ) => Effect.Effect<
    CanvasDocument,
    | CanvasNotFound
    | CanvasInvalidDocument
    | CanvasDocumentTooLarge
    | CanvasUnavailable
  >
  readonly list: () => Effect.Effect<
    ReadonlyArray<CanvasDocument>,
    CanvasInvalidDocument | CanvasDocumentTooLarge | CanvasUnavailable
  >
  readonly apply: (
    id: string,
    commands: ReadonlyArray<CanvasCommand>
  ) => Effect.Effect<
    CanvasRepositoryMutation,
    | CanvasNotFound
    | CanvasInvalidDocument
    | CanvasUnavailable
    | CanvasCommandFailed
    | CanvasDocumentTooLarge
  >
}

export class CanvasRepository extends Context.Service<CanvasRepository, CanvasRepositoryShape>()(
  "@riff-refine/crit/CanvasRepository"
) {}
