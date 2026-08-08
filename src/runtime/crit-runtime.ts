import { Context, Effect, Layer } from "effect"

import {
  Canvas,
  type CanvasDocument,
  type CanvasSummary
} from "../core/index.js"
import {
  DocumentStore,
  type DocumentAlreadyExists,
  type DocumentMalformed,
  type DocumentNotFound,
  type DocumentStorageFailed
} from "./document-store.js"

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
      readCanvas: documents.load
    } satisfies CritRuntimeShape
  })
)

