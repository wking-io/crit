import { Effect } from "effect"

import { Canvas, type CanvasDocument } from "../../core/index.js"
import { DocumentMalformed } from "../canvas-repository.js"

export const serializeDocument = (document: CanvasDocument) =>
  `${JSON.stringify(document)}\n`

export const canonicalizeDocument = (id: string, input: unknown) =>
  Canvas.open(input).pipe(
    Effect.map(Canvas.export),
    Effect.mapError(
      (cause) =>
        new DocumentMalformed({
          id,
          detail:
            cause._tag === "CanvasDocumentTooLarge"
                ? `Canvas Document is ${cause.actualBytes} bytes; maximum is ${cause.maxBytes}`
                : cause.detail
        })
    )
  )
