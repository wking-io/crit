import { decodeCanvasProjection } from "@crit/domain"
import {
  IframeRenderPlan,
  type RenderPlan
} from "@crit/representations"
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
import { CritRegistry } from "./crit-registry.js"
import { requiredBoard } from "./required-board.js"

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true })

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
let root: Root

const render = (element: ReactElement) => root.render(
  <CritRegistry>
    <StrictMode>{element}</StrictMode>
  </CritRegistry>
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
})

afterEach(async() => {
  await act(async() => root.unmount())
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
    expect(frame.className).toBe("crit-frame")
    expect(frame.textContent).toContain("In progress")
    expect(container.querySelector("[data-crit-styles]")).toBeInstanceOf(
      HTMLStyleElement
    )
    expect(container.querySelector("[data-crit-styles]")?.textContent)
      .toContain("--crit-paper")
    expect(container.querySelector(".crit-canvas")).toBe(board)
    expect(container.querySelector(".crit-canvas__plane")).not.toBeNull()
    expect(container.querySelector(".crit-frame__chrome")).not.toBeNull()
    expect(container.querySelector(".crit-frame__viewport")).not.toBeNull()
    expect(container.querySelector("[aria-label='Check the price by Ada']")).toBeNull()
    expect(container.querySelector("iframe")?.getAttribute("src")).toBe(url)
    expect(container.querySelector("[data-crit-glyph-sheet]")).not.toBeNull()
    expect(container.querySelector(".crit-frame__mark svg")).not.toBeNull()
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
    if (
      !(openButton instanceof HTMLButtonElement) &&
      !(openButton instanceof HTMLAnchorElement)
    ) {
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
    await act(async() => callback(
      [{ isIntersecting: false, target: observed } as IntersectionObserverEntry],
      {} as IntersectionObserver
    ))

    expect(container.querySelector("iframe")).toBeNull()
    expect(container.textContent).toContain("Checkout is paused.")
  })

  it("paints rewrite corner handles and status chrome on a selected Frame", async() => {
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

    const handles = [...container.querySelectorAll("[data-resize-handle]")]
    expect(handles.map((handle) => handle.getAttribute("data-resize-handle")))
      .toEqual(["north-west", "north-east", "south-east", "south-west"])
    expect(container.querySelectorAll(".crit-selection__handle-shape")).toHaveLength(4)
    expect(container.querySelector("[data-handle-style='corners']")).not.toBeNull()
    expect(container.querySelector("[aria-label='Status: In progress. Change status']"))
      .toBeInstanceOf(HTMLButtonElement)
    expect(container.querySelector("[aria-label='Snapshot']"))
      .toBeInstanceOf(HTMLButtonElement)
    expect(container.querySelector("[aria-label='Canvas toolbar']")).not.toBeNull()
    expect(container.querySelector("[aria-label='Align and distribute']"))
      .toBeInstanceOf(HTMLButtonElement)
    expect(container.querySelector("[aria-label='Add frame']"))
      .toBeInstanceOf(HTMLButtonElement)
    expect(container.querySelector("[aria-label='Undo']")).toBeNull()
    expect(container.querySelector("[aria-label='Add note']")).toBeNull()
  })

  it("opens the status fan and frame context menu from rewrite chrome", async() => {
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

    const status = container.querySelector(
      "[aria-label='Status: In progress. Change status']"
    )
    if (!(status instanceof HTMLButtonElement)) {
      throw new Error("Status mark missing")
    }
    await act(async() => status.click())
    await waitFor(() => {
      const fan = document.querySelector("[aria-label='Set status for Checkout']")
      expect(fan).not.toBeNull()
      expect(fan?.textContent).toContain("Approved")
      expect(document.querySelector("[aria-label='Set status to approved']"))
        .toBeInstanceOf(HTMLElement)
    })

    const frame = container.querySelector("[aria-label='Checkout']")
    if (!(frame instanceof HTMLElement)) throw new Error("Review Frame missing")
    await act(async() => {
      frame.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        button: 2,
        clientX: 80,
        clientY: 120
      }))
    })
    await waitFor(() => {
      const menu = document.querySelector("[aria-label='Actions for Checkout']")
      expect(menu).not.toBeNull()
      expect(menu?.textContent).toContain("Remove")
      expect(menu?.textContent).toContain("Bring to front")
      expect(menu?.textContent).toContain("Set size")
      expect(menu?.textContent).toContain("Duplicate at preset")
      expect(menu?.textContent).toContain("Fit frame content")
    })
  })

  it("offers add frame and zoom to fit on the empty canvas", async() => {
    const onSubmit = vi.fn()
    const onCameraChange = vi.fn()
    const resolver: FrameRepresentationResolver = {
      resolve: () => Effect.die("empty canvas must not resolve a Frame")
    }
    await act(async() => render(
      <CanvasBoard
        {...requiredBoard}
        onCameraChange={onCameraChange}
        onSubmit={onSubmit}
        projection={empty}
        resolver={resolver}
        snapshotter={snapshotter}
      />
    ))

    expect(container.querySelector("[aria-label='Add frame']"))
      .toBeInstanceOf(HTMLButtonElement)
    const surface = container.querySelector("[aria-label='Canvas actions']")
    if (!(surface instanceof HTMLElement)) {
      throw new Error("Canvas actions trigger missing")
    }
    await act(async() => {
      surface.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        button: 2,
        clientX: 40,
        clientY: 80
      }))
    })
    await waitFor(() => {
      const menu = document.querySelector("[aria-label='Canvas actions'][role='menu']")
        ?? [...document.querySelectorAll("[aria-label='Canvas actions']")]
          .find((node) => node.getAttribute("role") === "menu")
      expect(menu).not.toBeNull()
      expect(menu?.textContent).toContain("Add frame")
      expect(menu?.textContent).toContain("Zoom to fit")
      expect(menu?.textContent).not.toContain("Add note")
    })
  })
})
