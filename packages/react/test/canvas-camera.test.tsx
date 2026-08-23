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

const posed = CanvasCamera.make({ x: 12, y: -8, zoom: 0.5 })
const recentered = CanvasCamera.make({ x: 40, y: 40, zoom: 2 })

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

describe("CanvasCamera", () => {
  it("rejects zoom that is not a positive finite number", () => {
    for (const zoom of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => CanvasCamera.make({ x: 0, y: 0, zoom })).toThrow()
    }
  })
})

describe("CanvasBoard camera", () => {
  it("leaves the board untransformed when no camera is passed", async() => {
    await act(async() => render(
      <CanvasBoard projection={projection} resolver={resolver} />
    ))
    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull())
    const board = container.querySelector("[aria-label='Review']")
    expect(board).toBeInstanceOf(HTMLElement)
    if (!(board instanceof HTMLElement)) return
    expect(worldLayer(board)).toBeUndefined()
    expect(board.querySelector("[aria-label='Checkout']")).toBeInstanceOf(HTMLElement)
  })

  it("applies translate then scale on a world layer", async() => {
    await act(async() => render(
      <CanvasBoard camera={posed} projection={projection} resolver={resolver} />
    ))
    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull())
    const board = container.querySelector("[aria-label='Review']")
    expect(board).toBeInstanceOf(HTMLElement)
    if (!(board instanceof HTMLElement)) return
    const world = worldLayer(board)
    if (!(world instanceof HTMLElement)) return
    expect(world.style.transform).toBe("translate(12px, -8px) scale(0.5)")
    expect(world.style.transformOrigin).toBe("0 0")
    const frame = container.querySelector("[aria-label='Checkout']")
    expect(frame).toBeInstanceOf(HTMLElement)
    if (!(frame instanceof HTMLElement)) return
    expect(frame.style.left).toBe("40px")
    expect(frame.style.top).toBe("80px")
    expect(world.contains(frame)).toBe(true)
  })

  it("replaces the transform when the host passes a new camera", async() => {
    await act(async() => render(
      <CanvasBoard camera={posed} projection={projection} resolver={resolver} />
    ))
    const board = container.querySelector("[aria-label='Review']")
    expect(board).toBeInstanceOf(HTMLElement)
    if (!(board instanceof HTMLElement)) return
    const first = worldLayer(board)
    if (!(first instanceof HTMLElement)) return
    expect(first.style.transform).toBe("translate(12px, -8px) scale(0.5)")

    await act(async() => render(
      <CanvasBoard camera={recentered} projection={projection} resolver={resolver} />
    ))
    const next = worldLayer(board)
    if (!(next instanceof HTMLElement)) return
    expect(next.style.transform).toBe("translate(40px, 40px) scale(2)")
  })
})

describe("ReplicaBoard camera", () => {
  it("keeps sync chrome outside the transformed world", async() => {
    await act(async() => render(
      <ReplicaBoard camera={posed} resolver={resolver} view={view} />
    ))
    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull())
    const chrome = container.querySelector("[aria-label='Review sync status']")
    const board = container.querySelector("[aria-label='Review']")
    expect(chrome).toBeInstanceOf(HTMLElement)
    expect(board).toBeInstanceOf(HTMLElement)
    if (!(chrome instanceof HTMLElement) || !(board instanceof HTMLElement)) return
    const world = worldLayer(board)
    if (!(world instanceof HTMLElement)) return
    expect(world.contains(chrome)).toBe(false)
    expect(chrome.style.transform).toBe("")
    expect(world.style.transform).toBe("translate(12px, -8px) scale(0.5)")
  })
})
