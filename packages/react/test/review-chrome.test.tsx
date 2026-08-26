import {
  ArtifactRepresentation,
  Id,
  decodeCanvasProjection
} from "@crit/domain"
import { Effect } from "effect"
import { act, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CanvasSelection } from "../src/canvas-selection.js"
import type { FrameSnapshotter } from "../src/frame-snapshot.js"
import { ReviewChrome } from "../src/review-chrome.js"
import {
  reviewActionPolicies,
  type ReviewSelection
} from "../src/review-actions.js"

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true })

const projection = decodeCanvasProjection({
  schemaVersion: 3,
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
  stack: [
    { _tag: "frame", frameId: "frame_checkout" }
  ],
  stackChangedByChangeId: "change_1",
  issuedIds: {
    frameIds: ["frame_checkout"]
  }
})

const selection = (
  items: Parameters<typeof CanvasSelection.make>[0]
): ReviewSelection => ({
  _tag: "items",
  items: CanvasSelection.make(items)
})

const selectedFrame = selection([
  { _tag: "frame", frameId: "frame_checkout" }
])

const artifactProjection = decodeCanvasProjection({
  schemaVersion: 3,
  canvasId: "canvas_artifact",
  title: "Artifact review",
  frames: [{
    frameId: "frame_artifact",
    title: "Captured checkout",
    representation: {
      _tag: "artifact",
      artifactId: "artifact_existing",
      digest: `sha256:${"1".repeat(64)}`
    },
    status: "approved",
    geometry: { x: 10, y: 20, width: 300, height: 180 },
    createdByChangeId: "change_1",
    updatedByChangeId: "change_1",
    titleChangedByChangeId: "change_1",
    representationChangedByChangeId: "change_1",
    statusChangedByChangeId: "change_1",
    geometryChangedByChangeId: "change_1"
  }],
  stack: [{ _tag: "frame", frameId: "frame_artifact" }],
  stackChangedByChangeId: "change_1",
  issuedIds: { frameIds: ["frame_artifact"] }
})

const capturedArtifact = ArtifactRepresentation.make({
  artifactId: Id.artifact("artifact_snapshot"),
  digest: `sha256:${"a".repeat(64)}`
})

const frameSnapshotter = (): FrameSnapshotter => ({
  capture: () => Effect.succeed(capturedArtifact)
})

const removePolicy = reviewActionPolicies.find((entry) => entry.id === "remove")
if (removePolicy === undefined) throw new Error("Missing remove policy")

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

const helpPanel = () => {
  const panel = container.querySelector('[aria-label="Control help"]')
  if (!(panel instanceof HTMLElement)) {
    throw new Error("Control help missing")
  }
  return panel
}

const press = (key: string) => {
  document.dispatchEvent(new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true
  }))
}

const setInputValue = (input: HTMLInputElement, value: string) => {
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set
  setValue?.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
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
  it("submits a captured artifact Frame from the Snapshot button and S", async() => {
    const onSubmit = vi.fn()
    const snapshotter = frameSnapshotter()
    await act(async() => render(
      <ReviewChrome
        onSubmit={onSubmit}
        projection={projection}
        selection={selectedFrame}
        snapshotter={snapshotter}
      />
    ))

    await act(async() => button("Snapshot").click())
    await act(async() => vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1)))
    expect(onSubmit).toHaveBeenLastCalledWith([{
      _tag: "addFrame",
      frameId: expect.stringMatching(/^frame_[0-9a-f]{32}$/),
      title: "Checkout",
      representation: capturedArtifact,
      status: "in-progress",
      geometry: { x: -320, y: 80, width: 320, height: 200 }
    }])

    await act(async() => press("S"))
    await act(async() => vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2)))
    expect(onSubmit).toHaveBeenLastCalledWith([{
      _tag: "addFrame",
      frameId: expect.stringMatching(/^frame_[0-9a-f]{32}$/),
      title: "Checkout",
      representation: capturedArtifact,
      status: "in-progress",
      geometry: { x: -320, y: 80, width: 320, height: 200 }
    }])
  })

  it("hides Snapshot for an artifact-only selection", async() => {
    await act(async() => render(
      <ReviewChrome
        onSubmit={vi.fn()}
        projection={artifactProjection}
        selection={selection([{ _tag: "frame", frameId: "frame_artifact" }])}
        snapshotter={frameSnapshotter()}
      />
    ))

    expect(container.querySelector("[aria-label='Snapshot']")).toBeNull()
  })

  it("disables Snapshot and ignores S while capture is in flight", async() => {
    let complete: (() => void) | undefined
    const capture = vi.fn(() => Effect.callback<
      typeof capturedArtifact,
      unknown
    >((resume) => {
      complete = () => resume(Effect.succeed(capturedArtifact))
    }))
    const onSubmit = vi.fn()
    await act(async() => render(
      <ReviewChrome
        onSubmit={onSubmit}
        projection={projection}
        selection={selectedFrame}
        snapshotter={{ capture }}
      />
    ))

    await act(async() => button("Snapshot").click())
    expect(button("Snapshot").disabled).toBe(true)
    expect(container.querySelector("[role='status']")?.textContent)
      .toBe("Capturing snapshot.")
    await act(async() => press("S"))
    expect(capture).toHaveBeenCalledTimes(1)

    await act(async() => complete?.())
    await act(async() => vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1)))
  })

  it("shows a bounded Snapshot failure", async() => {
    await act(async() => render(
      <ReviewChrome
        onSubmit={vi.fn()}
        projection={projection}
        selection={selectedFrame}
        snapshotter={{
          capture: () => Effect.fail("private capture failure")
        }}
      />
    ))

    await act(async() => button("Snapshot").click())
    await act(async() => vi.waitFor(() => expect(
      container.querySelector("[role='alert']")?.textContent
    ).toBe("Snapshot failed.")))
    expect(container.textContent).not.toContain("private capture failure")
  })

  it("submits remove, status, and stack batches", async() => {
    const onSubmit = vi.fn()
    await act(async() => render(
      <ReviewChrome
        onSubmit={onSubmit}
        projection={projection}
        selection={selectedFrame}
      />
    ))

    await act(async() => button("Set status to approved").click())
    expect(onSubmit).toHaveBeenLastCalledWith([{
      _tag: "setFrameStatus",
      frameId: "frame_checkout",
      expectedChangedByChangeId: "change_1",
      status: "approved"
    }])

    await act(async() => button("Bring to front").click())
    expect(onSubmit).toHaveBeenLastCalledWith([{
      _tag: "placeCanvasItem",
      item: { _tag: "frame", frameId: "frame_checkout" },
      after: null,
      expectedStackChangeId: "change_1"
    }])

    await act(async() => button("Remove").click())
    expect(onSubmit).toHaveBeenLastCalledWith([{
      _tag: "removeFrame",
      frameId: "frame_checkout",
      expectedUpdatedByChangeId: "change_1"
    }])

    expect(container.querySelector("[aria-label='Enter fullscreen']"))
      .toBeInstanceOf(HTMLButtonElement)
    expect(container.querySelector("[aria-label='Exit fullscreen']")).toBeNull()
  })

  it("does not offer Add frame in the review UI", async() => {
    await act(async() => render(
      <ReviewChrome
        onSubmit={vi.fn()}
        projection={projection}
        selection={selection([])}
      />
    ))

    expect(container.querySelector("[aria-label='Add frame']")).toBeNull()
    expect(container.querySelector("[aria-label='Frame URL']")).toBeNull()
    expect(container.textContent).not.toContain("Add frame")
    expect(container.querySelector("[aria-label='Pause offscreen frames']"))
      .toBeNull()
    expect(container.querySelector("[aria-label='Set status to approved']"))
      .toBeNull()
    expect(container.querySelector("[aria-label='Enter fullscreen']")).toBeNull()
  })

  it("lists Remove and its table shortcut in idle help", async() => {
    await act(async() => render(
      <ReviewChrome
        onSubmit={vi.fn()}
        projection={projection}
        selection={selectedFrame}
      />
    ))

    const idle = helpPanel().textContent ?? ""
    expect(idle).toContain(removePolicy.label)
    const shortcut = removePolicy.shortcuts[0]
    if (shortcut === undefined) throw new Error("Remove shortcut missing")
    expect(idle).toContain(shortcut)
  })

  it("shows the Remove policy description on pointer over", async() => {
    await act(async() => render(
      <ReviewChrome
        onSubmit={vi.fn()}
        projection={projection}
        selection={selectedFrame}
      />
    ))

    await act(async() => {
      button("Remove").dispatchEvent(new Event("pointerover", { bubbles: true }))
    })

    expect(helpPanel().textContent).toContain(removePolicy.description)
  })

  it("submits remove from Delete and Backspace when a Frame is selected", async() => {
    const onSubmit = vi.fn()
    await act(async() => render(
      <ReviewChrome
        onSubmit={onSubmit}
        projection={projection}
        selection={selectedFrame}
      />
    ))

    await act(async() => press("Delete"))
    expect(onSubmit).toHaveBeenLastCalledWith([{
      _tag: "removeFrame",
      frameId: "frame_checkout",
      expectedUpdatedByChangeId: "change_1"
    }])

    await act(async() => press("Backspace"))
    expect(onSubmit).toHaveBeenCalledTimes(2)
    expect(onSubmit).toHaveBeenLastCalledWith([{
      _tag: "removeFrame",
      frameId: "frame_checkout",
      expectedUpdatedByChangeId: "change_1"
    }])
  })

  it("does not remove when Delete is pressed in a text input", async() => {
    const onSubmit = vi.fn()
    await act(async() => render(
      <ReviewChrome
        onSubmit={onSubmit}
        projection={projection}
        selection={selectedFrame}
      />
    ))
    const input = container.querySelector("[aria-label='Canvas title']")
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("Canvas title input missing")
    }

    await act(async() => {
      input.focus()
      press("Delete")
    })

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("enters fullscreen from F when a single Frame is selected", async() => {
    const onEffect = vi.fn()
    await act(async() => render(
      <ReviewChrome
        onEffect={onEffect}
        onSubmit={vi.fn()}
        projection={projection}
        selection={selectedFrame}
      />
    ))

    await act(async() => press("F"))
    expect(onEffect).toHaveBeenCalledWith({
      _tag: "fullscreen",
      target: "frame"
    })
  })

  it("exits fullscreen from Escape when a Frame is selected", async() => {
    const onEffect = vi.fn()
    await act(async() => render(
      <ReviewChrome
        fullscreen
        onEffect={onEffect}
        onSubmit={vi.fn()}
        projection={projection}
        selection={selectedFrame}
      />
    ))

    await act(async() => press("Escape"))
    expect(onEffect).toHaveBeenCalledWith({
      _tag: "fullscreen",
      target: "exit"
    })
  })

  it("submits rename canvas from the form", async() => {
    const onSubmit = vi.fn()
    await act(async() => render(
      <ReviewChrome
        onSubmit={onSubmit}
        projection={projection}
        selection={selectedFrame}
      />
    ))
    const input = container.querySelector("[aria-label='Canvas title']")
    const form = container.querySelector("form[aria-label='Rename canvas']")
    if (!(input instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) {
      throw new Error("Rename canvas form missing")
    }

    await act(async() => setInputValue(input, "Updated review"))
    await act(async() => form.requestSubmit())

    expect(onSubmit).toHaveBeenCalledWith([{
      _tag: "renameCanvas",
      expectedTitle: "Review",
      title: "Updated review"
    }])
  })
})
