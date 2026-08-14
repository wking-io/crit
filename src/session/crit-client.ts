import { Context, Effect } from "effect"

import type { Author, CanvasCommand, CanvasDocument } from "../core/index.js"
import type { AgentActivityCollection } from "../runtime/agent-activity.js"
import type { CritClientError } from "../runtime/canvas-failure.js"

export {
  CritClientCommandFailed,
  CritClientErrorSchema,
  CritClientInvalidDocument,
  CritClientNotFound,
  CritClientUnavailable,
  type CritClientError
} from "../runtime/canvas-failure.js"

export class CritClient extends Context.Service<CritClient, {
  readonly currentAuthor: () => Effect.Effect<Author, CritClientError>
  readonly load: (id: string) => Effect.Effect<CanvasDocument, CritClientError>
  readonly apply: (
    id: string,
    commands: ReadonlyArray<CanvasCommand>
  ) => Effect.Effect<CanvasDocument, CritClientError>
  readonly snapshot?: (
    canvasId: string,
    frameId: string
  ) => Effect.Effect<CanvasDocument, CritClientError>
  readonly activities?: (
    canvasId: string
  ) => Effect.Effect<AgentActivityCollection, CritClientError>
}>()(
  "@riff-refine/crit/CritClient"
) {}
