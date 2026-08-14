import { Schema } from "effect"

import type {
  CanvasCommandFailed,
  CanvasDocumentTooLarge,
  CanvasOpenFailed
} from "../core/index.js"

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

const unreachableCritClientError = (failure: never): never => {
  throw new TypeError(`Unreachable CritClientError variant: ${String(failure)}`)
}

export const critClientErrorMessage = (failure: CritClientError): string => {
  switch (failure._tag) {
    case "CritClientNotFound":
      return `Canvas not found: ${failure.id}`
    case "CritClientCommandFailed":
    case "CritClientInvalidDocument":
    case "CritClientUnavailable":
      return failure.detail
    default:
      return unreachableCritClientError(failure)
  }
}

export const isCurrentAuthorError = (failure: CritClientError): boolean => {
  switch (failure._tag) {
    case "CritClientNotFound":
    case "CritClientCommandFailed":
    case "CritClientInvalidDocument":
      return false
    case "CritClientUnavailable":
      return failure.operation === "current-author"
    default:
      return unreachableCritClientError(failure)
  }
}

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
    detail: cause instanceof Error ? cause.message : String(cause)
  })
