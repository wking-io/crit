import { Context, Effect, Layer, Schema } from "effect"

import {
  AssetUnsupported,
  Canvas,
  CanvasChange,
  CanvasCommandFailed,
  CanvasCommandSchema,
  CanvasDocumentTooLarge,
  CanvasSummary,
  type CanvasCommand,
  type CanvasDocument,
  type CanvasOpenFailed
} from "../core/index.js"
import {
  DocumentConflict,
  DocumentMalformed,
  DocumentStore,
  type DocumentAlreadyExists,
  type DocumentNotFound,
  type DocumentStorageFailed
} from "./document-store.js"

export const UpdateCanvasInput = Schema.Struct({
  id: Schema.String,
  expectedRevision: Schema.Finite.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(0)
  ),
  commands: Schema.Array(CanvasCommandSchema)
})
export type UpdateCanvasInput = typeof UpdateCanvasInput.Type

export const CanvasMutationResult = Schema.Struct({
  revision: Schema.Finite,
  change: CanvasChange,
  canvas: CanvasSummary
})
export type CanvasMutationResult = typeof CanvasMutationResult.Type

const malformedDetail = (
  cause: CanvasOpenFailed | AssetUnsupported | CanvasDocumentTooLarge
) =>
  cause._tag === "AssetUnsupported"
    ? `Asset records are unsupported: ${cause.assetIds.join(", ")}`
    : cause._tag === "CanvasDocumentTooLarge"
      ? `Canvas Document is ${cause.actualBytes} bytes; maximum is ${cause.maxBytes}`
      : cause.detail

const openStoredCanvas = (document: CanvasDocument) =>
  Canvas.open(document).pipe(
    Effect.mapError(
      (cause) =>
        new DocumentMalformed({
          id: document.id,
          detail: malformedDetail(cause)
        })
    )
  )

const exportForSave = (canvas: Canvas, id: string) =>
  Effect.try({
    try: () => Canvas.export(canvas),
    catch: (cause) =>
      cause instanceof AssetUnsupported || cause instanceof CanvasDocumentTooLarge
        ? cause
        : new DocumentMalformed({
            id,
            detail: cause instanceof Error ? cause.message : String(cause)
          })
  })

export interface CritRuntimeShape {
  readonly createCanvas: (input: {
    readonly id: string
    readonly title: string
  }) => Effect.Effect<
    CanvasSummary,
    DocumentAlreadyExists | DocumentMalformed | DocumentStorageFailed
  >
  readonly readCanvas: (
    id: string
  ) => Effect.Effect<
    CanvasDocument,
    DocumentNotFound | DocumentMalformed | DocumentStorageFailed
  >
  readonly updateCanvas: (
    input: UpdateCanvasInput
  ) => Effect.Effect<
    CanvasMutationResult,
    | DocumentNotFound
    | DocumentConflict
    | DocumentMalformed
    | DocumentStorageFailed
    | CanvasCommandFailed
    | AssetUnsupported
    | CanvasDocumentTooLarge
  >
}

export class CritRuntime extends Context.Service<CritRuntime, CritRuntimeShape>()(
  "@riff-refine/crit/CritRuntime"
) {}

export const CritRuntimeLive = Layer.effect(
  CritRuntime,
  Effect.gen(function*() {
    const documents = yield* DocumentStore

    return {
      createCanvas: (input) => {
        const canvas = Canvas.create(input)
        return documents.create(Canvas.export(canvas)).pipe(Effect.as(Canvas.summarize(canvas)))
      },
      readCanvas: documents.load,
      updateCanvas: (input) =>
        Effect.gen(function*() {
          if (input.commands.length === 0) {
            return yield* new CanvasCommandFailed({
              reason: "invalid-command",
              detail: "A durable Canvas update requires at least one command"
            })
          }

          const current = yield* documents.load(input.id)
          if (current.revision !== input.expectedRevision) {
            return yield* new DocumentConflict({
              id: input.id,
              expectedRevision: input.expectedRevision,
              currentRevision: current.revision
            })
          }

          const canvas = yield* openStoredCanvas(current)
          const change = yield* Canvas.apply(canvas, ...input.commands)
          const proposed = yield* exportForSave(canvas, input.id)
          const saved = yield* documents.save(proposed, {
            expectedRevision: input.expectedRevision
          })
          const persisted = yield* openStoredCanvas(saved)

          return {
            revision: saved.revision,
            change,
            canvas: Canvas.summarize(persisted)
          }
        })
    } satisfies CritRuntimeShape
  })
)
