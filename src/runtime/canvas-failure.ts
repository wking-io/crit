import { Match, Schema } from "effect"

import type {
  CanvasCommandFailed,
  CanvasDocumentTooLarge,
  CanvasOpenFailed
} from "../core/index.js"
import { causeMessage } from "../internal/cause-message.js"

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

export const CritClientErrorSchema = Schema.Union([
  CritClientNotFound,
  CritClientCommandFailed,
  CritClientInvalidDocument,
  CritClientUnavailable
])

export type CritClientError = typeof CritClientErrorSchema.Type

export const critClientErrorMessage = Match.typeTags<CritClientError, string>()({
  CritClientNotFound: (failure) => `Canvas not found: ${failure.id}`,
  CritClientCommandFailed: (failure) => failure.detail,
  CritClientInvalidDocument: (failure) => failure.detail,
  CritClientUnavailable: (failure) => failure.detail
})

export const isCurrentAuthorError = Match.typeTags<CritClientError, boolean>()({
  CritClientNotFound: () => false,
  CritClientCommandFailed: () => false,
  CritClientInvalidDocument: () => false,
  CritClientUnavailable: (failure) => failure.operation === "current-author"
})

export const invalidCanvasDocument = (
  id: string,
  cause: CanvasOpenFailed | CanvasDocumentTooLarge
) => new CritClientInvalidDocument({ id, detail: cause.detail })

export const rejectedCanvasCommand = (
  id: string,
  cause: CanvasCommandFailed
) =>
  new CritClientCommandFailed({
    id,
    reason: cause.reason,
    detail: cause.detail
  })

export const unavailableCanvas = (
  operation: string,
  id: string,
  cause: unknown
) =>
  new CritClientUnavailable({
    operation,
    id,
    detail: causeMessage(cause)
  })
