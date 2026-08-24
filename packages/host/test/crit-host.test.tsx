import { CanvasChangeFailureSchema, Id, decodeCanvasProjection } from "@crit/domain"
import {
  ReplicaChangeRejected,
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

const addFrameButton = () =>
  [...container.querySelectorAll("button")].find((button) => button.textContent === "Add Frame")

const fillInput = (name: string, value: string) => {
  const input = container.querySelector(`input[name='${name}']`)
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`missing ${name} input`)
  }
  const assigned = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  if (assigned === undefined) {
    throw new Error("input value setter missing")
  }
  assigned.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

const readyPorts = (change: ReplicaSessionPorts["change"]): ReplicaSessionPorts => ({
  open: () => Effect.succeed(view),
  subscribe: () => () => undefined,
  change
})

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
      subscribe: () => () => undefined,
      change: () => Effect.die("change must not run")
    }

    await act(async() => render(
      <CritHost canvasId={canvasId} ports={ports} resolver={resolver} run={makeRun()} />
    ))
    expect(container.querySelector("[role='status']")?.textContent).toBe("Connecting to Crit…")
    expect(addFrameButton()).toBeUndefined()

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
      change: () => Effect.die("change must not run")
    }

    await act(async() => render(
      <CritHost canvasId={canvasId} ports={ports} resolver={resolver} run={makeRun()} />
    ))

    await waitFor(() =>
      expect(container.querySelector("[role='alert']")?.textContent).toBe("replica missing")
    )
    expect(addFrameButton()).toBeUndefined()
  })

  it("shows Add Frame once the replica is ready", async() => {
    await act(async() => render(
      <CritHost
        canvasId={canvasId}
        ports={readyPorts(() => Effect.succeed(view))}
        resolver={resolver}
        run={makeRun()}
      />
    ))

    await waitFor(() => expect(addFrameButton()).toBeInstanceOf(HTMLButtonElement))
  })

  it("submits an add-frame command for a valid URL", async() => {
    const change = vi.fn(() => Effect.succeed(view))
    await act(async() => render(
      <CritHost
        canvasId={canvasId}
        ports={readyPorts(change)}
        resolver={resolver}
        run={makeRun()}
      />
    ))
    await waitFor(() => expect(addFrameButton()).toBeInstanceOf(HTMLButtonElement))

    await act(async() => addFrameButton()?.click())
    await act(async() => {
      fillInput("url", "https://example.com/checkout")
      container.querySelector("form")?.requestSubmit()
    })

    await waitFor(() => expect(change).toHaveBeenCalledTimes(1))
    const payload = change.mock.calls[0]?.[0]
    expect(payload?.canvasId).toBe(canvasId)
    expect(payload?.commands).toEqual([{
      _tag: "add-frame",
      frameId: payload?.commands[0]?.frameId,
      title: "checkout",
      representation: { _tag: "web-url", url: "https://example.com/checkout" },
      status: "in-progress",
      geometry: { x: 1240, y: 0, width: 1200, height: 800 }
    }])
    expect(payload?.commands[0]?.frameId).toMatch(/^frame_[a-f0-9]{32}$/)
    expect(addFrameButton()).toBeInstanceOf(HTMLButtonElement)
  })

  it("shows an alert for an invalid URL and does not call change", async() => {
    const change = vi.fn(() => Effect.die("change must not run"))
    await act(async() => render(
      <CritHost
        canvasId={canvasId}
        ports={readyPorts(change)}
        resolver={resolver}
        run={makeRun()}
      />
    ))
    await waitFor(() => expect(addFrameButton()).toBeInstanceOf(HTMLButtonElement))

    await act(async() => addFrameButton()?.click())
    await act(async() => {
      fillInput("url", "not-a-url")
      container.querySelector("form")?.requestSubmit()
    })

    expect(container.querySelector("[role='alert']")?.textContent).toBe("Enter a valid frame URL")
    expect(change).not.toHaveBeenCalled()
    expect(container.querySelector("form")).toBeInstanceOf(HTMLFormElement)
  })

  it("keeps the form open when the daemon rejects the frame", async() => {
    const change = vi.fn(() => Effect.fail(new ReplicaChangeRejected({
      canvasId,
      failure: Schema.decodeUnknownSync(CanvasChangeFailureSchema)({
        _tag: "entity-not-found",
        commandIndex: 0,
        entity: "frame",
        id: "frame_missing"
      })
    })))
    await act(async() => render(
      <CritHost
        canvasId={canvasId}
        ports={readyPorts(change)}
        resolver={resolver}
        run={makeRun()}
      />
    ))
    await waitFor(() => expect(addFrameButton()).toBeInstanceOf(HTMLButtonElement))

    await act(async() => addFrameButton()?.click())
    await act(async() => {
      fillInput("url", "https://example.com/checkout")
      container.querySelector("form")?.requestSubmit()
    })

    await waitFor(() =>
      expect(container.querySelector("[role='alert']")?.textContent)
        .toBe("The daemon rejected this frame.")
    )
    expect(container.querySelector("form")).toBeInstanceOf(HTMLFormElement)
    expect(addFrameButton()).toBeUndefined()
  })
})
