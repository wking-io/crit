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

import { type FrameCommentDownMessage } from "@crit/protocol"

import {
  CanvasBoard,
  CanvasCamera,
  type FrameRepresentationResolver
} from "../src/index.js"
import { requiredBoard } from "./required-board.js"

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true })
notifyManager.setNotifyFunction((callback) => act(callback))
notifyManager.setScheduler(queueMicrotask)

const url = "https://example.com/checkout"
const projectionInput = {
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
}

const projection = decodeCanvasProjection(projectionInput)
const threadedProjection = decodeCanvasProjection({
  ...projectionInput,
  threads: [{
    threadId: "thread_element",
    anchor: {
      _tag: "element",
      frameId: "frame_checkout",
      representationChangedByChangeId: "change_1",
      selector: "[data-total]",
      fingerprint: {
        tagName: "button",
        evidence: [{ kind: "test-id", value: "checkout-total" }]
      },
      point: { x: 0.5, y: 0.25 },
      fallback: { x: 0.75, y: 0.2 }
    },
    resolved: false,
    comments: [{
      commentId: "comment_element",
      body: "Inspect the total",
      author: { _tag: "person", personId: "person_ada", displayName: "Ada" },
      createdByChangeId: "change_1",
      bodyChangedByChangeId: "change_1"
    }],
    createdByChangeId: "change_1",
    updatedByChangeId: "change_1",
    anchorChangedByChangeId: "change_1",
    resolutionChangedByChangeId: "change_1"
  }, {
    threadId: "thread_frame",
    anchor: {
      _tag: "frame",
      frameId: "frame_checkout",
      point: { x: 0.25, y: 0.5 }
    },
    resolved: false,
    comments: [{
      commentId: "comment_frame_first",
      body: "Review checkout spacing",
      author: { _tag: "person", personId: "person_ada", displayName: "Ada" },
      createdByChangeId: "change_1",
      bodyChangedByChangeId: "change_1"
    }, {
      commentId: "comment_frame_reply",
      body: "This is the reply",
      author: { _tag: "person", personId: "person_ada", displayName: "Ada" },
      createdByChangeId: "change_1",
      bodyChangedByChangeId: "change_1"
    }],
    createdByChangeId: "change_1",
    updatedByChangeId: "change_1",
    anchorChangedByChangeId: "change_1",
    resolutionChangedByChangeId: "change_1"
  }, {
    threadId: "thread_resolved",
    anchor: {
      _tag: "frame",
      frameId: "frame_checkout",
      point: { x: 0.4, y: 0.6 }
    },
    resolved: true,
    comments: [{
      commentId: "comment_resolved",
      body: "Confirm tax copy",
      author: { _tag: "person", personId: "person_ada", displayName: "Ada" },
      createdByChangeId: "change_1",
      bodyChangedByChangeId: "change_1"
    }],
    createdByChangeId: "change_1",
    updatedByChangeId: "change_1",
    anchorChangedByChangeId: "change_1",
    resolutionChangedByChangeId: "change_1"
  }],
  issuedIds: {
    frameIds: ["frame_checkout"],
    noteIds: ["note_price"],
    threadIds: ["thread_element", "thread_frame", "thread_resolved"],
    commentIds: [
      "comment_element",
      "comment_frame_first",
      "comment_frame_reply",
      "comment_resolved"
    ]
  }
})

const resolver: FrameRepresentationResolver = {
  resolve: () => Effect.succeed(IframeRenderPlan.make({
    representation: projection.frames[0]!.representation,
    url
  }) satisfies RenderPlan)
}
const camera = CanvasCamera.make({ x: 12, y: -8, zoom: 0.5 })

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

describe("CanvasBoard comment pins", () => {
  it("renders no pins when the projection has no threads", async() => {
    await renderReady(<CanvasBoard {...requiredBoard}  projection={projection} resolver={resolver} />)

    const frame = container.querySelector("[aria-label='Checkout']")
    expect(frame).toBeInstanceOf(HTMLElement)
    if (!(frame instanceof HTMLElement)) return
    expect(frame.children).toHaveLength(1)
    expect(frame.querySelector("[aria-label='Review checkout spacing by Ada']")).toBeNull()
  })

  it("places a Frame-anchored thread inside its Frame", async() => {
    await renderReady(
      <CanvasBoard {...requiredBoard}  projection={threadedProjection} resolver={resolver} />
    )

    const frame = container.querySelector("[aria-label='Checkout']")
    const pin = frame?.querySelector("[aria-label='Review checkout spacing by Ada']")
    expect(frame).toBeInstanceOf(HTMLElement)
    expect(pin).toBeInstanceOf(HTMLElement)
    if (!(frame instanceof HTMLElement) || !(pin instanceof HTMLElement)) return
    expect(pin.parentElement).toBe(frame)
    expect(pin.tagName).toBe("DIV")
    expect(pin.style.left).toBe("25%")
    expect(pin.style.top).toBe("50%")
    expect(pin.style.position).toBe("absolute")
    expect(pin.style.zIndex).toBe("1")
    expect(pin.hasAttribute("data-resolved")).toBe(false)
    expect(frame.querySelector("[aria-label='This is the reply']")).toBeNull()
  })

  it("marks a resolved thread in its label and data attribute", async() => {
    await renderReady(
      <CanvasBoard {...requiredBoard}  projection={threadedProjection} resolver={resolver} />
    )

    const pin = container.querySelector("[aria-label='Resolved: Confirm tax copy by Ada']")
    expect(pin).toBeInstanceOf(HTMLElement)
    if (!(pin instanceof HTMLElement)) return
    expect(pin.getAttribute("data-resolved")).toBe("true")
    expect(pin.getAttribute("data-comment-author")).toBe("Ada")
  })

  it("does not paint an element thread on the Frame chrome", async() => {
    await renderReady(
      <CanvasBoard {...requiredBoard}  projection={threadedProjection} resolver={resolver} />
    )

    const frame = container.querySelector("[aria-label='Checkout']")
    expect(frame).toBeInstanceOf(HTMLElement)
    if (!(frame instanceof HTMLElement)) return
    expect(frame.querySelector("[aria-label='Inspect the total']")).toBeNull()
    expect(frame.querySelector("[aria-label='Review checkout spacing by Ada']"))
      .toBeInstanceOf(HTMLElement)
  })

  it("configures live element pins on the Frame comment bridge", async() => {
    const posted: FrameCommentDownMessage[] = []
    const frameWindow = {
      postMessage(message: FrameCommentDownMessage) {
        posted.push(message)
      }
    }
    const stubWindow = frameWindow as Window
    const contentWindow = vi.spyOn(HTMLIFrameElement.prototype, "contentWindow", "get")
      .mockReturnValue(stubWindow)

    await renderReady(
      <CanvasBoard {...requiredBoard}  projection={threadedProjection} resolver={resolver} />
    )
    await waitFor(() => expect(posted.length).toBeGreaterThan(0))

    const pin = posted.at(-1)?.event.pins[0]
    expect(pin?.id).toBe("thread_element")
    expect(pin?.anchor).toMatchObject({
      kind: "element",
      documentUrl: url,
      selector: "[data-total]",
      point: { x: 0.5, y: 0.25 }
    })
    expect(pin?.anchor.point).not.toEqual({ x: 0.75, y: 0.2 })
    contentWindow.mockRestore()
  })

  it("keeps pins inside the transformed camera world", async() => {
    await renderReady(
      <CanvasBoard
        {...requiredBoard}
        camera={camera}
        projection={threadedProjection}
        resolver={resolver}
      />
    )

    const board = container.querySelector("[aria-label='Review']")
    const pin = container.querySelector("[aria-label='Review checkout spacing by Ada']")
    expect(board).toBeInstanceOf(HTMLElement)
    expect(pin).toBeInstanceOf(HTMLElement)
    if (!(board instanceof HTMLElement) || !(pin instanceof HTMLElement)) return
    const world = worldLayer(board)
    expect(world).toBeInstanceOf(HTMLElement)
    if (!(world instanceof HTMLElement)) return
    expect(world.contains(pin)).toBe(true)
  })
})
