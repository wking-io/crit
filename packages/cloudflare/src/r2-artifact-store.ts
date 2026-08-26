import { ArtifactRepresentation, Sha256Digest, type ArtifactId } from "@crit/domain"
import {
  ArtifactConflict,
  ArtifactCorrupt,
  ArtifactNotFound,
  ArtifactStore,
  ArtifactStoreIoFailure
} from "@crit/representations"
import { Effect, Layer, Schema } from "effect"

const hex = (input: Uint8Array) =>
  Array.from(input, (value) => value.toString(16).padStart(2, "0")).join("")

const ioFailure = (artifactId: ArtifactId, operation: "put" | "read", reason: string) =>
  new ArtifactStoreIoFailure({ artifactId, operation, reason })

const sha256 = (bytes: Uint8Array, artifactId: ArtifactId, operation: "put" | "read") =>
  Effect.tryPromise({
    try: async () => {
      const hashed = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))
      return Schema.decodeUnknownSync(Sha256Digest)(`sha256:${hex(hashed)}`)
    },
    catch: (cause) => ioFailure(
      artifactId,
      operation,
      cause instanceof Error ? cause.message : "digest failed"
    )
  })

const make = (bucket: R2Bucket): ArtifactStore["Service"] => ArtifactStore.of({
  put: (input) => {
    const owned = Uint8Array.from(input.bytes)
    return Effect.gen(function*() {
      const digest = yield* sha256(owned, input.artifactId, "put")
      const artifact = ArtifactRepresentation.make({
        artifactId: input.artifactId,
        digest
      })
      const written = yield* Effect.tryPromise({
        try: async () => {
          try {
            return await bucket.put(input.artifactId, owned, {
              onlyIf: { etagDoesNotMatch: "*" }
            })
          } catch {
            return null
          }
        },
        catch: (cause) => ioFailure(
          input.artifactId,
          "put",
          cause instanceof Error ? cause.message : "put failed"
        )
      })
      if (written !== null) return artifact
      const stored = yield* Effect.tryPromise({
        try: async () => bucket.get(input.artifactId),
        catch: (cause) => ioFailure(
          input.artifactId,
          "put",
          cause instanceof Error ? cause.message : "get failed"
        )
      })
      if (stored === null) {
        return yield* Effect.fail(ioFailure(input.artifactId, "put", "missing after conflict"))
      }
      const storedBytes = new Uint8Array(yield* Effect.tryPromise({
        try: async () => stored.arrayBuffer(),
        catch: (cause) => ioFailure(
          input.artifactId,
          "put",
          cause instanceof Error ? cause.message : "read failed"
        )
      }))
      const storedDigest = yield* sha256(storedBytes, input.artifactId, "put")
      return storedDigest === digest
        ? artifact
        : yield* Effect.fail(new ArtifactConflict({
          artifactId: input.artifactId,
          storedDigest,
          suppliedDigest: digest
        }))
    })
  },
  read: (artifact) => Effect.gen(function*() {
    const stored = yield* Effect.tryPromise({
      try: async () => bucket.get(artifact.artifactId),
      catch: (cause) => ioFailure(
        artifact.artifactId,
        "read",
        cause instanceof Error ? cause.message : "get failed"
      )
    })
    if (stored === null) {
      return yield* Effect.fail(new ArtifactNotFound({ artifact }))
    }
    const bytes = new Uint8Array(yield* Effect.tryPromise({
      try: async () => stored.arrayBuffer(),
      catch: (cause) => ioFailure(
        artifact.artifactId,
        "read",
        cause instanceof Error ? cause.message : "read failed"
      )
    }))
    const actualDigest = yield* sha256(bytes, artifact.artifactId, "read")
    return actualDigest === artifact.digest
      ? bytes
      : yield* Effect.fail(new ArtifactCorrupt({ artifact, actualDigest }))
  })
})

export const R2ArtifactStore = {
  make,
  layer: (bucket: R2Bucket): Layer.Layer<ArtifactStore> =>
    Layer.succeed(ArtifactStore, make(bucket))
}
