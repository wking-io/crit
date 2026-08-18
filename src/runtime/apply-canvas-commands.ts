import { Effect } from "effect"

import {
  Canvas,
  CanvasDocumentTooLarge,
  type CanvasCommand,
  type CanvasDocument
} from "../core/index.js"
import { CanvasInternals } from "../core/canvas.js"
import { causeMessage } from "../internal/cause-message.js"
import {
  CritClientCommandFailed,
  CritClientInvalidDocument,
  rejectedCanvasCommand
} from "./canvas-failure.js"
import type { CanvasRepositoryMutation } from "./canvas-repository.js"

export const applyCanvasCommands = (
  id: string,
  current: CanvasDocument,
  commands: ReadonlyArray<CanvasCommand>
): Effect.Effect<
  CanvasRepositoryMutation,
  CritClientCommandFailed | CritClientInvalidDocument
> => {
  if (commands.length === 0) {
    return Effect.fail(
      new CritClientCommandFailed({
        id,
        reason: "invalid-command",
        detail: "A durable Canvas update requires at least one command"
      })
    )
  }

  return Effect.gen(function*() {
    const canvas = Canvas.fromDocument(current)
    const change = yield* Canvas.apply(canvas, ...commands).pipe(
      Effect.mapError((cause) => rejectedCanvasCommand(id, cause))
    )
    CanvasInternals.setRevision(canvas, current.revision + 1)
    const next = yield* Effect.try({
      try: () => Canvas.export(canvas),
      catch: (cause) =>
        cause instanceof CanvasDocumentTooLarge
          ? new CritClientInvalidDocument({ id, detail: cause.detail })
          : new CritClientInvalidDocument({
              id,
              detail: causeMessage(cause)
            })
    })
    return { document: next, change }
  })
}
