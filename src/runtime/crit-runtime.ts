import { Context, Effect, Layer, Schema } from "effect"

import {
  Canvas,
  CanvasChange,
  CanvasCommandFailed,
  CanvasCommandSchema,
  CanvasDocumentTooLarge,
  FrameList,
  NoteList,
  CanvasSummary,
  type CanvasCommand,
  type CanvasDocument,
  type CanvasOpenFailed
} from "../core/index.js"
import {
  DocumentMalformed,
  CanvasRepository,
  type DocumentAlreadyExists,
  type DocumentNotFound,
  type DocumentStorageFailed
} from "./canvas-repository.js"

export const UpdateCanvasInput = Schema.Struct({
  id: Schema.String,
  commands: Schema.Array(CanvasCommandSchema)
})
export type UpdateCanvasInput = typeof UpdateCanvasInput.Type

export const CanvasMutationResult = Schema.Struct({
  revision: Schema.Finite,
  change: CanvasChange,
  canvas: CanvasSummary
})
export type CanvasMutationResult = typeof CanvasMutationResult.Type

export const CanvasView = Schema.Struct({
  canvas: CanvasSummary,
  frames: FrameList,
  notes: NoteList
})
export type CanvasView = typeof CanvasView.Type

const malformedDetail = (
  cause: CanvasOpenFailed | CanvasDocumentTooLarge
) =>
  cause._tag === "CanvasDocumentTooLarge"
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
  readonly getCanvas: (
    id: string
  ) => Effect.Effect<
    CanvasView,
    DocumentNotFound | DocumentMalformed | DocumentStorageFailed
  >
  readonly listCanvases: () => Effect.Effect<
    ReadonlyArray<CanvasSummary>,
    DocumentMalformed | DocumentStorageFailed
  >
  readonly updateCanvas: (
    input: UpdateCanvasInput
  ) => Effect.Effect<
    CanvasMutationResult,
    | DocumentNotFound
    | DocumentMalformed
    | DocumentStorageFailed
    | CanvasCommandFailed
    | CanvasDocumentTooLarge
  >
}

export class CritRuntime extends Context.Service<CritRuntime, CritRuntimeShape>()(
  "@riff-refine/crit/CritRuntime"
) {}

export const CritRuntimeLive = Layer.effect(
  CritRuntime,
  Effect.gen(function*() {
    const documents = yield* CanvasRepository

    return {
      createCanvas: (input) => {
        const canvas = Canvas.create(input)
        return documents.create(Canvas.export(canvas)).pipe(Effect.as(Canvas.summarize(canvas)))
      },
      readCanvas: documents.load,
      getCanvas: (id) =>
        Effect.gen(function*() {
          const document = yield* documents.load(id)
          const canvas = yield* openStoredCanvas(document)
          return {
            canvas: Canvas.summarize(canvas),
            frames: Canvas.listFrames(canvas),
            notes: Canvas.listNotes(canvas)
          }
        }),
      listCanvases: () =>
        documents.list().pipe(
          Effect.flatMap((stored) =>
            Effect.forEach(stored, (document) =>
              openStoredCanvas(document).pipe(Effect.map(Canvas.summarize))
            )
          )
        ),
      updateCanvas: (input) =>
        Effect.gen(function*() {
          const mutation = yield* documents.apply(input.id, input.commands)
          const persisted = yield* openStoredCanvas(mutation.document)

          return {
            revision: mutation.document.revision,
            change: mutation.change,
            canvas: Canvas.summarize(persisted)
          }
        })
    } satisfies CritRuntimeShape
  })
)
