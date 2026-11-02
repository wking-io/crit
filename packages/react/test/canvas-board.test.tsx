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
  CanvasCamera,
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

const multiFrameProjection = decodeCanvasProjection({
  schemaVersion: 3,
  canvasId: "canvas_multi",
  title: "Multi-frame review",
  frames: [
    projection.frames[0]!,
    {
      frameId: "frame_details",
      title: "Details",
      representation: { _tag: "webUrl", url },
      status: "in-progress",
      geometry: { x: 400, y: 200, width: 240, height: 180 },
      createdByChangeId: "change_2",
      updatedByChangeId: "change_2",
      titleChangedByChangeId: "change_2",
      representationChangedByChangeId: "change_2",
      statusChangedByChangeId: "change_2",
      geometryChangedByChangeId: "change_2"
    }
  ],
  stack: [
    { _tag: "frame", frameId: "frame_checkout" },
    { _tag: "frame", frameId: "frame_details" }
  ],
  stackChangedByChangeId: "change_2",
  issuedIds: { frameIds: ["frame_checkout", "frame_details"] }
})

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
const waitFor = (assertion: () => void) => vi.waitFor(async() => {
  await act(async() => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  assertion()
})
const pointer = (
  target: EventTarget,
  type: "pointerdown" | "pointermove" | "pointerup",
  clientX: number,
  clientY: number,
  modifiers: {
    readonly buttons?: number
    readonly ctrlKey?: boolean
    readonly metaKey?: boolean
  } = {}
) => target.dispatchEvent(new MouseEvent(type, {
  bubbles: true,
  buttons: type === "pointerup" ? 0 : 1,
  clientX,
  clientY,
  ...modifiers
}))

const clipboardEvent = (type: "copy" | "paste", data: Map<string, string>) => {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, "clipboardData", {
    value: {
      setData: (format: string, value: string) => data.set(format, value),
      getData: (format: string) => data.get(format) ?? ""
    }
  })
  return event
}

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
  it("clears all selected Frames with Escape and returns focus to the Canvas", async() => {
    const onSelectionChange = vi.fn()
    const onCameraChange = vi.fn()
    const resolver: FrameRepresentationResolver = { resolve: () => Effect.never }
    await act(async() => render(
      <CanvasBoard {...requiredBoard} projection={multiFrameProjection} resolver={resolver}
        onSelectionChange={onSelectionChange} onCameraChange={onCameraChange}
        selection={CanvasSelection.make([
          { _tag: "frame", frameId: "frame_checkout" },
          { _tag: "frame", frameId: "frame_details" }
        ])} />
    ))
    const handled = new KeyboardEvent("keydown", { key: "Escape", cancelable: true })
    handled.preventDefault()
    await act(async() => window.dispatchEvent(handled))
    expect(onSelectionChange).not.toHaveBeenCalled()
    await act(async() => window.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape", cancelable: true
    })))
    expect(onSelectionChange).toHaveBeenLastCalledWith([])
    expect(container.querySelectorAll(".crit-frame[aria-selected='true']")).toHaveLength(0)
    expect(document.activeElement).toBe(container.querySelector(".crit-canvas"))
    expect(onCameraChange).not.toHaveBeenCalled()
  })

  it("keeps Frame chrome at a constant screen size while zooming", async() => {
    const resolver: FrameRepresentationResolver = { resolve: () => Effect.never }
    await act(async() => render(
      <CanvasBoard {...requiredBoard} projection={projection} resolver={resolver} />
    ))
    const board = container.querySelector<HTMLElement>(".crit-canvas")!
    vi.spyOn(board, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 800, 600)
    )
    const frame = container.querySelector<HTMLElement>(".crit-frame")!
    expect(frame.style.getPropertyValue("--crit-ui")).toBe("1")

    await act(async() => window.dispatchEvent(new KeyboardEvent("keydown", {
      key: "=",
      code: "Equal",
      ctrlKey: true,
      cancelable: true
    })))

    expect(frame.style.getPropertyValue("--crit-ui")).toBe("0.5")
  })

  it("keeps the Frame selected while H captures canvas navigation and V restores interaction", async() => {
    const onSubmit = vi.fn()
    const onSelectionChange = vi.fn()
    const resolver: FrameRepresentationResolver = { resolve: () => Effect.never }
    await act(async() => render(
      <CanvasBoard {...requiredBoard} projection={projection} resolver={resolver}
        onSubmit={onSubmit} snapshotter={snapshotter} onSelectionChange={onSelectionChange}
        selection={CanvasSelection.make([{ _tag: "frame", frameId: "frame_checkout" }])} />
    ))
    const board = container.querySelector(".crit-canvas")!
    const frame = container.querySelector(".crit-frame")!
    await act(async() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "h", code: "KeyH", cancelable: true })))
    expect(board.getAttribute("data-canvas-capture")).toBe("true")
    expect(frame.getAttribute("aria-selected")).toBe("true")
    await act(async() => {
      pointer(frame, "pointerdown", 100, 100)
      pointer(window, "pointermove", 120, 130)
      pointer(window, "pointerup", 120, 130)
    })
    await waitFor(() => expect(container.querySelector<HTMLElement>(".crit-canvas__plane")?.style.transform).toContain("translate(20px, 30px)"))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onSelectionChange).not.toHaveBeenCalled()
    await act(async() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "v", code: "KeyV", cancelable: true })))
    expect(board.hasAttribute("data-canvas-capture")).toBe(false)
    expect(frame.getAttribute("aria-selected")).toBe("true")
  })

  it("pastes copied Frames at their original sizes after the source selection is gone", async() => {
    const submit = vi.fn()
    const selectionChange = vi.fn()
    const resolver: FrameRepresentationResolver = {
      resolve: () => Effect.never
    }
    await act(async() => render(
      <CanvasBoard
        {...requiredBoard}
        projection={multiFrameProjection}
        resolver={resolver}
        selection={CanvasSelection.make(multiFrameProjection.stack)}
        onSelectionChange={selectionChange}
        onSubmit={submit}
        snapshotter={snapshotter}
      />
    ))
    const data = new Map<string, string>()
    const copy = clipboardEvent("copy", data)
    document.body.dispatchEvent(copy)
    expect(copy.defaultPrevented).toBe(true)

    await act(async() => render(
      <CanvasBoard
        {...requiredBoard}
        projection={empty}
        resolver={resolver}
        onSelectionChange={selectionChange}
        onSubmit={submit}
        snapshotter={snapshotter}
      />
    ))
    const paste = clipboardEvent("paste", data)
    await act(async() => { document.body.dispatchEvent(paste) })
    expect(paste.defaultPrevented).toBe(true)
    expect(submit).toHaveBeenCalledWith(multiFrameProjection.frames.map((frame) => ({
      _tag: "addFrame",
      frameId: expect.stringMatching(/^frame_/),
      title: frame.title,
      representation: frame.representation,
      status: frame.status,
      geometry: { ...frame.geometry, x: frame.geometry.x + 32, y: frame.geometry.y + 32 }
    })))
    const firstPaste = submit.mock.calls[0]![0]
    expect(selectionChange).toHaveBeenCalledWith(firstPaste.map((frame: { frameId: string }) => ({
      _tag: "frame", frameId: frame.frameId
    })))
    await act(async() => { document.body.dispatchEvent(clipboardEvent("paste", data)) })
    const secondPaste = submit.mock.calls[1]![0]
    expect(secondPaste[0].geometry).toEqual({ x: 104, y: 144, width: 320, height: 200 })
    expect(new Set([...firstPaste, ...secondPaste].map((frame) => frame.frameId)).size).toBe(4)
  })

  it("preserves text editing and ignores invalid frame pastes and read-only mutations", async() => {
    const submit = vi.fn()
    const resolver: FrameRepresentationResolver = { resolve: () => Effect.never }
    const props = {
      ...requiredBoard,
      projection,
      resolver,
      selection: CanvasSelection.make(projection.stack),
      onSubmit: submit,
      snapshotter
    }
    await act(async() => render(<CanvasBoard {...props} />))
    const data = new Map<string, string>()
    document.body.dispatchEvent(clipboardEvent("copy", data))
    const input = document.createElement("input")
    container.querySelector("section")!.append(input)
    for (const type of ["copy", "paste"] as const) {
      const event = clipboardEvent(type, data)
      input.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    }
    input.remove()
    for (const text of ["ordinary text", '{"type":"crit/frames","version":1,"frames":[{}]}']) {
      const event = clipboardEvent("paste", new Map([["text/plain", text]]))
      document.body.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    }
    await act(async() => render(<CanvasBoard {...props} mutable={false} />))
    const paste = clipboardEvent("paste", data)
    document.body.dispatchEvent(paste)
    expect(paste.defaultPrevented).toBe(false)
    expect(submit).not.toHaveBeenCalled()
  })

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
    expect(container.querySelector("[data-crit-styles]")?.textContent)
      .not.toContain(".crit-help__shortcuts")
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

  it("follows a pointer on window after the Frame starts a drag", async() => {
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
    if (!(frame instanceof HTMLElement)) throw new Error("Review Frame missing")

    await act(async() => {
      pointer(frame, "pointerdown", 100, 100)
      pointer(window, "pointermove", 120, 130)
      pointer(window, "pointerup", 120, 130)
    })

    expect(frame.style.left).toBe("60px")
    expect(frame.style.top).toBe("110px")
    expect(onSubmit).toHaveBeenCalledWith([{
      _tag: "setFrameGeometry",
      frameId: "frame_checkout",
      expectedChangedByChangeId: "change_1",
      geometry: { x: 60, y: 110, width: 320, height: 200 }
    }])
  })

  it("fits a command-space zoom marquee without selecting or moving Frames", async() => {
    const onCameraChange = vi.fn()
    const onSelectionChange = vi.fn()
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
        onCameraChange={onCameraChange}
        onSelectionChange={onSelectionChange}
        onSubmit={onSubmit}
        projection={projection}
        resolver={resolver}
        snapshotter={snapshotter}
      />
    ))
    const board = container.querySelector("[aria-label='Review']")
    if (!(board instanceof HTMLElement)) throw new Error("Review board missing")
    vi.spyOn(board, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 800, 600)
    )

    await act(async() => {
      window.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        code: "Space",
        key: " ",
        metaKey: true
      }))
      pointer(board, "pointerdown", 100, 100, { metaKey: true })
      pointer(window, "pointermove", 300, 200, { metaKey: true })
      pointer(window, "pointerup", 300, 200, { metaKey: true })
      window.dispatchEvent(new KeyboardEvent("keyup", {
        bubbles: true,
        code: "Space",
        key: " "
      }))
    })

    await waitFor(() => expect(onCameraChange).toHaveBeenCalledWith(
      CanvasCamera.make({ x: -400, y: -300, zoom: 4 })
    ))
    expect(onSelectionChange).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(container.querySelector(".crit-canvas__selection-marquee")?.hasAttribute(
      "hidden"
    )).toBe(true)
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
        selection={CanvasSelection.make([])}
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

  it("finishes a drag when a zero-button move follows a missed pointerup", async() => {
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
        selection={CanvasSelection.make([])}
      />
    ))
    const frame = container.querySelector("[aria-label='Checkout']")
    if (!(frame instanceof HTMLElement)) throw new Error("Review Frame missing")

    await act(async() => {
      pointer(frame, "pointerdown", 100, 100)
      pointer(window, "pointermove", 120, 130)
      pointer(window, "pointermove", 140, 150, { buttons: 0 })
      pointer(window, "pointermove", 300, 300, { buttons: 0 })
    })

    expect(frame.style.left).toBe("80px")
    expect(frame.style.top).toBe("130px")
    expect(onSubmit).toHaveBeenCalledOnce()
    expect(onSubmit).toHaveBeenCalledWith([{
      _tag: "setFrameGeometry",
      frameId: "frame_checkout",
      expectedChangedByChangeId: "change_1",
      geometry: { x: 80, y: 130, width: 320, height: 200 }
    }])
  })

  it("organizes multiple frames from the selection box without beginning a drag", async() => {
    const onSubmit = vi.fn()
    const resolver: FrameRepresentationResolver = {
      resolve: (representation) => Effect.succeed(IframeRenderPlan.make({ representation, url }) satisfies RenderPlan)
    }
    const selected = CanvasSelection.make([
      { _tag: "frame", frameId: "frame_checkout" },
      { _tag: "frame", frameId: "frame_details" }
    ])
    await act(async() => render(
      <CanvasBoard {...requiredBoard} onSubmit={onSubmit} projection={multiFrameProjection}
        resolver={resolver} snapshotter={snapshotter} selection={selected} />
    ))
    const trigger = container.querySelector(".crit-group-selection [aria-label='Align and distribute']")
    if (!(trigger instanceof HTMLButtonElement)) throw new Error("Selection organize button missing")
    expect(trigger.closest("[aria-hidden='true']")).toBeNull()
    expect(container.querySelector(".crit-toolbar [aria-label='Align and distribute']")).toBeNull()
    await act(async() => {
      pointer(trigger, "pointerdown", 630, 60)
      pointer(window, "pointermove", 660, 80)
      pointer(window, "pointerup", 660, 80)
      trigger.click()
    })
    expect(onSubmit).not.toHaveBeenCalled()
    const menu = await vi.waitFor(() => {
      const popup = document.querySelector("[role='menu'][aria-label='Align and distribute']")
      if (!(popup instanceof HTMLElement)) throw new Error("Organize menu missing")
      return popup
    })
    expect(menu.querySelectorAll("[role='menuitem']")).toHaveLength(9)
    expect(menu.closest(".crit-arrangement-positioner")?.getAttribute("data-side")).toBe("top")
    const alignLeft = menu.querySelector("[aria-label='Align left']")
    if (!(alignLeft instanceof HTMLElement)) throw new Error("Align left missing")
    await act(async() => alignLeft.click())
    expect(onSubmit).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ frameId: "frame_details", geometry: expect.objectContaining({ x: 40 }) })
    ]))
    await act(async() => render(
      <CanvasBoard {...requiredBoard} onSubmit={onSubmit} projection={multiFrameProjection}
        resolver={resolver} snapshotter={snapshotter}
        selection={CanvasSelection.make([{ _tag: "frame", frameId: "frame_checkout" }])} />
    ))
    expect(container.querySelector(".crit-group-selection")).toBeNull()
    expect(document.querySelector("[role='menu'][aria-label='Align and distribute']")).toBeNull()
  })

  it("moves every selected Frame by the same pointer delta", async() => {
    const onSubmit = vi.fn()
    const resolver: FrameRepresentationResolver = {
      resolve: (representation) => Effect.succeed(IframeRenderPlan.make({
        representation,
        url
      }) satisfies RenderPlan)
    }
    await act(async() => render(
      <CanvasBoard
        {...requiredBoard}
        onSubmit={onSubmit}
        projection={multiFrameProjection}
        resolver={resolver}
        snapshotter={snapshotter}
        selection={CanvasSelection.make([
          { _tag: "frame", frameId: "frame_checkout" },
          { _tag: "frame", frameId: "frame_details" }
        ])}
      />
    ))
    const checkout = container.querySelector("[aria-label='Checkout']")
    const details = container.querySelector("[aria-label='Details']")
    const group = container.querySelector(".crit-group-selection")
    if (!(checkout instanceof HTMLElement) || !(details instanceof HTMLElement)) {
      throw new Error("Review Frames missing")
    }
    if (!(group instanceof HTMLElement)) throw new Error("Group bounds missing")

    expect(group.style.left).toBe("40px")
    expect(group.style.top).toBe("80px")
    expect(group.style.width).toBe("600px")
    expect(group.style.height).toBe("300px")
    expect(container.querySelectorAll(".crit-selection")).toHaveLength(1)
    expect(group.querySelector(".crit-selection")).not.toBeNull()
    expect(group.querySelectorAll(".crit-selection__handle")).toHaveLength(4)

    await act(async() => {
      pointer(group, "pointerdown", 380, 150)
      pointer(window, "pointermove", 400, 180)
      pointer(window, "pointerup", 400, 180)
    })

    expect(checkout.style.left).toBe("60px")
    expect(checkout.style.top).toBe("110px")
    expect(details.style.left).toBe("420px")
    expect(details.style.top).toBe("230px")
    expect(group.style.left).toBe("60px")
    expect(group.style.top).toBe("110px")
    expect(onSubmit).toHaveBeenCalledWith([
      {
        _tag: "setFrameGeometry",
        frameId: "frame_checkout",
        expectedChangedByChangeId: "change_1",
        geometry: { x: 60, y: 110, width: 320, height: 200 }
      },
      {
        _tag: "setFrameGeometry",
        frameId: "frame_details",
        expectedChangedByChangeId: "change_2",
        geometry: { x: 420, y: 230, width: 240, height: 180 }
      }
    ])
  })

  it("does not paint start geometry after a finished drag before the command lands", async() => {
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

    expect(frame.style.left).toBe("60px")
    expect(frame.style.top).toBe("110px")
    expect(frame.style.width).toBe("320px")
    expect(frame.style.height).toBe("200px")
    expect(onSubmit).toHaveBeenCalledWith([{
      _tag: "setFrameGeometry",
      frameId: "frame_checkout",
      expectedChangedByChangeId: "change_1",
      geometry: { x: 60, y: 110, width: 320, height: 200 }
    }])

    const landed = decodeCanvasProjection({
      schemaVersion: 3,
      canvasId: "canvas_review",
      title: "Review",
      frames: [{
        frameId: "frame_checkout",
        title: "Checkout",
        representation: { _tag: "webUrl", url },
        status: "in-progress",
        geometry: { x: 60, y: 110, width: 320, height: 200 },
        createdByChangeId: "change_1",
        updatedByChangeId: "change_2",
        titleChangedByChangeId: "change_1",
        representationChangedByChangeId: "change_1",
        statusChangedByChangeId: "change_1",
        geometryChangedByChangeId: "change_2"
      }],
      stack: [{ _tag: "frame", frameId: "frame_checkout" }],
      stackChangedByChangeId: "change_1",
      issuedIds: { frameIds: ["frame_checkout"] }
    })
    await act(async() => render(
      <CanvasBoard
        {...requiredBoard}
        onSubmit={onSubmit}
        projection={landed}
        resolver={resolver}
        snapshotter={snapshotter}
      />
    ))
    expect(frame.style.left).toBe("60px")
    expect(frame.style.top).toBe("110px")

    const later = decodeCanvasProjection({
      schemaVersion: 3,
      canvasId: "canvas_review",
      title: "Review",
      frames: [{
        frameId: "frame_checkout",
        title: "Checkout",
        representation: { _tag: "webUrl", url },
        status: "in-progress",
        geometry: { x: 10, y: 20, width: 320, height: 200 },
        createdByChangeId: "change_1",
        updatedByChangeId: "change_3",
        titleChangedByChangeId: "change_1",
        representationChangedByChangeId: "change_1",
        statusChangedByChangeId: "change_1",
        geometryChangedByChangeId: "change_3"
      }],
      stack: [{ _tag: "frame", frameId: "frame_checkout" }],
      stackChangedByChangeId: "change_1",
      issuedIds: { frameIds: ["frame_checkout"] }
    })
    await act(async() => render(
      <CanvasBoard
        {...requiredBoard}
        onSubmit={onSubmit}
        projection={later}
        resolver={resolver}
        snapshotter={snapshotter}
      />
    ))
    expect(frame.style.left).toBe("10px")
    expect(frame.style.top).toBe("20px")
  })

  it("does not paint start geometry after a finished resize before the command lands", async() => {
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
    const handle = container.querySelector("[data-resize-handle='south-east']")
    const board = container.querySelector("[aria-label='Review']")
    const frame = container.querySelector("[aria-label='Checkout']")
    if (
      !(handle instanceof HTMLElement) ||
      !(board instanceof HTMLElement) ||
      !(frame instanceof HTMLElement)
    ) {
      throw new Error("Resize handle missing")
    }

    await act(async() => {
      pointer(handle, "pointerdown", 360, 280)
      pointer(board, "pointermove", 380, 290)
      pointer(board, "pointerup", 380, 290)
    })

    expect(frame.style.left).toBe("40px")
    expect(frame.style.top).toBe("80px")
    expect(frame.style.width).toBe("340px")
    expect(frame.style.height).toBe("210px")
    expect(onSubmit).toHaveBeenCalledWith([{
      _tag: "setFrameGeometry",
      frameId: "frame_checkout",
      expectedChangedByChangeId: "change_1",
      geometry: { x: 40, y: 80, width: 340, height: 210 }
    }])
  })

  it("drops a finished drag overlay when submit throws", async() => {
    const onSubmit = vi.fn(() => {
      throw new Error("replica rejected the geometry")
    })
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

    expect(frame.style.left).toBe("40px")
    expect(frame.style.top).toBe("80px")
    expect(onSubmit).toHaveBeenCalled()
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
    expect(container.querySelector("[aria-label='Open in new tab']")).toBeNull()
    expect(container.querySelector("[aria-label='Remove']")).toBeNull()
    await act(async() => document.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      key: "o"
    })))

    expect(open).toHaveBeenCalledWith(
      url,
      "_blank",
      "noopener,noreferrer"
    )
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("expands a selected Frame over the Canvas without browser fullscreen", async() => {
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
    const board = container.querySelector("[aria-label='Review']")
    const frame = container.querySelector("[aria-label='Checkout']")
    if (!(board instanceof HTMLElement) || !(frame instanceof HTMLElement)) {
      throw new Error("Review Frame missing")
    }
    Object.defineProperties(board, {
      clientWidth: { configurable: true, value: 800 },
      clientHeight: { configurable: true, value: 600 }
    })

    await act(async() => document.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      key: "f"
    })))
    await waitFor(() => expect(frame.hasAttribute("data-fullscreen")).toBe(true))

    expect(document.fullscreenElement).toBeFalsy()
    expect(frame.style.left).toBe("0px")
    expect(frame.style.top).toBe("0px")
    expect(frame.style.width).toBe("800px")
    expect(frame.style.height).toBe("600px")
    expect(frame.querySelector(".crit-selection")).toBeNull()

    await act(async() => document.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      key: "Escape"
    })))
    await waitFor(() => expect(frame.hasAttribute("data-fullscreen")).toBe(false))
    expect(frame.style.left).toBe("40px")
    expect(frame.style.top).toBe("80px")
    expect(frame.querySelector(".crit-selection")).not.toBeNull()
  })

  it("snaps dragged Frame geometry to whole pixels", async() => {
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
        camera={CanvasCamera.make({ x: 0, y: 0, zoom: 2 })}
        onSubmit={onSubmit}
        projection={projection}
        resolver={resolver}
        snapshotter={snapshotter}
      />
    ))
    const frame = container.querySelector("[aria-label='Checkout']")
    if (!(frame instanceof HTMLElement)) throw new Error("Review Frame missing")

    await act(async() => {
      pointer(frame, "pointerdown", 100, 100)
      pointer(window, "pointermove", 103, 105)
      pointer(window, "pointerup", 103, 105)
    })

    expect(onSubmit).toHaveBeenCalledWith([{
      _tag: "setFrameGeometry",
      frameId: "frame_checkout",
      expectedChangedByChangeId: "change_1",
      geometry: { x: 42, y: 83, width: 320, height: 200 }
    }])
  })

  it("warms offscreen Frame renderers during idle and keeps the document when revealed", async() => {
    const bounds = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function() {
        return this.classList.contains("crit-frame")
          ? new DOMRect(10_000, 10_000, 800, 600)
          : new DOMRect(0, 0, 1_280, 720)
      })
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
    if (callback === undefined || observed === undefined) {
      throw new Error("Frame observer missing")
    }
    await act(async() => callback(
      [{ isIntersecting: false, target: observed } as IntersectionObserverEntry],
      {} as IntersectionObserver
    ))
    expect(container.querySelector("iframe")).toBeNull()
    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull())
    const iframe = container.querySelector("iframe")
    expect(container.querySelector("[data-offscreen]")).toBeInstanceOf(HTMLElement)
    await act(async() => callback(
      [{ isIntersecting: true, target: observed } as IntersectionObserverEntry],
      {} as IntersectionObserver
    ))
    expect(container.querySelector("iframe")).toBe(iframe)
    await act(async() => callback(
      [{ isIntersecting: false, target: observed } as IntersectionObserverEntry],
      {} as IntersectionObserver
    ))

    expect(container.querySelector("iframe")).toBe(iframe)
    expect(container.querySelector("[data-offscreen]")).toBeInstanceOf(HTMLElement)
    expect(container.textContent).toContain("Frame paused while offscreen")
    bounds.mockRestore()
  })

  it("keeps the same iframe through selection and a later projection", async() => {
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
      />
    ))
    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull())
    const iframe = container.querySelector("iframe")
    expect(iframe).toBeInstanceOf(HTMLIFrameElement)

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
    expect(container.querySelector("iframe")).toBe(iframe)

    await act(async() => render(
      <CanvasBoard
        {...requiredBoard}
        onSubmit={vi.fn()}
        projection={reviewProjection("ready-for-review")}
        resolver={resolver}
        snapshotter={snapshotter}
        selection={CanvasSelection.make([{
          _tag: "frame",
          frameId: "frame_checkout"
        }])}
      />
    ))
    expect(container.querySelector("iframe")).toBe(iframe)
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
    expect(container.querySelector("[aria-label='Align and distribute']")).toBeNull()
    expect(container.querySelector("[aria-label='Add frame']")).toBeNull()
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
        selection={CanvasSelection.make([])}
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
    const approved = document.querySelector("[aria-label='Set status to approved']")
    if (!(approved instanceof HTMLElement)) {
      throw new Error("Approved status action missing")
    }
    await act(async() => approved.click())
    expect(onSubmit).toHaveBeenLastCalledWith([{
      _tag: "setFrameStatus",
      frameId: "frame_checkout",
      status: "approved",
      expectedChangedByChangeId: "change_1"
    }])

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
      expect(menu?.textContent).not.toContain("Remove")
      expect(menu?.textContent).toContain("Open in new tabO")
      expect(menu?.textContent).toContain("Bring to front")
      expect(menu?.textContent).toContain("Bring to front⌘]")
      expect(menu?.textContent).toContain("Resize to")
      expect(menu?.textContent).toContain("Duplicate at")
      expect(menu?.textContent).not.toContain("Fit frame content")
    })
  })

  it("shows resolved help and ARIA shortcuts from frame-header actions", async() => {
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
        selection={CanvasSelection.make([])}
      />
    ))

    const snapshot = container.querySelector("[aria-label='Snapshot']")
    if (!(snapshot instanceof HTMLButtonElement)) {
      throw new Error("Snapshot action missing")
    }
    expect(snapshot.getAttribute("aria-keyshortcuts")).toBe("S")
    await act(async() => snapshot.dispatchEvent(
      new Event("pointerover", { bubbles: true })
    ))
    await waitFor(() => {
      const help = container.querySelector("[aria-label='Control help']")
      expect(help?.textContent).toContain("Snapshot")
      expect(help?.textContent).toContain("Capture the selected live Frames")
      expect(help?.textContent).not.toContain("Select at least one live Frame")
      expect(help?.querySelector(".crit-help__shortcut")?.textContent).toBe("S")
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

    expect(container.querySelector("[aria-label='Add frame']")).toBeNull()
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

  it("persists marquee selection only on pointerup", async() => {
    const onSelectionChange = vi.fn()
    const resolver: FrameRepresentationResolver = {
      resolve: () => Effect.succeed(IframeRenderPlan.make({
        representation: projection.frames[0]!.representation,
        url
      }) satisfies RenderPlan)
    }

    await act(async() => render(
      <CanvasBoard
        {...requiredBoard}
        onSelectionChange={onSelectionChange}
        projection={projection}
        resolver={resolver}
      />
    ))
    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull())

    const board = container.querySelector("[aria-label='Review']")
    expect(board).toBeInstanceOf(HTMLElement)
    if (!(board instanceof HTMLElement)) return

    await act(async() => {
      pointer(board, "pointerdown", 10, 10)
      pointer(window, "pointermove", 400, 300)
    })
    expect(onSelectionChange).not.toHaveBeenCalled()

    await act(async() => {
      pointer(window, "pointerup", 400, 300)
    })
    expect(onSelectionChange).toHaveBeenCalledTimes(1)
    expect(onSelectionChange).toHaveBeenCalledWith(CanvasSelection.make([{
      _tag: "frame",
      frameId: "frame_checkout"
    }]))
  })
})
