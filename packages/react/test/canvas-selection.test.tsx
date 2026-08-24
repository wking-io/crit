import { decodeCanvasProjection } from "@crit/domain"
import { ReplicaView } from "@crit/replica"
import {
  IframeRenderPlan,
  type RenderPlan
} from "@crit/representations"
import {
  notifyManager,
  QueryClient,
  QueryClientProvider
} from "@tanstack/react-query"
import { Effect, Schema } from "effect"
import { StrictMode, act, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  CanvasBoard,
  CanvasCamera,
  CanvasSelection,
  ReplicaBoard,
  type FrameRepresentationResolver
} from "../src/index.js"

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true })
notifyManager.setNotifyFunction((callback) => act(callback))
notifyManager.setScheduler(queueMicrotask)

const url = "https://example.com/checkout"
const projection = decodeCanvasProjection({
  schemaVersion: 2,
  canvasId: "canvas_review",
  title: "Review",
  frames: [{
    frameId: "frame_checkout",
    title: "Checkout",
    representation: { _tag: "web-url", url },
    status: "in-progress",
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
    createdByChangeId: "change_1",
    updatedByChangeId: "change_1",
    textChangedByChangeId: "change_1",
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

const view = Schema.decodeUnknownSync(ReplicaView)({
  _tag: "replica-view",
  canvasId: projection.canvasId,
  acknowledgedCursor: "cursor_ack",
  projection,
  pending: []
})

const checkout = projection.stack[0]!
const priceNote = projection.stack[1]!
const checkoutSelection = CanvasSelection.make([checkout])
const bothSelection = CanvasSelection.make([checkout, priceNote])
const emptySelection = CanvasSelection.make([])
const unknownSelection = CanvasSelection.make([
  { _tag: "frame", frameId: "frame_unknown" }
])
const camera = CanvasCamera.make({ x: 12, y: -8, zoom: 0.5 })

const resolver: FrameRepresentationResolver = {
  resolve: () => Effect.succeed(IframeRenderPlan.make({
    representation: projection.frames[0]!.representation,
    url
  }) satisfies RenderPlan)
}

let container: HTMLDivElement
let queryClient: QueryClient
let root: Root

const render = (element: ReactElement) => root.render(
  <QueryClientProvider client={queryClient}>
    <StrictMode>{element}</StrictMode>
  </QueryClientProvider>
)
const waitFor = (assertion: () => void) => act(async() => vi.waitFor(assertion))
const renderReady = async(element: ReactElement): Promise<void> => {
  await act(async() => render(element))
  await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull())
}

const worldLayer = (board: Element) =>
  [...board.children].find((node) =>
    node instanceof HTMLElement && node.style.transform !== ""
  )

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

describe("CanvasSelection", () => {
  it("decodes unique Canvas item refs", () => {
    expect(() => CanvasSelection.make([
      { _tag: "frame", frameId: "checkout" }
    ])).toThrow()
    expect(() => CanvasSelection.make([
      { _tag: "note", noteId: "price" }
    ])).toThrow()
    expect(() => CanvasSelection.make([
      { _tag: "frame", frameId: "frame_checkout" },
      { _tag: "frame", frameId: "frame_checkout" }
    ])).toThrow()

    expect(CanvasSelection.make([])).toEqual([])
    expect(CanvasSelection.make([
      { _tag: "frame", frameId: "frame_checkout" },
      { _tag: "note", noteId: "note_price" }
    ])).toEqual([checkout, priceNote])
  })

  it("reports membership only for included refs", () => {
    expect(CanvasSelection.has(checkoutSelection, checkout)).toBe(true)
    expect(CanvasSelection.has(checkoutSelection, priceNote)).toBe(false)
    expect(CanvasSelection.has(checkoutSelection, unknownSelection[0]!)).toBe(false)
  })
})

describe("CanvasBoard selection", () => {
  it("omits aria-selected when no selection is passed", async() => {
    await renderReady(
      <CanvasBoard projection={projection} resolver={resolver} />
    )

    expect(container.querySelector("[aria-selected='true']")).toBeNull()
  })

  it("marks only the selected Checkout Frame", async() => {
    await renderReady(
      <CanvasBoard
        projection={projection}
        resolver={resolver}
        selection={checkoutSelection}
      />
    )

    const frame = container.querySelector("[aria-label='Checkout']")
    const note = container.querySelector("article")
    expect(frame).toBeInstanceOf(HTMLElement)
    expect(note).toBeInstanceOf(HTMLElement)
    if (!(frame instanceof HTMLElement) || !(note instanceof HTMLElement)) return
    expect(frame.getAttribute("aria-selected")).toBe("true")
    expect(note.hasAttribute("aria-selected")).toBe(false)
  })

  it("marks both selected items", async() => {
    await renderReady(
      <CanvasBoard
        projection={projection}
        resolver={resolver}
        selection={bothSelection}
      />
    )

    const frame = container.querySelector("[aria-label='Checkout']")
    const note = container.querySelector("article")
    expect(frame).toBeInstanceOf(HTMLElement)
    expect(note).toBeInstanceOf(HTMLElement)
    if (!(frame instanceof HTMLElement) || !(note instanceof HTMLElement)) return
    expect(frame.getAttribute("aria-selected")).toBe("true")
    expect(note.getAttribute("aria-selected")).toBe("true")
  })

  it("ignores selected refs that are absent from the projection", async() => {
    await renderReady(
      <CanvasBoard
        projection={projection}
        resolver={resolver}
        selection={unknownSelection}
      />
    )

    const frame = container.querySelector("[aria-label='Checkout']")
    expect(frame).toBeInstanceOf(HTMLElement)
    if (!(frame instanceof HTMLElement)) return
    expect(frame.hasAttribute("aria-selected")).toBe(false)
  })

  it("paints an empty selection like an omitted selection", async() => {
    await renderReady(
      <CanvasBoard projection={projection} resolver={resolver} />
    )
    const omitted = [...container.querySelectorAll(
      "section[aria-label='Checkout'], article"
    )].map((item) => item.getAttribute("aria-selected"))

    await renderReady(
      <CanvasBoard
        projection={projection}
        resolver={resolver}
        selection={emptySelection}
      />
    )
    const empty = [...container.querySelectorAll(
      "section[aria-label='Checkout'], article"
    )].map((item) => item.getAttribute("aria-selected"))

    expect(empty).toEqual(omitted)
    expect(empty).toEqual([null, null])
  })
})

describe("ReplicaBoard selection", () => {
  it("forwards selection to CanvasBoard", async() => {
    await renderReady(
      <ReplicaBoard
        resolver={resolver}
        selection={checkoutSelection}
        view={view}
      />
    )

    const frame = container.querySelector("[aria-label='Checkout']")
    expect(frame).toBeInstanceOf(HTMLElement)
    if (!(frame instanceof HTMLElement)) return
    expect(frame.getAttribute("aria-selected")).toBe("true")
  })

  it("keeps selected items in the camera world and sync chrome outside it", async() => {
    await renderReady(
      <ReplicaBoard
        camera={camera}
        resolver={resolver}
        selection={checkoutSelection}
        view={view}
      />
    )

    const chrome = container.querySelector("[aria-label='Review sync status']")
    const board = container.querySelector("[aria-label='Review']")
    const frame = container.querySelector("[aria-label='Checkout']")
    expect(chrome).toBeInstanceOf(HTMLElement)
    expect(board).toBeInstanceOf(HTMLElement)
    expect(frame).toBeInstanceOf(HTMLElement)
    if (!(chrome instanceof HTMLElement) ||
      !(board instanceof HTMLElement) ||
      !(frame instanceof HTMLElement)) return
    const world = worldLayer(board)
    expect(world).toBeInstanceOf(HTMLElement)
    if (!(world instanceof HTMLElement)) return
    expect(frame.getAttribute("aria-selected")).toBe("true")
    expect(world.contains(frame)).toBe(true)
    expect(world.contains(chrome)).toBe(false)
  })
})
