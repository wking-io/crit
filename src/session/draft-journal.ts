import { Context, Effect, Option, Schema } from "effect"

import { CanvasCommandSchema } from "../core/index.js"

export const CanvasDraft = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  canvasId: Schema.String,
  sessionId: Schema.String,
  baseRevision: Schema.Number,
  mutation: Schema.Number,
  commands: Schema.Array(CanvasCommandSchema)
})
export type CanvasDraft = typeof CanvasDraft.Type

export class DraftJournalFailed extends Schema.TaggedError<DraftJournalFailed>()(
  "DraftJournalFailed",
  {
    operation: Schema.String,
    canvasId: Schema.String,
    detail: Schema.String
  }
) {}

export class DraftJournal extends Context.Service<DraftJournal, {
  readonly load: (
    canvasId: string,
    sessionId: string
  ) => Effect.Effect<Option.Option<CanvasDraft>, DraftJournalFailed>
  readonly save: (
    draft: CanvasDraft
  ) => Effect.Effect<void, DraftJournalFailed>
  readonly clear: (
    canvasId: string,
    sessionId: string,
    throughMutation: number
  ) => Effect.Effect<void, DraftJournalFailed>
}>()(
  "@riff-refine/crit/DraftJournal"
) {}
