import type { CreateCanvasInput } from "@crit/client"
import { CanvasTitle, Id, decodeCanvasProjection } from "@crit/domain"
import { ReplicaView } from "@crit/replica"
import { LocalApiUnauthorized } from "@crit/replica/http"
import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"

import { ensureLocalCanvas, type EnsureLocalCanvasClient } from "../src/index.js"

const canvasId = Id.canvas("canvas_local")
const title = Schema.decodeUnknownSync(CanvasTitle)("Untitled")

const makeView = (cursor: string): ReplicaView =>
  Schema.decodeUnknownSync(ReplicaView)({
    _tag: "replica-view",
    canvasId,
    acknowledgedCursor: cursor,
    projection: decodeCanvasProjection({
      schemaVersion: 3,
      canvasId,
      title: "Untitled",
      frames: [],
      stack: [],
      stackChangedByChangeId: null,
      issuedIds: { frameIds: [] }
    }),
    pending: []
  })

describe("ensureLocalCanvas", () => {
  it("creates the canvas when it is missing", async() => {
    const created = makeView("cursor_created")
    const calls: CreateCanvasInput[] = []
    const client: EnsureLocalCanvasClient = {
      create: (input) => {
        calls.push(input)
        return Effect.succeed(created)
      },
      open: () => Effect.die("open must not run when create succeeds")
    }

    const view = await Effect.runPromise(ensureLocalCanvas({ canvasId, client, title }))

    expect(view).toEqual(created)
    expect(calls).toEqual([{ canvasId, title }])
  })

  it("opens the canvas when create reports it already exists", async() => {
    const opened = makeView("cursor_opened")
    const openedWith: string[] = []
    const client: EnsureLocalCanvasClient = {
      create: () => Effect.fail({ _tag: "canvas-already-exists", canvasId }),
      open: (requested) => {
        openedWith.push(requested)
        return Effect.succeed(opened)
      }
    }

    const view = await Effect.runPromise(ensureLocalCanvas({ canvasId, client, title }))

    expect(view).toEqual(opened)
    expect(openedWith).toEqual([canvasId])
  })

  it("propagates create failures other than canvas-already-exists", async() => {
    const failure = new LocalApiUnauthorized({ message: "Missing or invalid bearer token" })
    const client: EnsureLocalCanvasClient = {
      create: () => Effect.fail(failure),
      open: () => Effect.die("open must not run for other create failures")
    }

    const result = await Effect.runPromise(
      Effect.flip(ensureLocalCanvas({ canvasId, client, title }))
    )

    expect(result).toEqual(failure)
  })
})
