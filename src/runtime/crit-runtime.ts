import { Context, Effect, Layer, Schema } from "effect"

import {
  Canvas,
  CanvasChange,
  CanvasCommandSchema,
  FrameList,
  NoteList,
  CanvasSummary,
  type CanvasCommand,
  type CanvasDocument
} from "../core/index.js"
import {
  CanvasRepository,
  type DocumentAlreadyExists
} from "./canvas-repository.js"
import type {
  CritClientCommandFailed,
  CritClientInvalidDocument,
  CritClientNotFound,
  CritClientUnavailable
} from "./canvas-failure.js"

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

export interface CritRuntimeShape {
  readonly createCanvas: (input: {
    readonly id: string
    readonly title: string
  }) => Effect.Effect<
    CanvasSummary,
    DocumentAlreadyExists | CritClientInvalidDocument | CritClientUnavailable
  >
  readonly readCanvas: (
    id: string
  ) => Effect.Effect<
    CanvasDocument,
    CritClientNotFound | CritClientInvalidDocument | CritClientUnavailable
  >
  readonly getCanvas: (
    id: string
  ) => Effect.Effect<
    CanvasView,
    CritClientNotFound | CritClientInvalidDocument | CritClientUnavailable
  >
  readonly listCanvases: () => Effect.Effect<
    ReadonlyArray<CanvasSummary>,
    CritClientInvalidDocument | CritClientUnavailable
  >
  readonly updateCanvas: (
    input: UpdateCanvasInput
  ) => Effect.Effect<
    CanvasMutationResult,
    | CritClientNotFound
    | CritClientInvalidDocument
    | CritClientUnavailable
    | CritClientCommandFailed
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
          const canvas = Canvas.fromDocument(document)
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
              Effect.sync(() => Canvas.summarize(Canvas.fromDocument(document)))
            )
          )
        ),
      updateCanvas: (input) =>
        Effect.gen(function*() {
          const mutation = yield* documents.apply(input.id, input.commands)
          const persisted = Canvas.fromDocument(mutation.document)

          return {
            revision: mutation.document.revision,
            change: mutation.change,
            canvas: Canvas.summarize(persisted)
          }
        })
    } satisfies CritRuntimeShape
  })
)
