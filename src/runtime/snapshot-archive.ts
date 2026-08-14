import { Context, Effect, Schema } from "effect"

import type { SnapshotArtifact } from "../core/index.js"

export const CRIT_SNAPSHOT_PATH = "/__crit/snapshots/"

export const snapshotArtifactUrl = (artifactId: string) => {
  if (!/^[a-z0-9-]+$/.test(artifactId)) {
    throw new TypeError("Invalid snapshot artifact id")
  }
  return `${CRIT_SNAPSHOT_PATH}${artifactId}`
}

export class SnapshotCaptureFailed extends Schema.TaggedError<SnapshotCaptureFailed>()(
  "SnapshotCaptureFailed",
  {
    sourceUrl: Schema.String,
    detail: Schema.String
  }
) {}

export class SnapshotNotFound extends Schema.TaggedError<SnapshotNotFound>()(
  "SnapshotNotFound",
  { artifactId: Schema.String }
) {}

export class SnapshotStorageFailed extends Schema.TaggedError<SnapshotStorageFailed>()(
  "SnapshotStorageFailed",
  {
    operation: Schema.String,
    artifactId: Schema.String,
    detail: Schema.String
  }
) {}

export type SnapshotArchiveError =
  | SnapshotCaptureFailed
  | SnapshotNotFound
  | SnapshotStorageFailed

export class SnapshotArchive extends Context.Service<SnapshotArchive, {
  readonly capture: (
    sourceUrl: string
  ) => Effect.Effect<SnapshotArtifact, SnapshotCaptureFailed | SnapshotStorageFailed>
  readonly read: (
    artifactId: string
  ) => Effect.Effect<Uint8Array, SnapshotNotFound | SnapshotStorageFailed>
  /** Deletes an artifact. Removing an absent artifact succeeds. */
  readonly remove: (
    artifactId: string
  ) => Effect.Effect<void, SnapshotStorageFailed>
}>()(
  "@riff-refine/crit/SnapshotArchive"
) {}
