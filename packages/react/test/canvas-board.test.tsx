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
      <CanvasBoard projection={projection} resolver={resolver} />
    ))
    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull())

    const board = container.querySelector("[aria-label='Review']")
    const frame = container.querySelector("[aria-label='Checkout']")
    const note = container.querySelector("article")
    expect(board).not.toBeNull()
    expect(frame).toBeInstanceOf(HTMLElement)
    if (!(frame instanceof HTMLElement)) return
    expect(frame.style.left).toBe("40px")
    expect(frame.style.top).toBe("80px")
    expect(frame.style.width).toBe("320px")
    expect(frame.style.height).toBe("200px")
    expect(frame.style.zIndex).toBe("0")
    expect(note?.textContent).toBe("Check the price")
    expect(note?.style.left).toBe("400px")
    expect(note?.style.zIndex).toBe("1")
    expect(container.querySelector("iframe")?.getAttribute("src")).toBe(url)
  })

  it("shows an empty canvas without looking up missing items", async() => {
    const resolver: FrameRepresentationResolver = {
      resolve: () => Effect.die("empty canvas must not resolve a Frame")
    }
    await act(async() => render(
      <CanvasBoard projection={empty} resolver={resolver} />
    ))
    expect(container.querySelector("[role='status']")?.textContent).toBe(
      "Empty has no Frames or Notes."
    )
    expect(container.querySelector("iframe")).toBeNull()
    expect(container.querySelector("article")).toBeNull()
  })
})
