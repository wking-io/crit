import { Context, Effect } from "effect"

import type { CanvasCommand, CanvasDocument } from "../core/index.js"
import type { AgentActivityStatus } from "../runtime/agent-activity.js"
import type { CritClientError } from "../runtime/canvas-failure.js"

export {
  CritClientCommandFailed,
  CritClientErrorSchema,
  CritClientInvalidDocument,
  CritClientNotFound,
  CritClientUnavailable,
  type CritClientError
} from "../runtime/canvas-failure.js"

export interface CritClientShape {
  readonly load: (id: string) => Effect.Effect<CanvasDocument, CritClientError>
  readonly apply: (
    id: string,
    commands: ReadonlyArray<CanvasCommand>
  ) => Effect.Effect<CanvasDocument, CritClientError>
  readonly snapshot?: (
    canvasId: string,
    frameId: string
  ) => Effect.Effect<CanvasDocument, CritClientError>
  readonly activity?: (
    canvasId: string
  ) => Effect.Effect<AgentActivityStatus, CritClientError>
}

export class CritClient extends Context.Service<CritClient, CritClientShape>()(
  "@riff-refine/crit/CritClient"
) {}
