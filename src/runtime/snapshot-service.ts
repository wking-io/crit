import { Context, Effect, Layer } from "effect"

import {
  Canvas,
  CanvasCommand,
  CanvasCommandFailed,
  type CanvasDocument,
  type CanvasDocumentTooLarge
} from "../core/index.js"
import {
  CanvasRepository,
  DocumentMalformed,
  type DocumentNotFound,
  type DocumentStorageFailed
} from "./canvas-repository.js"
import {
  SnapshotArchive,
  snapshotArtifactUrl,
  type SnapshotCaptureFailed,
  type SnapshotNotFound,
  type SnapshotStorageFailed
} from "./snapshot-archive.js"

export type SnapshotFrameError =
  | DocumentNotFound
  | DocumentMalformed
  | DocumentStorageFailed
  | CanvasCommandFailed
  | CanvasDocumentTooLarge
  | SnapshotCaptureFailed
  | SnapshotStorageFailed

export interface SnapshotServiceShape {
  readonly snapshotFrame: (
    canvasId: string,
    frameId: string
  ) => Effect.Effect<CanvasDocument, SnapshotFrameError>
  readonly readArtifact: (
    artifactId: string
  ) => Effect.Effect<Uint8Array, SnapshotNotFound | SnapshotStorageFailed>
}

export class SnapshotService extends Context.Service<SnapshotService, SnapshotServiceShape>()(
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
          const canvas = yield* Canvas.open(current).pipe(
            Effect.mapError(
              (cause) =>
                new DocumentMalformed({
                  id: canvasId,
                  detail:
                    cause._tag === "CanvasOpenFailed"
                      ? cause.detail
                      : `Canvas Document is ${cause.actualBytes} bytes; maximum is ${cause.maxBytes}`
                })
            )
          )
          const source = yield* Canvas.getFrame(canvas, frameId).pipe(
            Effect.mapError(
              () =>
                new CanvasCommandFailed({
                  reason: "frame-not-found",
                  detail: `Frame not found: ${frameId}`
                })
            )
          )
          if (source.snapshot !== undefined) {
            return yield* new CanvasCommandFailed({
              reason: "snapshot-source-invalid",
              detail: `Frame is already a snapshot: ${frameId}`
            })
          }
          const artifact = yield* archive.capture(source.url)
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
    } satisfies SnapshotServiceShape
  })
)
