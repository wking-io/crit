import { Schema } from "effect"

// The one failure vocabulary for the durable Canvas path. Every member
// carries the Canvas it concerns and renders its own human-readable message,
// so repositories, clients, and the HTTP wire share these classes instead of
// translating between parallel vocabularies.

export class CanvasNotFound extends Schema.TaggedError<CanvasNotFound>()(
  "CanvasNotFound",
  { canvasId: Schema.String }
) {
  override get message(): string {
    return `Canvas not found: ${this.canvasId}`
  }
}

export class CanvasAlreadyExists extends Schema.TaggedError<CanvasAlreadyExists>()(
  "CanvasAlreadyExists",
  {
    canvasId: Schema.String,
    currentRevision: Schema.Number
  }
) {
  override get message(): string {
    return `Canvas ${this.canvasId} already exists at revision ${this.currentRevision}`
  }
}

export class CanvasInvalidDocument extends Schema.TaggedError<CanvasInvalidDocument>()(
  "CanvasInvalidDocument",
  {
    canvasId: Schema.String,
    detail: Schema.String
  }
) {
  override get message(): string {
    return this.detail
  }
}

export const CanvasCommandFailureReason = Schema.Union([
  Schema.Literal("invalid-command"),
  Schema.Literal("duplicate-frame"),
  Schema.Literal("frame-not-found"),
  Schema.Literal("duplicate-note"),
  Schema.Literal("note-not-found"),
  Schema.Literal("note-conflict"),
  Schema.Literal("snapshot-source-changed"),
  Schema.Literal("snapshot-source-invalid"),
  Schema.Literal("snapshot-frame-immutable"),
  Schema.Literal("invalid-canvas"),
  Schema.Literal("apply-failed")
])
export type CanvasCommandFailureReason = typeof CanvasCommandFailureReason.Type

export class CanvasCommandFailed extends Schema.TaggedError<CanvasCommandFailed>()(
  "CanvasCommandFailed",
  {
    canvasId: Schema.String,
    reason: CanvasCommandFailureReason,
    detail: Schema.String
  }
) {
  override get message(): string {
    return this.detail
  }
}

export class CanvasDocumentTooLarge extends Schema.TaggedError<CanvasDocumentTooLarge>()(
  "CanvasDocumentTooLarge",
  {
    canvasId: Schema.String,
    actualBytes: Schema.Number,
    maxBytes: Schema.Number
  }
) {
  override get message(): string {
    return `Canvas Document is ${this.actualBytes} bytes; maximum is ${this.maxBytes}`
  }
}

export class CanvasUnavailable extends Schema.TaggedError<CanvasUnavailable>()(
  "CanvasUnavailable",
  {
    canvasId: Schema.String,
    operation: Schema.String,
    detail: Schema.String
  }
) {
  override get message(): string {
    return this.detail
  }
}

export const CanvasErrorSchema = Schema.Union([
  CanvasNotFound,
  CanvasAlreadyExists,
  CanvasInvalidDocument,
  CanvasCommandFailed,
  CanvasDocumentTooLarge,
  CanvasUnavailable
])

export type CanvasError =
  | CanvasNotFound
  | CanvasAlreadyExists
  | CanvasInvalidDocument
  | CanvasCommandFailed
  | CanvasDocumentTooLarge
  | CanvasUnavailable
