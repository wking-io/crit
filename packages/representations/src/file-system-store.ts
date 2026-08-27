import { ArtifactRepresentation, Sha256Digest, type ArtifactId } from "@crit/domain"
import { Crypto, Data, Effect, FileSystem, Layer, Path, PlatformError, Predicate, Result, Schema } from "effect"

import {
  ArtifactConflict,
  ArtifactCorrupt,
  ArtifactNotFound,
  ArtifactStore,
  ArtifactStoreIoFailure
} from "./store.js"

export interface FileSystemArtifactStoreOptions {
  readonly directory: string
}

export class FileSystemArtifactStoreOpenFailure extends Data.TaggedError("FileSystemArtifactStoreOpenFailure")<{
  readonly directory: string
  readonly reason: string
}> {}

const hex = (input: Uint8Array) => Array.from(input, (value) => value.toString(16).padStart(2, "0")).join("")

const platformReason = (failure: PlatformError.PlatformError) => failure.reason._tag

const isReason = (failure: PlatformError.PlatformError, tag: PlatformError.SystemErrorTag) =>
  Predicate.isTagged(failure.reason, tag)

const ensureDirectory = (fs: FileSystem.FileSystem, directory: string) => fs.makeDirectory(directory, {
  recursive: true
}).pipe(Effect.mapError((failure) => new FileSystemArtifactStoreOpenFailure({
  directory,
  reason: platformReason(failure)
})))

const makeStore = (options: FileSystemArtifactStoreOptions) => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const crypto = yield* Crypto.Crypto
  const makeDigest = Effect.fn("FileSystemArtifactStore.digest")(function*(bytes: Uint8Array) {
    const digest = yield* crypto.digest("SHA-256", bytes)
    return Schema.decodeUnknownSync(Sha256Digest)(`sha256:${hex(digest)}`)
  })
  const storeDirectory = path.join(options.directory, ".crit-artifact-store")
  const artifactsDirectory = path.join(storeDirectory, "artifacts")
  const stagingDirectory = path.join(storeDirectory, "staging")
  yield* ensureDirectory(fs, artifactsDirectory)
  yield* ensureDirectory(fs, stagingDirectory)

  const artifactPath = (artifactId: ArtifactId) => path.join(artifactsDirectory, artifactId)
  const ioFailure = (artifactId: ArtifactId, operation: "put" | "read", reason: string) =>
    new ArtifactStoreIoFailure({ artifactId, operation, reason })
  const readStored = (artifactId: ArtifactId, operation: "put" | "read") => fs.readFile(
    artifactPath(artifactId)
  ).pipe(Effect.mapError((failure) => ioFailure(artifactId, operation, platformReason(failure))))

  const read: ArtifactStore["Service"]["read"] = (artifact) => fs.readFile(
    artifactPath(artifact.artifactId)
  ).pipe(
    Effect.mapError((failure) => isReason(failure, "NotFound")
      ? new ArtifactNotFound({ artifact })
      : ioFailure(artifact.artifactId, "read", platformReason(failure))),
    Effect.flatMap((stored) => makeDigest(stored).pipe(
      Effect.mapError((failure) => ioFailure(artifact.artifactId, "read", platformReason(failure))),
      Effect.flatMap((actualDigest) => actualDigest === artifact.digest
        ? Effect.succeed(Uint8Array.from(stored))
        : Effect.fail(new ArtifactCorrupt({ artifact, actualDigest })))
    ))
  )

  const put: ArtifactStore["Service"]["put"] = (input) => {
    const owned = Uint8Array.from(input.bytes)
    return Effect.gen(function*() {
      const digest = yield* makeDigest(owned).pipe(
        Effect.mapError((failure) => ioFailure(input.artifactId, "put", platformReason(failure)))
      )
      const artifact = ArtifactRepresentation.make({ artifactId: input.artifactId, digest })
      const suffix = yield* crypto.randomUUIDv4.pipe(
        Effect.mapError((failure) => ioFailure(input.artifactId, "put", platformReason(failure)))
      )
      const stagingPath = path.join(stagingDirectory, `${input.artifactId}-${suffix}`)
      return yield* Effect.acquireUseRelease(
        Effect.succeed(stagingPath),
        (temporary) => Effect.scoped(Effect.gen(function*() {
          const file = yield* fs.open(temporary, { flag: "wx" }).pipe(
            Effect.mapError((failure) => ioFailure(input.artifactId, "put", platformReason(failure)))
          )
          yield* file.writeAll(owned).pipe(
            Effect.mapError((failure) => ioFailure(input.artifactId, "put", platformReason(failure)))
          )
          yield* file.sync.pipe(
            Effect.mapError((failure) => ioFailure(input.artifactId, "put", platformReason(failure)))
          )
          const published = yield* fs.link(temporary, artifactPath(input.artifactId)).pipe(Effect.result)
          if (Result.isSuccess(published)) return artifact
          if (!isReason(published.failure, "AlreadyExists")) {
            return yield* Effect.fail(ioFailure(input.artifactId, "put", platformReason(published.failure)))
          }
          const existing = yield* readStored(input.artifactId, "put")
          const storedDigest = yield* makeDigest(existing).pipe(
            Effect.mapError((failure) => ioFailure(input.artifactId, "put", platformReason(failure)))
          )
          return storedDigest === digest
            ? artifact
            : yield* Effect.fail(new ArtifactConflict({
              artifactId: input.artifactId,
              storedDigest,
              suppliedDigest: digest
            }))
        })),
        (temporary) => fs.remove(temporary, { force: true }).pipe(Effect.ignore)
      )
    })
  }

  return ArtifactStore.of({ put, read })
})

export const FileSystemArtifactStore = {
  layer: (options: FileSystemArtifactStoreOptions): Layer.Layer<
    ArtifactStore,
    FileSystemArtifactStoreOpenFailure,
    FileSystem.FileSystem | Path.Path | Crypto.Crypto
  > => Layer.effect(ArtifactStore, makeStore(options))
}
