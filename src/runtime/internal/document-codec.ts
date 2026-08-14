import { Effect } from "effect"

import {
  Canvas,
  type CanvasDocument,
  type CanvasOpenInput
} from "../../core/index.js"
import { invalidCanvasDocument } from "../canvas-failure.js"

export const serializeDocument = (document: CanvasDocument) =>
  `${JSON.stringify(document)}\n`

export const canonicalizeDocument = (id: string, input: CanvasOpenInput) =>
  Canvas.open(input).pipe(
    Effect.map(Canvas.export),
    Effect.mapError((cause) => invalidCanvasDocument(id, cause))
  )
