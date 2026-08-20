import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { Canvas, CanvasCommand } from "../../src/core/index.js"

describe("Canvas snapshot Frames", () => {
  it.effect("adds an immutable archived Frame beside its live source", () =>
    Effect.gen(function*() {
      const canvas = Canvas.create({ id: "review", title: "Review", owner: { id: "git:test", name: "Test Author" } })
      yield* Canvas.apply(
        canvas,
        CanvasCommand.addFrame({
          id: "candidate",
          url: "https://app.localhost/candidate",
          title: "Candidate",
          provenance: { kind: "agent", sourceId: "codex" }
        }),
        CanvasCommand.moveFrame({ id: "candidate", x: 120, y: 240 }),
        CanvasCommand.addSnapshotFrame({
          id: "snapshot-20260808120000-deadbeef",
          sourceFrameId: "candidate",
          expectedSourceUrl: "https://app.localhost/candidate",
          url: "/__crit/snapshots/20260808120000-deadbeef",
          artifact: {
            artifactId: "20260808120000-deadbeef",
            sourceUrl: "https://app.localhost/candidate",
            capturedAt: "2026-08-08T12:00:00.000Z",
            sizeBytes: 512
          }
        })
      )

      expect(Canvas.listFrames(canvas)).toMatchObject([
        { id: "candidate", status: "in-progress" },
        {
          id: "snapshot-20260808120000-deadbeef",
          url: "/__crit/snapshots/20260808120000-deadbeef",
          title: "Candidate",
          status: "archived",
          provenance: { kind: "snapshot", sourceId: "candidate" },
          snapshot: {
            artifactId: "20260808120000-deadbeef",
            sourceUrl: "https://app.localhost/candidate",
            capturedAt: "2026-08-08T12:00:00.000Z",
            sizeBytes: 512
          },
          geometry: { x: 1360, y: 240, width: 1200, height: 800 }
        }
      ])

      const immutable = yield* Effect.flip(
        Canvas.apply(
          canvas,
          CanvasCommand.setFrameSource({
            id: "snapshot-20260808120000-deadbeef",
            url: "https://app.localhost/replaced",
            provenance: { kind: "agent", sourceId: "codex" }
          })
        )
      )
      expect(immutable).toMatchObject({
        reason: "snapshot-frame-immutable"
      })
      expect(Canvas.listFrames(canvas)[1]?.url).toBe(
        "/__crit/snapshots/20260808120000-deadbeef"
      )
    }))

  it.effect("rejects a capture when the source URL changed", () =>
    Effect.gen(function*() {
      const canvas = Canvas.create({ id: "review", title: "Review", owner: { id: "git:test", name: "Test Author" } })
      yield* Canvas.apply(
        canvas,
        CanvasCommand.addFrame({
          id: "candidate",
          url: "https://app.localhost/new",
          title: "Candidate",
          provenance: { kind: "agent", sourceId: "codex" }
        })
      )
      const before = Canvas.export(canvas)
      const failure = yield* Effect.flip(
        Canvas.apply(
          canvas,
          CanvasCommand.addSnapshotFrame({
            id: "snapshot-artifact",
            sourceFrameId: "candidate",
            expectedSourceUrl: "https://app.localhost/old",
            url: "/__crit/snapshots/artifact",
            artifact: {
              artifactId: "artifact",
              sourceUrl: "https://app.localhost/old",
              capturedAt: "2026-08-08T12:00:00.000Z",
              sizeBytes: 10
            }
          })
        )
      )

      expect(failure).toMatchObject({
        _tag: "CanvasCommandFailed",
        reason: "snapshot-source-changed"
      })
      expect(Canvas.export(canvas)).toEqual(before)
    }))
})
