import { Context, Effect, Layer } from "effect"

import {
  Canvas,
  CanvasCommand,
  type CanvasDocument
} from "../core/index.js"
import { CanvasRepository } from "./canvas-repository.js"
import {
  CritClientCommandFailed,
  CritClientUnavailable,
  type CritClientError
} from "./canvas-failure.js"
import {
  SnapshotArchive,
  snapshotArtifactUrl,
  type SnapshotNotFound,
  type SnapshotStorageFailed
} from "./snapshot-archive.js"

export type SnapshotFrameError = CritClientError

export class SnapshotService extends Context.Service<SnapshotService, {
  readonly snapshotFrame: (
    canvasId: string,
    frameId: string
  ) => Effect.Effect<CanvasDocument, SnapshotFrameError>
  readonly readArtifact: (
    artifactId: string
  ) => Effect.Effect<Uint8Array, SnapshotNotFound | SnapshotStorageFailed>
}>()(
  "@riff-refine/crit/SnapshotService"
) {}

export const SnapshotServiceLive = Layer.effect(
  SnapshotService,
  Effect.gen(function*() {
    const canvases = yield* CanvasRepository
    const archive = yield* SnapshotArchive

    return {
      snapshotFrame: (canvasId, frameId) =>
        Effect.gen(function*() {
          const current = yield* canvases.load(canvasId)
          const canvas = Canvas.fromDocument(current)
          const source = yield* Canvas.getFrame(canvas, frameId).pipe(
            Effect.mapError(
              () =>
                new CritClientCommandFailed({
                  id: canvasId,
                  reason: "frame-not-found",
                  detail: `Frame not found: ${frameId}`
                })
            )
          )
          if (source.snapshot !== undefined) {
            return yield* new CritClientCommandFailed({
              id: canvasId,
              reason: "snapshot-source-invalid",
              detail: `Frame is already a snapshot: ${frameId}`
            })
          }
          const artifact = yield* archive.capture(source.url).pipe(
            Effect.mapError(
              (cause) =>
                new CritClientUnavailable({
                  operation: "snapshot",
                  id: canvasId,
                  detail: cause.detail
                })
            )
          )
          const mutation = yield* canvases.apply(canvasId, [
            CanvasCommand.addSnapshotFrame({
              id: `snapshot-${artifact.artifactId}`,
              sourceFrameId: frameId,
              expectedSourceUrl: source.url,
              url: snapshotArtifactUrl(artifact.artifactId),
              artifact
            })
          ]).pipe(
            // A rejected commit (for example snapshot-source-changed) must not
            // leave the just-captured artifact orphaned on disk. Cleanup is
            // best effort: the commit failure is what the caller must see.
            Effect.onError(() =>
              archive.remove(artifact.artifactId).pipe(Effect.ignore)
            )
          )
          return mutation.document
        }),
      readArtifact: archive.read
    } satisfies SnapshotService["Service"]
  })
)
