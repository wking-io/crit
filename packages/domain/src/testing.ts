import { Data, Effect, Schema } from "effect"

import type { CanvasChange } from "./command.js"
import { CanvasEngine } from "./engine.js"
import { CanvasProjection } from "./canvas.js"
import { DomainValue } from "./value.js"

export class DomainReplayConformanceFailure extends Data.TaggedError(
  "DomainReplayConformanceFailure"
)<{
  readonly message: string
}> {}

const requireFact = (condition: boolean, message: string) => condition
  ? Effect.void
  : Effect.fail(new DomainReplayConformanceFailure({ message }))

const sameProjection = Schema.toEquivalence(CanvasProjection)

export const DomainReplayConformance = {
  identicalProjection: (input: {
    readonly initial: CanvasProjection
    readonly changes: readonly CanvasChange[]
    readonly expected: CanvasProjection
  }) => Effect.gen(function*() {
    const initial = DomainValue.detach(input.initial)
    const changes = DomainValue.detach(input.changes)
    const result = CanvasEngine.replay(input.initial, input.changes)
    yield* requireFact(result._tag === "replayed", "replay did not succeed")
    if (result._tag !== "replayed") return
    yield* requireFact(
      sameProjection(result.projection, input.expected),
      "replayed projection did not match expected"
    )
    yield* requireFact(
      sameProjection(input.initial, initial),
      "replay mutated the initial projection"
    )
    yield* requireFact(
      JSON.stringify(input.changes) === JSON.stringify(changes),
      "replay mutated accepted changes"
    )
  }),
  rejectedBatchUnchanged: (input: {
    readonly initial: CanvasProjection
    readonly change: CanvasChange
  }) => Effect.gen(function*() {
    const before = DomainValue.detach(input.initial)
    const result = CanvasEngine.apply(input.initial, input.change)
    yield* requireFact(result._tag === "rejected", "batch was not rejected")
    yield* requireFact(
      sameProjection(input.initial, before),
      "rejected batch changed the projection"
    )
  })
}
