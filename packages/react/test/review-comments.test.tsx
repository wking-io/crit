import { decodeCanvasProjection } from "@crit/domain"
import { IframeRenderPlan, type RenderPlan } from "@crit/representations"
import {
  notifyManager,
  QueryClient,
  QueryClientProvider
} from "@tanstack/react-query"
import { Effect } from "effect"
import { act, type ReactElement } from "react"
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
  notes: [],
  threads: [{
    threadId: "thread_checkout",
    anchor: {
      _tag: "frame",
      frameId: "frame_checkout",
      point: { x: 0.25, y: 0.5 }
    },
    resolved: false,
    comments: [{
      commentId: "comment_opening",
      body: "Check spacing",
      author: { _tag: "person", personId: "person_ada", displayName: "Ada" },
      createdByChangeId: "change_1",
      bodyChangedByChangeId: "change_1"
    }],
    createdByChangeId: "change_1",
    updatedByChangeId: "change_1",
    anchorChangedByChangeId: "change_1",
    resolutionChangedByChangeId: "change_1"
  }],
  stack: [{ _tag: "frame", frameId: "frame_checkout" }],
  stackChangedByChangeId: "change_1",
  issuedIds: {
    frameIds: ["frame_checkout"],
    noteIds: [],
    threadIds: ["thread_checkout"],
    commentIds: ["comment_opening"]
  }
})

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
    {element}
  </QueryClientProvider>
)

const setInput = async(input: HTMLInputElement, value: string) => {
  await act(async() => {
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set
    setValue?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

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

describe("review comments", () => {
  it("submits a new Frame comment thread", async() => {
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000001")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000002")
    const onSubmit = vi.fn()
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
    const input = container.querySelector("[aria-label='Comment body']")
    const form = container.querySelector("form[aria-label='Add comment']")
    if (!(input instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) {
      throw new Error("Comment form missing")
    }

    await setInput(input, "Review the total")
    await act(async() => form.requestSubmit())

    expect(onSubmit).toHaveBeenCalledWith([{
      _tag: "add-comment-thread",
      threadId: "thread_00000000000040008000000000000001",
      commentId: "comment_00000000000040008000000000000002",
      anchor: {
        _tag: "frame",
        frameId: "frame_checkout",
        point: { x: 0.5, y: 0.5 }
      },
      body: "Review the total"
    }])
  })

  it("selects a pin to reply and resolve", async() => {
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValue("00000000-0000-4000-8000-000000000003")
    const onSubmit = vi.fn()
    await act(async() => render(
      <CanvasBoard
        {...requiredBoard}
        onSubmit={onSubmit}
        projection={projection}
        resolver={resolver}
      />
    ))
    const pin = container.querySelector(
      "[aria-label='Check spacing by Ada']"
    )
    if (!(pin instanceof HTMLElement)) throw new Error("Comment pin missing")

    await act(async() => pin.click())
    expect(pin.getAttribute("data-comment-author")).toBe("Ada")
    expect(pin.textContent).toBe("Ada")
    const input = container.querySelector("[aria-label='Reply body']")
    const form = container.querySelector("form[aria-label='Reply']")
    if (!(input instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) {
      throw new Error("Reply form missing")
    }

    await setInput(input, "Fixed")
    await act(async() => form.requestSubmit())
    expect(onSubmit).toHaveBeenLastCalledWith([{
      _tag: "reply-to-comment-thread",
      threadId: "thread_checkout",
      commentId: "comment_00000000000040008000000000000003",
      body: "Fixed"
    }])

    const resolve = container.querySelector("[aria-label='Resolve']")
    if (!(resolve instanceof HTMLButtonElement)) {
      throw new Error("Resolve action missing")
    }
    await act(async() => resolve.click())
    expect(onSubmit).toHaveBeenLastCalledWith([{
      _tag: "set-comment-thread-resolution",
      threadId: "thread_checkout",
      expectedChangedByChangeId: "change_1",
      resolved: true
    }])
  })
})
