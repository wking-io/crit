import { decodeCanvasProjection } from "@crit/domain"
import {
  IframeRenderPlan,
  type RenderPlan
} from "@crit/representations"
import {
  notifyManager,
  QueryClient,
  QueryClientProvider
} from "@tanstack/react-query"
import { Effect } from "effect"
import { StrictMode, act, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  CanvasBoard,
  CanvasSelection,
  type FrameRepresentationResolver,
  type FrameSnapshotter
} from "../src/index.js"
import { requiredBoard } from "./required-board.js"

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true })
notifyManager.setNotifyFunction((callback) => act(callback))
notifyManager.setScheduler(queueMicrotask)

const url = "https://example.com/checkout"
const snapshotter: FrameSnapshotter = {
  capture: () => Effect.die("Snapshot capture must not run")
}
const reviewProjection = (status: "in-progress" | "ready-for-review") =>
  decodeCanvasProjection({
    schemaVersion: 3,
    canvasId: "canvas_review",
    title: "Review",
    frames: [{
      frameId: "frame_checkout",
      title: "Checkout",
      representation: { _tag: "webUrl", url },
      status,
      geometry: { x: 40, y: 80, width: 320, height: 200 },
      createdByChangeId: "change_1",
      updatedByChangeId: "change_1",
      titleChangedByChangeId: "change_1",
      representationChangedByChangeId: "change_1",
      statusChangedByChangeId: "change_1",
      geometryChangedByChangeId: "change_1"
    }],
    stack: [
      { _tag: "frame", frameId: "frame_checkout" }
    ],
    stackChangedByChangeId: "change_1",
    issuedIds: {
      frameIds: ["frame_checkout"]
    }
  })
const projection = reviewProjection("in-progress")

const empty = decodeCanvasProjection({
  schemaVersion: 3,
  canvasId: "canvas_empty",
  title: "Empty",
  frames: [],
  stack: [],
  stackChangedByChangeId: null,
  issuedIds: { frameIds: [] }
})

let container: HTMLDivElement
let queryClient: QueryClient
let root: Root

const render = (element: ReactElement) => root.render(
  <QueryClientProvider client={queryClient}>
    <StrictMode>{element}</StrictMode>
  </QueryClientProvider>
)
const waitFor = (assertion: () => void) => act(async() => vi.waitFor(assertion))
const pointer = (
  target: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  clientX: number,
  clientY: number
) => target.dispatchEvent(new MouseEvent(type, {
  bubbles: true,
  clientX,
  clientY
}))

beforeEach(() => {
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  })
})

afterEach(async() => {
  await act(async() => root.unmount())
  queryClient.clear()
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("CanvasBoard", () => {
  it("places Frames from the projection stack", async() => {
    const resolver: FrameRepresentationResolver = {
      resolve: () => Effect.succeed(IframeRenderPlan.make({
        representation: projection.frames[0]!.representation,
        url
      }) satisfies RenderPlan)
    }

    await act(async() => render(
      <CanvasBoard {...requiredBoard} projection={projection} resolver={resolver} />
    ))
    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull())

    const board = container.querySelector("[aria-label='Review']")
    const frame = container.querySelector("[aria-label='Checkout']")
    expect(board).not.toBeNull()
    expect(frame).toBeInstanceOf(HTMLElement)
    if (!(frame instanceof HTMLElement)) return
    expect(frame.style.left).toBe("40px")
    expect(frame.style.top).toBe("80px")
    expect(frame.style.width).toBe("320px")
    expect(frame.style.height).toBe("200px")
    expect(frame.style.zIndex).toBe("0")
    expect(frame.getAttribute("data-review-status")).toBe("in-progress")
    expect(frame.textContent).toContain("In progress")
    expect(container.querySelector("[aria-label='Check the price by Ada']")).toBeNull()
    expect(container.querySelector("iframe")?.getAttribute("src")).toBe(url)
  })

  it("captures unselected Frames but leaves the sole selected Frame interactive", async() => {
    const resolver: FrameRepresentationResolver = {
      resolve: () => Effect.succeed(IframeRenderPlan.make({
        representation: projection.frames[0]!.representation,
        url
      }) satisfies RenderPlan)
    }

    await act(async() => render(
      <CanvasBoard {...requiredBoard} projection={projection} resolver={resolver} />
    ))
    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull())

    const capture = container.querySelector("[data-crit-frame-capture]")
    expect(capture).toBeInstanceOf(HTMLElement)
    if (!(capture instanceof HTMLElement)) return
    expect(capture.getAttribute("aria-hidden")).toBe("true")
    expect(capture.style.inset).toBe("0")
    expect(capture.style.pointerEvents).toBe("auto")
    expect(capture.style.position).toBe("absolute")

    const iframe = container.querySelector("iframe")
    iframe?.dispatchEvent(new Event("load"))
    expect(
      iframe?.contentDocument?.querySelector("script[data-crit-input-bridge]")
    ).toBeNull()

    await act(async() => render(
      <CanvasBoard
        {...requiredBoard}
        projection={projection}
        resolver={resolver}
        selection={CanvasSelection.make([{
          _tag: "frame",
          frameId: "frame_checkout"
        }])}
      />
    ))

    expect(container.querySelector("[data-crit-frame-capture]")).toBeNull()
  })

  it("shows an empty canvas without looking up missing items", async() => {
    const resolver: FrameRepresentationResolver = {
      resolve: () => Effect.die("empty canvas must not resolve a Frame")
    }
    await act(async() => render(
      <CanvasBoard {...requiredBoard} projection={empty} resolver={resolver} />
    ))
    expect(container.querySelector("[role='status']")?.textContent).toBe(
      "Empty has no Frames."
    )
    expect(container.querySelector("iframe")).toBeNull()
    expect(container.querySelector("[aria-label='Check the price by Ada']")).toBeNull()
  })

  it("paints the Frame review-status label from the closed table", async() => {
    const ready = reviewProjection("ready-for-review")
    const resolver: FrameRepresentationResolver = {
      resolve: () => Effect.succeed(IframeRenderPlan.make({
        representation: ready.frames[0]!.representation,
        url
      }) satisfies RenderPlan)
    }

    await act(async() => render(
      <CanvasBoard {...requiredBoard} projection={ready} resolver={resolver} />
    ))
    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull())

    const frame = container.querySelector("[aria-label='Checkout']")
    expect(frame).toBeInstanceOf(HTMLElement)
    if (!(frame instanceof HTMLElement)) return
    expect(frame.getAttribute("data-review-status")).toBe("ready-for-review")
    expect(frame.textContent).toContain("Ready for review")
  })

  it("removes the selected Frame with Delete", async() => {
    const onSubmit = vi.fn()
    const resolver: FrameRepresentationResolver = {
      resolve: () => Effect.succeed(IframeRenderPlan.make({
        representation: projection.frames[0]!.representation,
        url
      }) satisfies RenderPlan)
    }
    await act(async() => render(
      <CanvasBoard
        {...requiredBoard}
        onSubmit={onSubmit}
        projection={projection}
        resolver={resolver}
        snapshotter={snapshotter}
        selection={CanvasSelection.make([{
          _tag: "frame",
          frameId: "frame_checkout"
        }])}
      />
    ))

    await act(async() => {
      document.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Delete",
        bubbles: true,
        cancelable: true
      }))
    })
    expect(onSubmit).toHaveBeenCalledWith([{
      _tag: "removeFrame",
      frameId: "frame_checkout",
      expectedUpdatedByChangeId: "change_1"
    }])
  })

  it("submits Frame geometry from the first pointer drag", async() => {
    const onSubmit = vi.fn()
    const resolver: FrameRepresentationResolver = {
      resolve: () => Effect.succeed(IframeRenderPlan.make({
        representation: projection.frames[0]!.representation,
        url
      }) satisfies RenderPlan)
    }
    await act(async() => render(
      <CanvasBoard
        {...requiredBoard}
        onSubmit={onSubmit}
        projection={projection}
        resolver={resolver}
        snapshotter={snapshotter}
      />
    ))
    const frame = container.querySelector("[aria-label='Checkout']")
    const board = container.querySelector("[aria-label='Review']")
    if (!(frame instanceof HTMLElement) || !(board instanceof HTMLElement)) {
      throw new Error("Review Frame missing")
    }

    await act(async() => {
      pointer(frame, "pointerdown", 100, 100)
      pointer(board, "pointermove", 120, 130)
      pointer(board, "pointerup", 120, 130)
    })

    expect(onSubmit).toHaveBeenCalledWith([{
      _tag: "setFrameGeometry",
      frameId: "frame_checkout",
      expectedChangedByChangeId: "change_1",
      geometry: { x: 60, y: 110, width: 320, height: 200 }
    }])
  })

  it("submits selected Frame geometry after a pointer move", async() => {
    const onSubmit = vi.fn()
    const resolver: FrameRepresentationResolver = {
      resolve: () => Effect.succeed(IframeRenderPlan.make({
        representation: projection.frames[0]!.representation,
        url
      }) satisfies RenderPlan)
    }
    await act(async() => render(
      <CanvasBoard
        {...requiredBoard}
        onSubmit={onSubmit}
        projection={projection}
        resolver={resolver}
        snapshotter={snapshotter}
        selection={CanvasSelection.make([{
          _tag: "frame",
          frameId: "frame_checkout"
        }])}
      />
    ))
    const frame = container.querySelector("[aria-label='Checkout']")
    const board = container.querySelector("[aria-label='Review']")
    if (!(frame instanceof HTMLElement) || !(board instanceof HTMLElement)) {
      throw new Error("Review Frame missing")
    }

    await act(async() => {
      pointer(frame, "pointerdown", 100, 100)
      pointer(board, "pointermove", 120, 130)
      pointer(board, "pointerup", 120, 130)
    })

    expect(onSubmit).toHaveBeenCalledWith([{
      _tag: "setFrameGeometry",
      frameId: "frame_checkout",
      expectedChangedByChangeId: "change_1",
      geometry: { x: 60, y: 110, width: 320, height: 200 }
    }])
  })

  it("handles open-url effects without submitting to the replica", async() => {
    const onSubmit = vi.fn()
    const open = vi.spyOn(window, "open").mockImplementation(() => null)
    const resolver: FrameRepresentationResolver = {
      resolve: () => Effect.succeed(IframeRenderPlan.make({
        representation: projection.frames[0]!.representation,
        url
      }) satisfies RenderPlan)
    }
    await act(async() => render(
      <CanvasBoard
        {...requiredBoard}
        onSubmit={onSubmit}
        projection={projection}
        resolver={resolver}
        snapshotter={snapshotter}
        selection={CanvasSelection.make([{
          _tag: "frame",
          frameId: "frame_checkout"
        }])}
      />
    ))
    const openButton = container.querySelector(
      "[aria-label='Open in new tab']"
    )
    if (!(openButton instanceof HTMLButtonElement)) {
      throw new Error("Open URL action missing")
    }

    await act(async() => openButton.click())

    expect(open).toHaveBeenCalledWith(
      url,
      "_blank",
      "noopener,noreferrer"
    )
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("pauses offscreen Frame renderers", async() => {
    let callback: IntersectionObserverCallback | undefined
    let observed: Element | undefined
    class Observer {
      constructor(next: IntersectionObserverCallback) {
        callback = next
      }
      disconnect() {}
      observe(target: Element) {
        observed = target
      }
    }
    vi.stubGlobal("IntersectionObserver", Observer)
    const resolver: FrameRepresentationResolver = {
      resolve: () => Effect.succeed(IframeRenderPlan.make({
        representation: projection.frames[0]!.representation,
        url
      }) satisfies RenderPlan)
    }
    await act(async() => render(
      <CanvasBoard
        {...requiredBoard}
        onSubmit={vi.fn()}
        projection={projection}
        resolver={resolver}
        snapshotter={snapshotter}
        selection={CanvasSelection.make([{
          _tag: "frame",
          frameId: "frame_checkout"
        }])}
      />
    ))
    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull())
    if (callback === undefined || observed === undefined) {
      throw new Error("Frame observer missing")
    }
    // SAFETY: The observer callback only reads isIntersecting and target.
    await act(async() => callback(
      [{ isIntersecting: false, target: observed } as IntersectionObserverEntry],
      {} as IntersectionObserver
    ))

    expect(container.querySelector("iframe")).toBeNull()
    expect(container.textContent).toContain("Checkout is paused.")
  })
})
