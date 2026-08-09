import { Context, Effect, Schema } from "effect"

import { FrameSnapshot } from "../core/index.js"

export const CRIT_SNAPSHOT_PATH = "/__crit/snapshots/"

export const snapshotArtifactUrl = (artifactId: string) => {
  if (!/^[a-z0-9-]+$/.test(artifactId)) {
    throw new TypeError("Invalid snapshot artifact id")
  }
  return `${CRIT_SNAPSHOT_PATH}${artifactId}`
}

export const SnapshotArtifact = FrameSnapshot
export type SnapshotArtifact = typeof SnapshotArtifact.Type

export class SnapshotCaptureFailed extends Schema.TaggedError<SnapshotCaptureFailed>()(
  "SnapshotCaptureFailed",
  {
    sourceUrl: Schema.String,
    detail: Schema.String
  }
) {
  override get message(): string {
    return this.detail
  }
}

export class SnapshotNotFound extends Schema.TaggedError<SnapshotNotFound>()(
  "SnapshotNotFound",
  { artifactId: Schema.String }
) {
  override get message(): string {
    return `Snapshot artifact not found: ${this.artifactId}`
  }
}

export class SnapshotStorageFailed extends Schema.TaggedError<SnapshotStorageFailed>()(
  "SnapshotStorageFailed",
  {
    operation: Schema.String,
    artifactId: Schema.String,
    detail: Schema.String
  }
) {
  override get message(): string {
    return this.detail
  }
}

export type SnapshotArchiveError =
  | SnapshotCaptureFailed
  | SnapshotNotFound
  | SnapshotStorageFailed

export interface SnapshotArchiveShape {
  readonly capture: (
    sourceUrl: string
  ) => Effect.Effect<SnapshotArtifact, SnapshotCaptureFailed | SnapshotStorageFailed>
  readonly read: (
    artifactId: string
  ) => Effect.Effect<Uint8Array, SnapshotNotFound | SnapshotStorageFailed>
}

export class SnapshotArchive extends Context.Service<SnapshotArchive, SnapshotArchiveShape>()(
  "@riff-refine/crit/SnapshotArchive"
) {}
