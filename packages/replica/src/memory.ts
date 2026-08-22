import type { CanvasId } from "@crit/domain"
import { Effect, Layer, Result, SynchronizedRef } from "effect"

import type { ReplicaState } from "./model.js"
import { CanvasReplicaLive } from "./service.js"
import { ReplicaStore } from "./store.js"

type Registry = ReadonlyMap<CanvasId, SynchronizedRef.SynchronizedRef<ReplicaState | undefined>>

const store = Effect.gen(function*() {
  const registry = yield* SynchronizedRef.make<Registry>(new Map())
  const cell = (canvasId: CanvasId) => SynchronizedRef.modify(registry, (current) => {
    const existing = current.get(canvasId)
    if (existing !== undefined) return [existing, current] as const
    const created = SynchronizedRef.makeUnsafe<ReplicaState | undefined>(undefined)
    return [created, new Map(current).set(canvasId, created)] as const
  })
  return {
    get: (canvasId) => cell(canvasId).pipe(Effect.flatMap(SynchronizedRef.get)),
    modify: <A, E>(canvasId: CanvasId, transition: (state: ReplicaState | undefined) => Result.Result<readonly [A, ReplicaState | undefined], E>) => cell(canvasId).pipe(
      Effect.flatMap((state) => SynchronizedRef.modify<ReplicaState | undefined, Result.Result<A, E>>(state, (current): readonly [Result.Result<A, E>, ReplicaState | undefined] => {
        const result = transition(current)
        return result._tag === "Success"
          ? [Result.succeed(result.success[0]), result.success[1]] as const
          : [Result.fail(result.failure), current] as const
      })),
      Effect.flatMap((result) => result._tag === "Success" ? Effect.succeed(result.success) : Effect.fail(result.failure))
    )
  } satisfies ReplicaStore["Service"]
})

export const MemoryReplicaStore = Layer.effect(ReplicaStore, store)
export const MemoryCanvasReplicaLive = CanvasReplicaLive.pipe(Layer.provide(MemoryReplicaStore))
