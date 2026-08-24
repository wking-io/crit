import { Id, decodeCanvasProjection } from "@crit/domain"
import {
  ReplicaSessionUnavailable,
  layerMemory,
  type FrameRepresentationResolver,
  type ReplicaSessionPorts,
  type ReplicaSessionRun
} from "@crit/react"
import { ReplicaView } from "@crit/replica"
import { notifyManager } from "@tanstack/react-query"
import { Effect, Layer, Schema } from "effect"
import { StrictMode, act, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CritHost } from "../src/index.js"

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true })
notifyManager.setNotifyFunction((callback) => act(callback))
notifyManager.setScheduler(queueMicrotask)

const canvasId = Id.canvas("canvas_review")

const view = Schema.decodeUnknownSync(ReplicaView)({
  _tag: "replica-view",
  canvasId,
  acknowledgedCursor: "cursor_one",
  projection: decodeCanvasProjection({
    schemaVersion: 2,
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
    notes: [],
    threads: [],
    stack: [{ _tag: "frame", frameId: "frame_checkout" }],
    stackChangedByChangeId: "change_1",
    issuedIds: {
      frameIds: ["frame_checkout"],
      noteIds: [],
      threadIds: [],
      commentIds: []
    }
  }),
  pending: []
})

const resolver: FrameRepresentationResolver = {
  resolve: () => Effect.fail("unresolved")
}

const makeRun = (): ReplicaSessionRun => {
  const services = Effect.runSync(Effect.scoped(Layer.build(layerMemory)))
  return (effect) => Effect.runPromise(Effect.provide(effect, services))
}

let container: HTMLDivElement
let root: Root

const render = (element: ReactElement) => root.render(<StrictMode>{element}</StrictMode>)
const waitFor = (assertion: () => void) => act(async() => vi.waitFor(assertion))

beforeEach(() => {
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async() => {
  await act(async() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

describe("CritHost", () => {
  it("shows the connecting copy, then the board once the replica opens", async() => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const ports: ReplicaSessionPorts = {
      open: () => Effect.promise(() => gate.then(() => view)),
      subscribe: () => () => undefined
    }

    await act(async() => render(
      <CritHost canvasId={canvasId} ports={ports} resolver={resolver} run={makeRun()} />
    ))
    expect(container.querySelector("[role='status']")?.textContent).toBe("Connecting to Crit…")

    await act(async() => release())

    await waitFor(() =>
      expect(container.querySelector("[aria-label='Review sync status']"))
        .toBeInstanceOf(HTMLElement)
    )
    expect(container.textContent).toContain("Review is synchronized.")
  })

  it("shows the unavailable reason when open fails", async() => {
    const ports: ReplicaSessionPorts = {
      open: (requested) => Effect.fail(new ReplicaSessionUnavailable({
        canvasId: requested,
        reason: "replica missing"
      })),
      subscribe: () => () => undefined
    }

    await act(async() => render(
      <CritHost canvasId={canvasId} ports={ports} resolver={resolver} run={makeRun()} />
    ))

    await waitFor(() =>
      expect(container.querySelector("[role='alert']")?.textContent).toBe("replica missing")
    )
  })
})
