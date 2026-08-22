import { ArtifactRepresentation, Id, Sha256Digest } from "@crit/domain"
import { Data, Effect, Layer, Schema } from "effect"

import { ArtifactStore } from "./store.js"

export class ArtifactStoreConformanceFailure extends Data.TaggedError("ArtifactStoreConformanceFailure")<{
  readonly message: string
}> {}

const requireFact = (condition: boolean, message: string) => condition
  ? Effect.void
  : Effect.fail(new ArtifactStoreConformanceFailure({ message }))

const bytes = (...values: ReadonlyArray<number>) => Uint8Array.from(values)

export interface ArtifactStoreConformanceScenario {
  readonly name: string
  readonly run: Effect.Effect<void, unknown, ArtifactStore>
}

export const artifactStoreConformanceScenarios = (): readonly ArtifactStoreConformanceScenario[] => [{
  name: "stores owned bytes and returns detached reads",
  run: Effect.gen(function*() {
    const store = yield* ArtifactStore
    const artifactId = Id.artifact("artifact_conformance_owned")
    const input = bytes(1, 2, 3)
    const stored = yield* store.put({ artifactId, bytes: input })
    input[0] = 9
    const first = yield* store.read(stored)
    yield* requireFact(first[0] === 1, "put retained caller-owned bytes")
    first[0] = 8
    const second = yield* store.read(stored)
    yield* requireFact(second[0] === 1, "read exposed store-owned bytes")
  })
}, {
  name: "converges identical puts and rejects conflicting bytes",
  run: Effect.gen(function*() {
    const store = yield* ArtifactStore
    const artifactId = Id.artifact("artifact_conformance_immutable")
    const first = yield* store.put({ artifactId, bytes: bytes(4, 5, 6) })
    const repeated = yield* store.put({ artifactId, bytes: bytes(4, 5, 6) })
    yield* requireFact(first.digest === repeated.digest, "identical put changed its representation")
    const conflict = yield* store.put({ artifactId, bytes: bytes(6, 5, 4) }).pipe(Effect.result)
    yield* requireFact(conflict._tag === "Failure" && conflict.failure._tag === "ArtifactConflict", "conflicting put replaced immutable content")
    const retained = yield* store.read(first)
    yield* requireFact(retained[0] === 4, "conflicting put changed stored bytes")
  })
}, {
  name: "requires the authoritative digest for reads",
  run: Effect.gen(function*() {
    const store = yield* ArtifactStore
    const artifactId = Id.artifact("artifact_conformance_digest")
    yield* store.put({ artifactId, bytes: bytes(7, 8, 9) })
    const wrong = ArtifactRepresentation.make({
      artifactId,
      digest: Schema.decodeUnknownSync(Sha256Digest)(`sha256:${"0".repeat(64)}`)
    })
    const corruptRead = yield* store.read(wrong).pipe(Effect.result)
    yield* requireFact(corruptRead._tag === "Failure" && corruptRead.failure._tag === "ArtifactCorrupt", "read accepted a mismatched digest")
  })
}]

export const runArtifactStoreConformance = <E, R>(
  layer: Layer.Layer<ArtifactStore, E, R>
): Effect.Effect<void, unknown | E, R> => Effect.forEach(
  artifactStoreConformanceScenarios(),
  (scenario) => scenario.run.pipe(Effect.provide(layer)),
  { discard: true }
)
