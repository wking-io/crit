import { Context, Effect, Layer } from "effect"

import {
  Canvas,
  CanvasCommand,
  CanvasCommandFailed,
  type CanvasDocument,
  type CanvasDocumentTooLarge,
  type CanvasInvalidDocument,
  type CanvasNotFound,
  type CanvasUnavailable
} from "../core/index.js"
import { CanvasRepository } from "./canvas-repository.js"
import {
  SnapshotArchive,
  snapshotArtifactUrl,
  type SnapshotCaptureFailed,
  type SnapshotNotFound,
  type SnapshotStorageFailed
} from "./snapshot-archive.js"

export type SnapshotFrameError =
  | CanvasNotFound
  | CanvasInvalidDocument
  | CanvasUnavailable
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
          const canvas = Canvas.fromDocument(current)
          const source = yield* Canvas.getFrame(canvas, frameId).pipe(
            Effect.mapError(
              () =>
                new CanvasCommandFailed({
                  canvasId,
                  reason: "frame-not-found",
                  detail: `Frame not found: ${frameId}`
                })
            )
          )
          if (source.snapshot !== undefined) {
            return yield* new CanvasCommandFailed({
              canvasId,
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
          ])
          return mutation.document
        }),
      readArtifact: archive.read
    } satisfies SnapshotServiceShape
  })
)
