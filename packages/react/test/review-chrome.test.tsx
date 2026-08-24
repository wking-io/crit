import { decodeCanvasProjection } from "@crit/domain"
import { act, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CanvasSelection } from "../src/canvas-selection.js"
import { ReviewChrome } from "../src/review-chrome.js"
import type { ReviewSelection } from "../src/review-actions.js"

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true })

const projection = decodeCanvasProjection({
  schemaVersion: 2,
  canvasId: "canvas_review",
  title: "Review",
  frames: [{
    frameId: "frame_checkout",
    title: "Checkout",
    representation: { _tag: "web-url", url: "https://example.com" },
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
    attachedFrameId: null,
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

const selection = (
  items: Parameters<typeof CanvasSelection.make>[0]
): ReviewSelection => ({
  _tag: "items",
  items: CanvasSelection.make(items)
})

let container: HTMLDivElement
let root: Root

const render = (element: ReactElement) => root.render(element)

const button = (label: string) => {
  const match = container.querySelector(`[aria-label="${label}"]`)
  if (!(match instanceof HTMLButtonElement)) {
    throw new Error(`Button missing: ${label}`)
  }
  return match
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
})

describe("ReviewChrome", () => {
  it("submits remove, status, and stack batches", async() => {
    const onSubmit = vi.fn()
    await act(async() => render(
      <ReviewChrome
        onSubmit={onSubmit}
        projection={projection}
        selection={selection([
          { _tag: "frame", frameId: "frame_checkout" }
        ])}
      />
    ))

    await act(async() => button("Set status to approved").click())
    expect(onSubmit).toHaveBeenLastCalledWith([{
      _tag: "set-frame-status",
      frameId: "frame_checkout",
      expectedChangedByChangeId: "change_1",
      status: "approved"
    }])

    await act(async() => button("Bring to front").click())
    expect(onSubmit).toHaveBeenLastCalledWith([{
      _tag: "place-canvas-item",
      item: { _tag: "frame", frameId: "frame_checkout" },
      after: { _tag: "note", noteId: "note_price" },
      expectedStackChangeId: "change_1"
    }])

    await act(async() => button("Remove").click())
    expect(onSubmit).toHaveBeenLastCalledWith([{
      _tag: "remove-frame",
      frameId: "frame_checkout",
      expectedUpdatedByChangeId: "change_1"
    }])

    expect(container.querySelector("[aria-label='Enter fullscreen']"))
      .toBeInstanceOf(HTMLButtonElement)
    expect(container.querySelector("[aria-label='Exit fullscreen']")).toBeNull()
  })

  it("submits an add-note batch from the form", async() => {
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValue("00000000-0000-4000-8000-000000000001")
    const onSubmit = vi.fn()
    await act(async() => render(
      <ReviewChrome
        onSubmit={onSubmit}
        projection={projection}
        selection={selection([])}
      />
    ))
    const input = container.querySelector("[aria-label='Note text']")
    const form = container.querySelector("form[aria-label='Add note']")
    if (!(input instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) {
      throw new Error("Add Note form missing")
    }

    await act(async() => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set
      setValue?.call(input, "New note")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async() => form.requestSubmit())

    expect(onSubmit).toHaveBeenCalledWith([{
      _tag: "add-note",
      noteId: "note_00000000000040008000000000000001",
      text: "New note",
      color: "neutral",
      geometry: { x: 40, y: 40, width: 240, height: 160 },
      attachedFrameId: null
    }])
  })
})
