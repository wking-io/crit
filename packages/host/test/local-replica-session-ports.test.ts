import { ChangeRejected } from "@crit/authority"
import type { LocalCanvasClientService } from "@crit/client"
import {
  CanvasChangeFailureSchema,
  Id,
  decodeCanvasCommandBatch,
  decodeCanvasProjection
} from "@crit/domain"
import { ReplicaChangeRejected, ReplicaSessionUnavailable } from "@crit/react"
import { ReplicaModel, ReplicaView } from "@crit/replica"
import { LocalApiUnauthorized } from "@crit/replica/http"
import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"

import { localReplicaSessionPorts } from "../src/index.js"

const canvasId = Id.canvas("canvas_review")

const view = Schema.decodeUnknownSync(ReplicaView)({
  _tag: "replica-view",
  canvasId,
  acknowledgedCursor: "cursor_one",
  projection: decodeCanvasProjection({
    schemaVersion: 3,
    canvasId,
    title: "Review",
    frames: [{
      frameId: "frame_checkout",
      title: "Checkout",
      representation: { _tag: "web-url", url: "https://example.com/checkout" },
      status: "in-progress",
      geometry: { x: 40, y: 80, width: 320, height: 200 },
      createdByChangeId: "change_1",
      updatedByChangeId: "change_1",
      titleChangedByChangeId: "change_1",
      representationChangedByChangeId: "change_1",
      statusChangedByChangeId: "change_1",
      geometryChangedByChangeId: "change_1"
    }],
    stack: [{ _tag: "frame", frameId: "frame_checkout" }],
    stackChangedByChangeId: "change_1",
    issuedIds: {
      frameIds: ["frame_checkout"]
    }
  }),
  pending: []
})

const commands = decodeCanvasCommandBatch([{
  _tag: "add-frame",
  frameId: "frame_added",
  title: "Added",
  representation: { _tag: "web-url", url: "https://example.com/added" },
  status: "in-progress",
  geometry: { x: 400, y: 80, width: 320, height: 200 }
}])

const domainFailure = Schema.decodeUnknownSync(CanvasChangeFailureSchema)({
  _tag: "entity-not-found",
  commandIndex: 0,
  entity: "frame",
  id: "frame_missing"
})

const unusedClient = (
  change: LocalCanvasClientService["change"]
): LocalCanvasClientService => ({
  status: () => Effect.die("unused"),
  create: () => Effect.die("unused"),
  open: () => Effect.die("unused"),
  change,
  sync: () => Effect.die("unused"),
  subscribe: () => Effect.die("unused")
})

describe("localReplicaSessionPorts.change", () => {
  it("returns the receipt view from a replica-change payload", async() => {
    const calls: Array<Parameters<LocalCanvasClientService["change"]>[0]> = []
    const receipt = { changeId: Id.change("change_receipt"), view }
    const ports = localReplicaSessionPorts(unusedClient((input) => {
      calls.push(input)
      return Effect.succeed(receipt)
    }))

    const changed = await Effect.runPromise(ports.change({ canvasId, commands }))

    expect(calls).toEqual([ReplicaModel.change({ canvasId, commands })])
    expect(changed).toEqual(receipt.view)
  })

  it("maps change-rejected to ReplicaChangeRejected", async() => {
    const ports = localReplicaSessionPorts(unusedClient(() =>
      Effect.fail(ChangeRejected.make({
        canvasId,
        changeId: Id.change("change_rejected"),
        failure: domainFailure
      }))
    ))

    const failure = await Effect.runPromise(Effect.flip(ports.change({ canvasId, commands })))

    expect(failure).toEqual(new ReplicaChangeRejected({
      canvasId,
      failure: domainFailure
    }))
  })

  it("maps transport failures with the open copy", async() => {
    const ports = localReplicaSessionPorts(unusedClient(() =>
      Effect.fail(new LocalApiUnauthorized({ message: "Missing or invalid bearer token" }))
    ))

    const failure = await Effect.runPromise(Effect.flip(ports.change({ canvasId, commands })))

    expect(failure).toEqual(new ReplicaSessionUnavailable({
      canvasId,
      reason: "The browser session is no longer authorized."
    }))
  })
})
