import { Context, Effect } from "effect"

import type { CanvasCommand, CanvasDocument, CanvasError } from "../core/index.js"
import type { AgentActivityStatus } from "../runtime/agent-activity.js"
import type {
  SnapshotCaptureFailed,
  SnapshotStorageFailed
} from "../runtime/snapshot-archive.js"

// The client speaks the core Canvas failure vocabulary directly; snapshot
// capture composes its own two failure modes on top for the snapshot
// operation. There is no client-specific error renaming.
export type CritClientError = CanvasError

export type CritClientSnapshotError =
  | CanvasError
  | SnapshotCaptureFailed
  | SnapshotStorageFailed

export interface CritClientShape {
  readonly load: (id: string) => Effect.Effect<CanvasDocument, CritClientError>
  readonly apply: (
    id: string,
    commands: ReadonlyArray<CanvasCommand>
  ) => Effect.Effect<CanvasDocument, CritClientError>
  readonly snapshot?: (
    canvasId: string,
    frameId: string
  ) => Effect.Effect<CanvasDocument, CritClientSnapshotError>
  readonly activity?: (
    canvasId: string
  ) => Effect.Effect<AgentActivityStatus, CritClientError>
}

export class CritClient extends Context.Service<CritClient, CritClientShape>()(
  "@riff-refine/crit/CritClient"
) {}
