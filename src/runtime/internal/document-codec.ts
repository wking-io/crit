import { Effect } from "effect"

import { Canvas, type CanvasDocument } from "../../core/index.js"

export const serializeDocument = (document: CanvasDocument) =>
  `${JSON.stringify(document)}\n`

export const canonicalizeDocument = (id: string, input: unknown) =>
  Canvas.open(id, input).pipe(Effect.map(Canvas.export))
