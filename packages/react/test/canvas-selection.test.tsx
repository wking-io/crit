import { decodeCanvasProjection } from "@crit/domain"
import {
  FRAME_INPUT_BRIDGE_SCHEMA_VERSION,
  FRAME_INPUT_BRIDGE_SOURCE
} from "@crit/protocol"
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
import { requiredBoard } from "./required-board.js"

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true })
notifyManager.setNotifyFunction((callback) => act(callback))
notifyManager.setScheduler(queueMicrotask)

const url = "https://example.com/checkout"
const projection = decodeCanvasProjection({
  schemaVersion: 3,
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
  }, {
    frameId: "frame_pricing",
    title: "Pricing",
    representation: { _tag: "web-url", url: "https://example.com/pricing" },
    status: "in-progress",
    geometry: { x: 400, y: 80, width: 320, height: 200 },
    createdByChangeId: "change_1",
    updatedByChangeId: "change_1",
    titleChangedByChangeId: "change_1",
    representationChangedByChangeId: "change_1",
    statusChangedByChangeId: "change_1",
    geometryChangedByChangeId: "change_1"
  }],
  stack: [
    { _tag: "frame", frameId: "frame_checkout" },
    { _tag: "frame", frameId: "frame_pricing" }
  ],
  stackChangedByChangeId: "change_1",
  issuedIds: {
    frameIds: ["frame_checkout", "frame_pricing"]
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
const pricing = projection.stack[1]!
const checkoutSelection = CanvasSelection.make([checkout])
const bothSelection = CanvasSelection.make([checkout, pricing])
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

const pointerDown = (
  target: Element,
  modifiers: MouseEventInit = {}
): void => {
  act(() => {
    target.dispatchEvent(new MouseEvent("pointerdown", {
      ...modifiers,
      bubbles: true
    }))
  })
}

const additivePointerCases: ReadonlyArray<{
  readonly name: string
  readonly modifiers: MouseEventInit
}> = [
  { name: "control", modifiers: { ctrlKey: true } },
  { name: "meta", modifiers: { metaKey: true } },
  { name: "shift", modifiers: { shiftKey: true } }
]

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
      { _tag: "frame", frameId: "frame_pricing" }
    ])).toEqual([checkout, pricing])
  })

  it("reports membership only for included refs", () => {
    expect(CanvasSelection.has(checkoutSelection, checkout)).toBe(true)
    expect(CanvasSelection.has(checkoutSelection, pricing)).toBe(false)
    expect(CanvasSelection.has(checkoutSelection, unknownSelection[0]!)).toBe(false)
  })

  it("applies clear, replace, and additive item commands", () => {
    expect(CanvasSelection.apply(bothSelection, { _tag: "clear" })).toEqual(
      emptySelection
    )
    expect(CanvasSelection.apply(bothSelection, {
      _tag: "item",
      item: checkout,
      additive: false
    })).toEqual(checkoutSelection)
    expect(CanvasSelection.apply(checkoutSelection, {
      _tag: "item",
      item: pricing,
      additive: true
    })).toEqual(bothSelection)
    expect(CanvasSelection.apply(bothSelection, {
      _tag: "item",
      item: pricing,
      additive: true
    })).toEqual(checkoutSelection)
    expect(CanvasSelection.apply(undefined, {
      _tag: "item",
      item: checkout,
      additive: true
    })).toEqual(checkoutSelection)
  })

  it("gives Frame input only to a sole selected Frame", () => {
    expect(CanvasSelection.inputTarget(undefined)).toEqual({ _tag: "camera" })
    expect(CanvasSelection.inputTarget(emptySelection)).toEqual({ _tag: "camera" })
    expect(CanvasSelection.inputTarget(bothSelection)).toEqual({ _tag: "camera" })
    expect(CanvasSelection.inputTarget(checkoutSelection)).toEqual({
      _tag: "frame",
      frameId: "frame_checkout"
    })
  })
})

describe("CanvasBoard selection", () => {
  it("marks only the selected Checkout Frame", async() => {
    await renderReady(
      <CanvasBoard
        {...requiredBoard}
        projection={projection}
        resolver={resolver}
        selection={checkoutSelection}
      />
    )

    const frame = container.querySelector("[aria-label='Checkout']")
    const other = container.querySelector("[aria-label='Pricing']")
    expect(frame).toBeInstanceOf(HTMLElement)
    expect(other).toBeInstanceOf(HTMLElement)
    if (!(frame instanceof HTMLElement) || !(other instanceof HTMLElement)) return
    expect(frame.getAttribute("aria-selected")).toBe("true")
    expect(other.hasAttribute("aria-selected")).toBe(false)
  })

  it("marks both selected items", async() => {
    await renderReady(
      <CanvasBoard
        {...requiredBoard}
        projection={projection}
        resolver={resolver}
        selection={bothSelection}
      />
    )

    const frame = container.querySelector("[aria-label='Checkout']")
    const other = container.querySelector("[aria-label='Pricing']")
    expect(frame).toBeInstanceOf(HTMLElement)
    expect(other).toBeInstanceOf(HTMLElement)
    if (!(frame instanceof HTMLElement) || !(other instanceof HTMLElement)) return
    expect(frame.getAttribute("aria-selected")).toBe("true")
    expect(other.getAttribute("aria-selected")).toBe("true")
  })

  it("ignores selected refs that are absent from the projection", async() => {
    await renderReady(
      <CanvasBoard
        {...requiredBoard}
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

  it("paints an empty selection without aria-selected", async() => {
    await renderReady(
      <CanvasBoard
        {...requiredBoard}
        projection={projection}
        resolver={resolver}
        selection={emptySelection}
      />
    )
    const empty = [...container.querySelectorAll(
      "[aria-label='Checkout'], [aria-label='Pricing']"
    )].map((item) => item.getAttribute("aria-selected"))

    expect(empty).toEqual([null, null])
  })

  it("selects the Checkout Frame on pointer down", async() => {
    const onSelectionChange = vi.fn()
    await renderReady(
      <CanvasBoard
        {...requiredBoard}
        onSelectionChange={onSelectionChange}
        projection={projection}
        resolver={resolver}
      />
    )
    const frame = container.querySelector("[aria-label='Checkout']")
    expect(frame).toBeInstanceOf(HTMLElement)
    if (!(frame instanceof HTMLElement)) return

    pointerDown(frame)

    expect(onSelectionChange).toHaveBeenCalledTimes(1)
    expect(onSelectionChange).toHaveBeenCalledWith(checkoutSelection)
  })

  it("selects the Pricing Frame on pointer down", async() => {
    const onSelectionChange = vi.fn()
    await renderReady(
      <CanvasBoard
        {...requiredBoard}
        onSelectionChange={onSelectionChange}
        projection={projection}
        resolver={resolver}
        selection={checkoutSelection}
      />
    )
    const other = container.querySelector("[aria-label='Pricing']")
    expect(other).toBeInstanceOf(HTMLElement)
    if (!(other instanceof HTMLElement)) return

    pointerDown(other)

    expect(onSelectionChange).toHaveBeenCalledTimes(1)
    expect(onSelectionChange).toHaveBeenCalledWith(
      CanvasSelection.make([pricing])
    )
  })

  it.each(additivePointerCases)(
    "adds and toggles the Pricing Frame with $name",
    async({ modifiers }) => {
      const onSelectionChange = vi.fn()
      await renderReady(
        <CanvasBoard
        {...requiredBoard}
          onSelectionChange={onSelectionChange}
          projection={projection}
          resolver={resolver}
          selection={checkoutSelection}
        />
      )
      const other = container.querySelector("[aria-label='Pricing']")
      expect(other).toBeInstanceOf(HTMLElement)
      if (!(other instanceof HTMLElement)) return

      pointerDown(other, modifiers)
      expect(onSelectionChange).toHaveBeenCalledTimes(1)
      expect(onSelectionChange).toHaveBeenLastCalledWith(bothSelection)

      await renderReady(
        <CanvasBoard
        {...requiredBoard}
          onSelectionChange={onSelectionChange}
          projection={projection}
          resolver={resolver}
          selection={bothSelection}
        />
      )
      pointerDown(other, modifiers)

      expect(onSelectionChange).toHaveBeenCalledTimes(2)
      expect(onSelectionChange).toHaveBeenLastCalledWith(checkoutSelection)
    }
  )

  it("selects a Frame from its bridged select intent without moving the camera", async() => {
    const onCameraChange = vi.fn()
    const onSelectionChange = vi.fn()
    await renderReady(
      <CanvasBoard
        {...requiredBoard}
        onCameraChange={onCameraChange}
        onSelectionChange={onSelectionChange}
        projection={projection}
        resolver={resolver}
      />
    )
    const iframe = container.querySelector("iframe")
    expect(iframe).toBeInstanceOf(HTMLIFrameElement)
    if (!(iframe instanceof HTMLIFrameElement)) return
    const frameWindow = iframe.contentWindow
    expect(frameWindow).not.toBeNull()
    if (frameWindow === null) return

    await act(async() => {
      window.dispatchEvent(new MessageEvent("message", {
        origin: new URL(url).origin,
        source: frameWindow,
        data: {
          source: FRAME_INPUT_BRIDGE_SOURCE,
          schemaVersion: FRAME_INPUT_BRIDGE_SCHEMA_VERSION,
          intent: { type: "select", additive: false }
        }
      }))
    })

    expect(onSelectionChange).toHaveBeenCalledTimes(1)
    expect(onSelectionChange).toHaveBeenCalledWith(checkoutSelection)
    expect(onCameraChange).not.toHaveBeenCalled()
  })

  it("clears selection on empty listbox chrome pointer down", async() => {
    const onSelectionChange = vi.fn()
    await renderReady(
      <CanvasBoard
        {...requiredBoard}
        onSelectionChange={onSelectionChange}
        projection={projection}
        resolver={resolver}
        selection={checkoutSelection}
      />
    )
    const board = container.querySelector("[aria-label='Review']")
    expect(board).toBeInstanceOf(HTMLElement)
    if (!(board instanceof HTMLElement)) return

    pointerDown(board)

    expect(onSelectionChange).toHaveBeenCalledTimes(1)
    expect(onSelectionChange).toHaveBeenCalledWith(emptySelection)
  })
})

describe("ReplicaBoard selection", () => {
  it("forwards selection and selection changes to CanvasBoard", async() => {
    const onSelectionChange = vi.fn()
    await renderReady(
      <ReplicaBoard
        {...requiredBoard}
        onSelectionChange={onSelectionChange}
        resolver={resolver}
        selection={checkoutSelection}
        view={view}
      />
    )

    const frame = container.querySelector("[aria-label='Checkout']")
    const other = container.querySelector("[aria-label='Pricing']")
    expect(frame).toBeInstanceOf(HTMLElement)
    expect(other).toBeInstanceOf(HTMLElement)
    if (!(frame instanceof HTMLElement) || !(other instanceof HTMLElement)) return
    expect(frame.getAttribute("aria-selected")).toBe("true")

    pointerDown(other)

    expect(onSelectionChange).toHaveBeenCalledTimes(1)
    expect(onSelectionChange).toHaveBeenCalledWith(
      CanvasSelection.make([pricing])
    )
  })

  it("keeps selected items in the camera world and sync chrome outside it", async() => {
    await renderReady(
      <ReplicaBoard
        {...requiredBoard}
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
