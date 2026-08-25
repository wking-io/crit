import { ChangeRejected } from "@crit/authority"
import type { LocalCanvasClientService } from "@crit/client"
import {
  CanvasChangeFailureSchema,
  Id,
  decodeCanvasCommandBatch,
  decodeCanvasProjection
} from "@crit/domain"
import {
  ReplicaChangeRejected,
  ReplicaSessionUnavailable,
  ReplicaSubscriptionEvent
} from "@crit/react"
import { ReplicaModel, ReplicaView } from "@crit/replica"
import { LocalApiUnauthorized } from "@crit/replica/http"
import { Effect, Schema, Stream } from "effect"
import { describe, expect, it, vi } from "vitest"

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

const subscriptionClient = (args: {
  readonly open: LocalCanvasClientService["open"]
  readonly subscribe: LocalCanvasClientService["subscribe"]
}): LocalCanvasClientService => ({
  status: () => Effect.die("unused"),
  create: () => Effect.die("unused"),
  open: args.open,
  change: () => Effect.die("unused"),
  sync: () => Effect.die("unused"),
  subscribe: args.subscribe
})

describe("localReplicaSessionPorts.subscribe", () => {
  it("does not emit a lost event when unsubscribed", async() => {
    const events: Array<ReplicaSubscriptionEvent> = []
    const ports = localReplicaSessionPorts(subscriptionClient({
      open: () => Effect.succeed(view),
      subscribe: () => Effect.succeed(Stream.never)
    }))
    const unsubscribe = ports.subscribe(canvasId, (event) => events.push(event))
    await vi.waitFor(() => expect(events).toEqual([
      ReplicaSubscriptionEvent.connected(),
      ReplicaSubscriptionEvent.changed()
    ]))

    unsubscribe()
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(events).toEqual([
      ReplicaSubscriptionEvent.connected(),
      ReplicaSubscriptionEvent.changed()
    ])
  })

  it("emits connected, gap-close changed, and lost when a stream ends", async() => {
    const events: Array<ReplicaSubscriptionEvent> = []
    const open = vi.fn(() => Effect.succeed(view))
    const ports = localReplicaSessionPorts(subscriptionClient({
      open,
      subscribe: () => Effect.succeed(Stream.empty)
    }))
    const unsubscribe = ports.subscribe(canvasId, (event) => events.push(event))

    await vi.waitFor(() => expect(events).toEqual([
      ReplicaSubscriptionEvent.connected(),
      ReplicaSubscriptionEvent.changed(),
      ReplicaSubscriptionEvent.lost({ reason: "The local daemon is unreachable." })
    ]))
    expect(open).toHaveBeenCalledOnce()

    unsubscribe()
  })
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
