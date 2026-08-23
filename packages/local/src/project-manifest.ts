import { ApplicationId, DomainValue } from "@crit/domain"
import {
  CritProjectManifestV2,
  decodeCritProjectManifestV2,
  encodeCritProjectManifestV2
} from "@crit/protocol"
import {
  Context,
  Crypto,
  Effect,
  FileSystem,
  Layer,
  Match,
  Option,
  Path,
  PlatformError,
  Result,
  Schema
} from "effect"

export const critProjectManifestFile = "crit.manifest.json"
const maxProjectManifestBytes = 1_024

export class ProjectManifestInvalid extends Schema.TaggedError<ProjectManifestInvalid>()(
  "ProjectManifestInvalid",
  { path: Schema.String, reason: Schema.String }
) {}

export class ProjectManifestIoFailure extends Schema.TaggedError<ProjectManifestIoFailure>()(
  "ProjectManifestIoFailure",
  {
    operation: Schema.Literals(["inspect", "read", "generate-identity", "stage", "publish"]),
    path: Schema.String,
    reason: Schema.String
  }
) {}

export const ProjectManifestCreated = Schema.TaggedStruct("created", {
  path: Schema.String,
  manifest: CritProjectManifestV2
})
export type ProjectManifestCreated = typeof ProjectManifestCreated.Type

export const ProjectManifestUnchanged = Schema.TaggedStruct("unchanged", {
  path: Schema.String,
  manifest: CritProjectManifestV2
})
export type ProjectManifestUnchanged = typeof ProjectManifestUnchanged.Type

export const ProjectManifestInitialization = Schema.Union([
  ProjectManifestCreated,
  ProjectManifestUnchanged
])
export type ProjectManifestInitialization = typeof ProjectManifestInitialization.Type

export type ProjectManifestFailure = ProjectManifestInvalid | ProjectManifestIoFailure

export interface LocalProjectManifestService {
  readonly path: string
  readonly read: Effect.Effect<typeof CritProjectManifestV2.Type, ProjectManifestFailure>
  readonly initialize: Effect.Effect<ProjectManifestInitialization, ProjectManifestFailure>
}

const platformReason = (failure: PlatformError.PlatformError) => failure.reason._tag

export class LocalProjectManifest extends Context.Service<
  LocalProjectManifest,
  LocalProjectManifestService
>()("@crit/local/LocalProjectManifest") {
  static readonly layer = (options: { readonly root: string }): Layer.Layer<
    LocalProjectManifest,
    never,
    FileSystem.FileSystem | Path.Path | Crypto.Crypto
  > => Layer.effect(LocalProjectManifest, Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const crypto = yield* Crypto.Crypto
    const manifestPath = path.join(path.resolve(options.root), critProjectManifestFile)
    const ioFailure = (
      operation: ProjectManifestIoFailure["operation"],
      target: string,
      reason: string
    ) => new ProjectManifestIoFailure({ operation, path: target, reason })
    const invalid = (reason: string) => new ProjectManifestInvalid({
      path: manifestPath,
      reason
    })
    const decode = (source: string) => Effect.try({
      try: () => decodeCritProjectManifestV2(JSON.parse(source)),
      catch: () => invalid("Manifest does not match schema version 2")
    })
    const readExisting = Effect.scoped(Effect.gen(function*() {
      const link = yield* fs.readLink(manifestPath).pipe(Effect.result)
      if (Result.isSuccess(link)) {
        return yield* Effect.fail(invalid("Manifest target must be a regular file"))
      }
      const pathStat = yield* fs.stat(manifestPath).pipe(Effect.result)
      if (Result.isFailure(pathStat)) {
        return pathStat.failure.reason._tag === "NotFound"
          ? Option.none()
          : yield* Effect.fail(ioFailure("inspect", manifestPath, platformReason(pathStat.failure)))
      }
      if (pathStat.success.type !== "File") {
        return yield* Effect.fail(invalid("Manifest target must be a regular file"))
      }
      const opened = yield* fs.open(manifestPath, { flag: "r" }).pipe(Effect.result)
      if (Result.isFailure(opened)) {
        return opened.failure.reason._tag === "NotFound"
          ? Option.none()
          : yield* Effect.fail(ioFailure("inspect", manifestPath, platformReason(opened.failure)))
      }
      const file = opened.success
      const info = yield* file.stat.pipe(
        Effect.mapError((failure) => ioFailure("inspect", manifestPath, platformReason(failure)))
      )
      if (info.type !== "File") {
        return yield* Effect.fail(invalid("Manifest target must be a regular file"))
      }
      const buffer = new Uint8Array(maxProjectManifestBytes + 1)
      let total = 0
      while (total < buffer.length) {
        const read = yield* file.read(buffer.subarray(total)).pipe(
          Effect.mapError((failure) => ioFailure("read", manifestPath, platformReason(failure)))
        )
        const count = Number(read)
        if (count === 0) break
        total += count
      }
      if (total > maxProjectManifestBytes) {
        return yield* Effect.fail(invalid("Manifest exceeds the 1024-byte limit"))
      }
      const manifest = yield* decode(new TextDecoder().decode(buffer.subarray(0, total)))
      return Option.some(DomainValue.detach(manifest))
    }))
    const read = readExisting.pipe(Effect.flatMap(Option.match({
      onNone: () => Effect.fail(ioFailure("inspect", manifestPath, "NotFound")),
      onSome: Effect.succeed
    })))
    const generate = crypto.randomUUIDv4.pipe(
      Effect.mapError((failure) => ioFailure(
        "generate-identity",
        manifestPath,
        platformReason(failure)
      )),
      Effect.flatMap((uuid) => Effect.try({
        try: () => CritProjectManifestV2.make({
          schemaVersion: 2,
          applicationId: Schema.decodeUnknownSync(ApplicationId)(`application_${uuid}`)
        }),
        catch: (failure) => ioFailure("generate-identity", manifestPath, String(failure))
      }))
    )
    const publish = (manifest: typeof CritProjectManifestV2.Type) => {
      const stagingPath = path.join(
        path.dirname(manifestPath),
        `.crit-manifest-${manifest.applicationId.slice("application_".length)}.tmp`
      )
      const encoded = `${JSON.stringify(encodeCritProjectManifestV2(manifest))}\n`
      return Effect.scoped(Effect.gen(function*() {
        const file = yield* fs.open(stagingPath, { flag: "wx", mode: 0o644 }).pipe(
          Effect.mapError((failure) => ioFailure("stage", stagingPath, platformReason(failure)))
        )
        yield* Effect.addFinalizer(() => fs.remove(stagingPath, { force: true }).pipe(Effect.ignore))
        yield* file.writeAll(new TextEncoder().encode(encoded)).pipe(
          Effect.mapError((failure) => ioFailure("stage", stagingPath, platformReason(failure)))
        )
        yield* file.sync.pipe(
          Effect.mapError((failure) => ioFailure("stage", stagingPath, platformReason(failure)))
        )
        const linked = yield* fs.link(stagingPath, manifestPath).pipe(Effect.result)
        return yield* Match.value(linked).pipe(
          Match.when({ _tag: "Success" }, () => read.pipe(
            Effect.flatMap((published) => published.applicationId === manifest.applicationId
              ? Effect.succeed(ProjectManifestCreated.make({
                path: manifestPath,
                manifest: published
              }))
              : Effect.fail(invalid("Published manifest did not match generated identity")))
          )),
          Match.when({ _tag: "Failure" }, ({ failure }) => failure.reason._tag === "AlreadyExists"
            ? read.pipe(Effect.map((winner) => ProjectManifestUnchanged.make({
              path: manifestPath,
              manifest: winner
            })))
            : Effect.fail(ioFailure("publish", manifestPath, platformReason(failure)))),
          Match.exhaustive
        )
      }))
    }
    const initialize = readExisting.pipe(
      Effect.flatMap(Option.match({
        onSome: (manifest) => Effect.succeed(ProjectManifestUnchanged.make({
          path: manifestPath,
          manifest
        })),
        onNone: () => generate.pipe(Effect.flatMap(publish))
      }))
    )

    return LocalProjectManifest.of({ path: manifestPath, read, initialize })
  }))
}
