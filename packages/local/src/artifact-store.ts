import { constants } from "node:fs"
import { lstat, open as openNode, type FileHandle } from "node:fs/promises"

import { ArtifactRepresentation, Sha256Digest, type ArtifactId } from "@crit/domain"
import {
  ArtifactConflict,
  ArtifactCorrupt,
  ArtifactNotFound,
  ArtifactStore,
  ArtifactStoreIoFailure
} from "@crit/representations"
import { NodeCrypto, NodeFileSystem, NodePath } from "@effect/platform-node"
import { Crypto, Data, Effect, FileSystem, Layer, Path, PlatformError, Schema } from "effect"

export interface LocalArtifactStoreOptions {
  readonly directory: string
}

export class LocalArtifactStoreOpenFailure extends Data.TaggedError("LocalArtifactStoreOpenFailure")<{
  readonly directory: string
  readonly reason: string
}> {}

const hex = (input: Uint8Array) => Array.from(input, (value) => value.toString(16).padStart(2, "0")).join("")

const platformReason = (failure: PlatformError.PlatformError) => failure.reason._tag

const isReason = (failure: PlatformError.PlatformError, tag: PlatformError.SystemErrorTag) =>
  failure.reason._tag === tag

const Errno = Schema.Struct({ code: Schema.String })
const isErrno = Schema.is(Errno)

const errnoCode = (cause: unknown): string | undefined => {
  if (!isErrno(cause)) return undefined
  return cause.code
}

const entryKind = (entryPath: string) => Effect.tryPromise({
  try: () => lstat(entryPath),
  catch: (cause) => errnoCode(cause) === "ENOENT" ? "missing" : "inspection-failed"
}).pipe(Effect.map((entry) => entry.isSymbolicLink()
  ? "symlink" as const
  : entry.isDirectory()
  ? "directory" as const
  : entry.isFile()
  ? "regular" as const
  : "special" as const),
Effect.catch((reason) => reason === "missing"
  ? Effect.succeed("missing" as const)
  : Effect.fail(reason)))

const ensureDirectory = (fs: FileSystem.FileSystem, directory: string) => fs.makeDirectory(directory, {
  recursive: true
}).pipe(
  Effect.mapError((failure) => new LocalArtifactStoreOpenFailure({
    directory,
    reason: platformReason(failure)
  })),
  Effect.flatMap(() => entryKind(directory).pipe(
    Effect.mapError((reason) => new LocalArtifactStoreOpenFailure({ directory, reason }))
  )),
  Effect.flatMap((kind) => kind === "directory"
    ? Effect.void
    : Effect.fail(new LocalArtifactStoreOpenFailure({ directory, reason: `store-path-${kind}` })))
)

const syncDirectory = (directory: string) => Effect.tryPromise({
  try: async() => {
    const handle = await openNode(directory, "r")
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  },
  catch: (cause) => `directory-sync-${errnoCode(cause) ?? "failed"}`
})

const closeHandle = (handle: FileHandle) => Effect.promise(() => handle.close()).pipe(Effect.ignore)

const readRegularNoFollow = (entryPath: string) => Effect.acquireUseRelease(
  Effect.tryPromise({
    try: () => openNode(entryPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK),
    catch: (cause) => {
      const code = errnoCode(cause)
      return code === "ENOENT"
        ? "missing"
        : code === "ELOOP"
        ? "final-entry-symlink"
        : `final-entry-open-${code ?? "failed"}`
    }
  }),
  (handle) => Effect.gen(function*() {
    const info = yield* Effect.tryPromise({
      try: () => handle.stat(),
      catch: (cause) => `final-entry-stat-${errnoCode(cause) ?? "failed"}`
    })
    if (!info.isFile()) return yield* Effect.fail("final-entry-non-regular")
    const bytes = yield* Effect.tryPromise({
      try: () => handle.readFile(),
      catch: (cause) => `final-entry-read-${errnoCode(cause) ?? "failed"}`
    })
    return Uint8Array.from(bytes)
  }),
  closeHandle
)

const makeStore = (options: LocalArtifactStoreOptions) => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const crypto = yield* Crypto.Crypto
  const makeDigest = Effect.fn("LocalArtifactStore.digest")(function*(bytes: Uint8Array) {
    const digest = yield* crypto.digest("SHA-256", bytes)
    return Schema.decodeUnknownSync(Sha256Digest)(`sha256:${hex(digest)}`)
  })
  const storeDirectory = path.join(options.directory, ".crit-artifact-store")
  const artifactsDirectory = path.join(storeDirectory, "artifacts")
  const stagingDirectory = path.join(storeDirectory, "staging")
  yield* ensureDirectory(fs, storeDirectory)
  yield* ensureDirectory(fs, artifactsDirectory)
  yield* ensureDirectory(fs, stagingDirectory)

  const artifactPath = (artifactId: ArtifactId) => path.join(artifactsDirectory, artifactId)
  const ioFailure = (artifactId: ArtifactId, operation: "put" | "read", reason: string) =>
    new ArtifactStoreIoFailure({ artifactId, operation, reason })

  const readBytes = (artifact: ArtifactRepresentation) => readRegularNoFollow(
    artifactPath(artifact.artifactId)
  ).pipe(
    Effect.mapError((reason) => reason === "missing"
        ? new ArtifactNotFound({ artifact })
        : ioFailure(artifact.artifactId, "read", reason)),
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
          if (published._tag === "Success") {
            yield* syncDirectory(artifactsDirectory).pipe(
              Effect.mapError((reason) => ioFailure(input.artifactId, "put", reason))
            )
            return artifact
          }
          if (!isReason(published.failure, "AlreadyExists")) {
            return yield* Effect.fail(ioFailure(input.artifactId, "put", platformReason(published.failure)))
          }
          const existing = yield* readRegularNoFollow(artifactPath(input.artifactId)).pipe(
            Effect.mapError((reason) => ioFailure(
              input.artifactId,
              "put",
              reason === "missing" ? "published-entry-disappeared" : reason
            ))
          )
          const storedDigest = yield* makeDigest(existing).pipe(
            Effect.mapError((failure) => ioFailure(input.artifactId, "put", platformReason(failure)))
          )
          if (storedDigest === digest) {
            yield* syncDirectory(artifactsDirectory).pipe(
              Effect.mapError((reason) => ioFailure(input.artifactId, "put", reason))
            )
            return artifact
          }
          return yield* Effect.fail(new ArtifactConflict({
            artifactId: input.artifactId,
            storedDigest,
            suppliedDigest: digest
          }))
        })),
        (temporary) => fs.remove(temporary, { force: true }).pipe(Effect.ignore)
      )
    })
  }

  const read: ArtifactStore["Service"]["read"] = (artifact) => readBytes(artifact)

  return ArtifactStore.of({ put, read })
})

const platformLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, NodeCrypto.layer)

export const LocalArtifactStore = {
  layer: (options: LocalArtifactStoreOptions): Layer.Layer<ArtifactStore, LocalArtifactStoreOpenFailure> =>
    Layer.effect(ArtifactStore, makeStore(options)).pipe(Layer.provide(platformLayer))
}
