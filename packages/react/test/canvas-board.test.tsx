import { decodeCanvasProjection, proposeSetNoteColor } from "@crit/domain"
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
  type FrameRepresentationResolver
} from "../src/index.js"
import { requiredBoard } from "./required-board.js"

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true })
notifyManager.setNotifyFunction((callback) => act(callback))
notifyManager.setScheduler(queueMicrotask)

const url = "https://example.com/checkout"
const reviewProjection = (status: "in-progress" | "ready-for-review") =>
  decodeCanvasProjection({
    schemaVersion: 2,
    canvasId: "canvas_review",
    title: "Review",
    frames: [{
      frameId: "frame_checkout",
      title: "Checkout",
      representation: { _tag: "web-url", url },
      status,
      geometry: { x: 40, y: 80, width: 320, height: 200 },
      createdByChangeId: "change_1",
      updatedByChangeId: "change_1",
      titleChangedByChangeId: "change_1",
      representationChangedByChangeId: "change_1",
      statusChangedByChangeId: "change_1",
      geometryChangedByChangeId: "change_1"
    }],
    notes: [{
      noteId: "note_price",
      text: "Check the price",
      geometry: { x: 400, y: 80, width: 160, height: 80 },
      attachedFrameId: "frame_checkout",
      author: { _tag: "person", personId: "person_ada", displayName: "Ada" },
      color: "blue",
      createdByChangeId: "change_1",
      updatedByChangeId: "change_1",
      textChangedByChangeId: "change_1",
      colorChangedByChangeId: "change_1",
      geometryChangedByChangeId: "change_1",
      attachmentChangedByChangeId: "change_1"
    }],
    threads: [],
    stack: [
      { _tag: "frame", frameId: "frame_checkout" },
      { _tag: "note", noteId: "note_price" }
    ],
    stackChangedByChangeId: "change_1",
    issuedIds: {
      frameIds: ["frame_checkout"],
      noteIds: ["note_price"],
      threadIds: [],
      commentIds: []
    }
  })
const projection = reviewProjection("in-progress")

const empty = decodeCanvasProjection({
  schemaVersion: 2,
  canvasId: "canvas_empty",
  title: "Empty",
  frames: [],
  notes: [],
  threads: [],
  stack: [],
  stackChangedByChangeId: null,
  issuedIds: { frameIds: [], noteIds: [], threadIds: [], commentIds: [] }
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
})

describe("CanvasBoard", () => {
  it("places Frames and Notes from the projection stack", async() => {
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
    const note = container.querySelector("[aria-label='Check the price by Ada']")
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
    expect(note?.textContent).toBe("Check the price")
    expect(note?.getAttribute("data-note-color")).toBe("blue")
    expect(note?.getAttribute("data-note-author")).toBe("Ada")
    expect(note?.style.left).toBe("400px")
    expect(note?.style.zIndex).toBe("1")
    expect(container.querySelector("iframe")?.getAttribute("src")).toBe(url)
  })

  it("shows an empty canvas without looking up missing items", async() => {
    const resolver: FrameRepresentationResolver = {
      resolve: () => Effect.die("empty canvas must not resolve a Frame")
    }
    await act(async() => render(
      <CanvasBoard {...requiredBoard} projection={empty} resolver={resolver} />
    ))
    expect(container.querySelector("[role='status']")?.textContent).toBe(
      "Empty has no Frames or Notes."
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

  it("submits a Note Color change for the selected Note", async() => {
    const onSubmit = vi.fn()
    const resolver: FrameRepresentationResolver = {
      resolve: () => Effect.succeed(IframeRenderPlan.make({
        representation: projection.frames[0]!.representation,
        url
      }) satisfies RenderPlan)
    }
    const note = projection.notes[0]
    if (note === undefined) throw new Error("Note missing")
    await act(async() => render(
      <CanvasBoard
        {...requiredBoard}
        onSubmit={onSubmit}
        projection={projection}
        resolver={resolver}
        selection={CanvasSelection.make([{ _tag: "note", noteId: note.noteId }])}
      />
    ))
    const green = container.querySelector(
      "[aria-label='Set note color to green']"
    )
    expect(green).toBeInstanceOf(HTMLButtonElement)
    if (!(green instanceof HTMLButtonElement)) return
    await act(async() => green.click())
    expect(onSubmit).toHaveBeenCalledWith([proposeSetNoteColor(note, "green")])
  })

  it("removes the selected item with Delete", async() => {
    const onSubmit = vi.fn()
    const resolver: FrameRepresentationResolver = {
      resolve: () => Effect.succeed(IframeRenderPlan.make({
        representation: projection.frames[0]!.representation,
        url
      }) satisfies RenderPlan)
    }
    const note = projection.notes[0]
    if (note === undefined) throw new Error("Note missing")
    await act(async() => render(
      <CanvasBoard
        {...requiredBoard}
        onSubmit={onSubmit}
        projection={projection}
        resolver={resolver}
        selection={CanvasSelection.make([{ _tag: "note", noteId: note.noteId }])}
      />
    ))

    await act(async() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete" }))
    })
    expect(onSubmit).toHaveBeenCalledWith([{
      _tag: "remove-note",
      noteId: "note_price",
      expectedUpdatedByChangeId: "change_1"
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
      _tag: "set-frame-geometry",
      frameId: "frame_checkout",
      expectedChangedByChangeId: "change_1",
      geometry: { x: 60, y: 110, width: 320, height: 200 }
    }])
  })

  it("submits selected Note geometry after pointer resize", async() => {
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
        selection={CanvasSelection.make([{
          _tag: "note",
          noteId: "note_price"
        }])}
      />
    ))
    const resize = container.querySelector(
      "[aria-label='Resize Check the price']"
    )
    const board = container.querySelector("[aria-label='Review']")
    if (!(resize instanceof HTMLElement) || !(board instanceof HTMLElement)) {
      throw new Error("Note resize handle missing")
    }

    await act(async() => {
      pointer(resize, "pointerdown", 100, 100)
      pointer(board, "pointermove", 130, 120)
      pointer(board, "pointerup", 130, 120)
    })

    expect(onSubmit).toHaveBeenCalledWith([{
      _tag: "set-note-geometry",
      noteId: "note_price",
      expectedChangedByChangeId: "change_1",
      geometry: { x: 400, y: 80, width: 190, height: 100 }
    }])
  })
})
