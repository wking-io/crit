import type { CanvasId } from "@crit/domain"
import { Context, type Effect, type Result } from "effect"

import type { ReplicaState } from "./model.js"

export class ReplicaStore extends Context.Service<ReplicaStore, {
  readonly get: (canvasId: CanvasId) => Effect.Effect<ReplicaState | undefined>
  readonly modify: <A, E>(
    canvasId: CanvasId,
    transition: (state: ReplicaState | undefined) => Result.Result<readonly [A, ReplicaState | undefined], E>
  ) => Effect.Effect<A, E>
}>()("@crit/replica/ReplicaStore") {}
