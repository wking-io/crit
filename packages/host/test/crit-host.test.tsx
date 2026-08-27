import {
  CanvasChangeFailureSchema,
  Id,
  decodeCanvasProjection,
  decodePresenceRoster
} from "@crit/domain"
import {
  ReplicaChangeRejected,
  ReplicaSessionUnavailable,
  ReplicaSubscriptionEvent,
  layerMemory,
  type FrameRepresentationResolver,
  type FrameSnapshotter,
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
  _tag: "replicaView",
  canvasId,
  acknowledgedCursor: "cursor_one",
  projection: decodeCanvasProjection({
    schemaVersion: 3,
    canvasId,
    title: "Review",
    frames: [{
      frameId: "frame_checkout",
      title: "Checkout",
      representation: { _tag: "webUrl", url: "https://example.com/checkout" },
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

const representations: FrameRepresentationResolver & FrameSnapshotter = {
  capture: () => Effect.die("snapshot must not run"),
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
const setInputValue = (input: HTMLInputElement, value: string) => {
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set
  setValue?.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", class {
    disconnect() {}
    observe() {}
  })
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async() => {
  await act(async() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("CritHost", () => {
  it("shows the connecting copy, then the board once the replica opens", async() => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const ports: ReplicaSessionPorts = {
      open: () => Effect.promise(() => gate.then(() => view)),
      subscribe: () => () => undefined,
      attend: () => () => undefined,
      change: () => Effect.die("change must not run")
    }

    await act(async() => render(
      <CritHost
        canvasId={canvasId}
        ports={ports}
        resolver={representations}
        run={makeRun()}
        snapshotter={representations}
      />
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
      subscribe: () => () => undefined,
      attend: () => () => undefined,
      change: () => Effect.die("change must not run")
    }

    await act(async() => render(
      <CritHost
        canvasId={canvasId}
        ports={ports}
        resolver={representations}
        run={makeRun()}
        snapshotter={representations}
      />
    ))

    await waitFor(() =>
      expect(container.querySelector("[role='alert']")?.textContent).toBe("replica missing")
    )
  })

  it("passes submit notices and connection loss to the board", async() => {
    const failure = Schema.decodeUnknownSync(CanvasChangeFailureSchema)({
      _tag: "entityNotFound",
      commandIndex: 0,
      entity: "frame",
      id: "frame_missing"
    })
    const rejected = new ReplicaChangeRejected({ canvasId, failure })
    let publish: ((event: ReplicaSubscriptionEvent) => void) | undefined
    const ports: ReplicaSessionPorts = {
      open: () => Effect.succeed(view),
      subscribe: (_canvasId, onEvent) => {
        publish = onEvent
        return () => undefined
      },
      attend: () => () => undefined,
      change: () => Effect.fail(rejected)
    }

    await act(async() => render(
      <CritHost
        canvasId={canvasId}
        ports={ports}
        resolver={representations}
        run={makeRun()}
        snapshotter={representations}
      />
    ))
    await waitFor(() =>
      expect(container.querySelector("[aria-label='Review controls']"))
        .toBeInstanceOf(HTMLElement)
    )
    const input = container.querySelector("[aria-label='Canvas title']")
    const form = container.querySelector("form[aria-label='Rename canvas']")
    if (!(input instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) {
      throw new Error("Rename canvas form missing")
    }

    await act(async() => setInputValue(input, "Updated review"))
    await act(async() => form.requestSubmit())

    await waitFor(() => expect(container.textContent).toContain(
      "Your last edit was not applied. Rejected because its frame no longer exists."
    ))
    if (publish === undefined) throw new Error("Subscription listener missing")
    await act(async() => publish(ReplicaSubscriptionEvent.lost({ reason: "socket closed." })))

    await waitFor(() => expect(container.textContent).toContain(
      "Connection lost. socket closed. Showing the last known state."
    ))
    expect(container.querySelector("[aria-label='Review controls']")).toBeNull()
  })

  it("lists Access-authenticated occupancy from attend", async() => {
    const roster = decodePresenceRoster({
      _tag: "presenceRoster",
      canvasId,
      people: [{
        _tag: "connectedPerson",
        person: {
          _tag: "person",
          personId: "person_ada",
          displayName: "Ada",
          email: { _tag: "access", address: "ada@acme.com" }
        }
      }]
    })
    const ports: ReplicaSessionPorts = {
      open: () => Effect.succeed(view),
      subscribe: () => () => undefined,
      attend: (_canvasId, onRoster) => {
        onRoster(roster)
        return () => undefined
      },
      change: () => Effect.die("change must not run")
    }

    await act(async() => render(
      <CritHost
        canvasId={canvasId}
        ports={ports}
        resolver={representations}
        run={makeRun()}
        snapshotter={representations}
      />
    ))

    await waitFor(() =>
      expect(container.querySelector("[aria-label='Review presence']"))
        .toBeInstanceOf(HTMLElement)
    )
    expect([...container.querySelectorAll("[aria-label='Review presence'] li")]
      .map((row) => row.textContent)).toEqual(["Ada"])
  })

  it("does not show occupancy when local review does not attend", async() => {
    const ports: ReplicaSessionPorts = {
      open: () => Effect.succeed(view),
      subscribe: () => () => undefined,
      attend: () => () => undefined,
      change: () => Effect.die("change must not run")
    }

    await act(async() => render(
      <CritHost
        canvasId={canvasId}
        ports={ports}
        resolver={representations}
        run={makeRun()}
        snapshotter={representations}
      />
    ))

    await waitFor(() =>
      expect(container.querySelector("[aria-label='Review sync status']"))
        .toBeInstanceOf(HTMLElement)
    )
    expect(container.querySelector("[aria-label='Review presence']")).toBeNull()
  })
})
