import { decodeCanvasProjection } from "@crit/domain"
import {
  FRAME_INPUT_BRIDGE_SCHEMA_VERSION,
  FRAME_INPUT_BRIDGE_SOURCE,
  type FrameInputIntent
} from "@crit/protocol"
import { ReplicaView } from "@crit/replica"
import {
  IframeRenderPlan,
  type RenderPlan
} from "@crit/representations"
import { Effect, Schema } from "effect"
import { StrictMode, act, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  applyCanvasCameraIntent,
  CanvasBoard,
  CanvasCamera,
  CanvasSelection,
  ReplicaBoard,
  fitCameraToFrames,
  type FrameRepresentationResolver
} from "../src/index.js"
import { CritRegistry } from "./crit-registry.js"
import { requiredBoard } from "./required-board.js"

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true })

const url = "https://example.com/checkout"
const projection = decodeCanvasProjection({
  schemaVersion: 3,
  canvasId: "canvas_review",
  title: "Review",
  frames: [{
    frameId: "frame_checkout",
    title: "Checkout",
    representation: { _tag: "webUrl", url },
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
    representation: { _tag: "webUrl", url: "https://example.com/pricing" },
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
  _tag: "replicaView",
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
let root: Root

const render = (element: ReactElement) => root.render(
  <CritRegistry>
    <StrictMode>{element}</StrictMode>
  </CritRegistry>
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
})

afterEach(async() => {
  await act(async() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

const origin = { left: 10, top: 20, width: 800, height: 600 }
const resting = CanvasCamera.make({ x: 10, y: 20, zoom: 1 })
const wheel = {
  type: "wheel",
  clientX: 110,
  clientY: 220,
  deltaX: 12,
  deltaY: -8,
  ctrlKey: false,
  metaKey: false
} satisfies Extract<FrameInputIntent, { readonly type: "wheel" }>

const dispatchWheel = (target: Window) => {
  const event = new Event("wheel", { cancelable: true })
  Object.defineProperties(event, {
    clientX: { value: 20 },
    clientY: { value: 30 },
    ctrlKey: { value: false },
    deltaX: { value: 4 },
    deltaY: { value: 8 },
    metaKey: { value: false }
  })
  target.dispatchEvent(event)
  return event
}

const stubBoardRect = (board: HTMLElement) => {
  vi.spyOn(board, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 800, 600)
  )
}

describe("CanvasCamera", () => {
  it("rejects zoom that is not a positive finite number", () => {
    for (const zoom of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => CanvasCamera.make({ x: 0, y: 0, zoom })).toThrow()
    }
  })

  it("fits the camera to every Frame with a viewport inset", () => {
    expect(fitCameraToFrames([
      { x: 0, y: 0, width: 200, height: 100 },
      { x: 300, y: 50, width: 100, height: 150 }
    ], { width: 800, height: 600 })).toEqual(CanvasCamera.make({
      x: 200,
      y: 200,
      zoom: 1
    }))
    expect(fitCameraToFrames([], { width: 800, height: 600 })).toEqual(
      CanvasCamera.make({ x: 0, y: 0, zoom: 1 })
    )
  })
})

describe("applyCanvasCameraIntent", () => {
  it("pans an unmodified wheel by its deltas", () => {
    expect(applyCanvasCameraIntent(resting, wheel, origin)).toEqual(
      CanvasCamera.make({ x: -2, y: 28, zoom: 1 })
    )
  })

  it("zooms a ctrl-wheel about the pointer", () => {
    const zoomed = applyCanvasCameraIntent(resting, {
      ...wheel,
      ctrlKey: true,
      deltaX: 0,
      deltaY: -100
    }, origin)
    expect(zoomed.zoom).toBeCloseTo(1.1)
    expect((100 - zoomed.x) / zoomed.zoom).toBeCloseTo(90)
    expect((200 - zoomed.y) / zoomed.zoom).toBeCloseTo(180)
  })

  it("pinches about the moving centroid", () => {
    expect(applyCanvasCameraIntent(
      CanvasCamera.make({ x: 0, y: 0, zoom: 1 }),
      {
        type: "pinch",
        scaleFactor: 2,
        clientX: 110,
        clientY: 100,
        deltaX: 10,
        deltaY: 0
      },
      { left: 0, top: 0, width: 200, height: 100 }
    )).toEqual(CanvasCamera.make({ x: -90, y: -100, zoom: 2 }))
  })

  it("zooms one step about the board center", () => {
    const zoomed = applyCanvasCameraIntent(
      CanvasCamera.make({ x: 0, y: 0, zoom: 1 }),
      { type: "zoom-step", direction: 1 },
      { left: 0, top: 0, width: 200, height: 100 }
    )

    expect(zoomed).toEqual(CanvasCamera.make({ x: -100, y: -50, zoom: 2 }))
    expect((100 - zoomed.x) / zoomed.zoom).toBe(100)
    expect((50 - zoomed.y) / zoomed.zoom).toBe(50)
  })

  it("returns the same camera for a zoom step on an empty board", () => {
    expect(applyCanvasCameraIntent(
      resting,
      { type: "zoom-step", direction: 1 },
      { left: 0, top: 0, width: 0, height: 100 }
    )).toBe(resting)
  })

  it("leaves the camera unchanged for selection", () => {
    expect(applyCanvasCameraIntent(
      resting,
      { type: "select", additive: false },
      origin
    )).toBe(resting)
  })
})

describe("CanvasBoard camera", () => {
  it("applies the identity camera on a world layer", async() => {
    await act(async() => render(
      <CanvasBoard {...requiredBoard} projection={projection} resolver={resolver} />
    ))
    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull())
    const board = container.querySelector("[aria-label='Review']")
    expect(board).toBeInstanceOf(HTMLElement)
    if (!(board instanceof HTMLElement)) return
    const world = worldLayer(board)
    if (!(world instanceof HTMLElement)) return
    expect(world.style.transform).toBe("translate(0px, 0px) scale(1)")
    expect(board.querySelector("[aria-label='Checkout']")).toBeInstanceOf(HTMLElement)
  })

  it("applies translate then scale on a world layer", async() => {
    await act(async() => render(
      <CanvasBoard {...requiredBoard}  camera={posed} projection={projection} resolver={resolver} />
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
      <CanvasBoard {...requiredBoard}  camera={posed} projection={projection} resolver={resolver} />
    ))
    const board = container.querySelector("[aria-label='Review']")
    expect(board).toBeInstanceOf(HTMLElement)
    if (!(board instanceof HTMLElement)) return
    const first = worldLayer(board)
    if (!(first instanceof HTMLElement)) return
    expect(first.style.transform).toBe("translate(12px, -8px) scale(0.5)")

    await act(async() => render(
      <CanvasBoard {...requiredBoard}  camera={recentered} projection={projection} resolver={resolver} />
    ))
    const next = worldLayer(board)
    if (!(next instanceof HTMLElement)) return
    expect(next.style.transform).toBe("translate(40px, 40px) scale(2)")
  })
})

describe("CanvasBoard camera navigation", () => {
  it("writes a wheel pan to the plane without a camera snapshot", async() => {
    const onCameraChange = vi.fn()
    await act(async() => render(
      <CanvasBoard
        {...requiredBoard}
        camera={resting}
        onCameraChange={onCameraChange}
        projection={projection}
        resolver={resolver}
      />
    ))
    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull())
    const board = container.querySelector("[aria-label='Review']")
    expect(board).toBeInstanceOf(HTMLElement)
    if (!(board instanceof HTMLElement)) return
    stubBoardRect(board)

    const event = dispatchWheel(window)
    const world = worldLayer(board)

    expect(event.defaultPrevented).toBe(true)
    expect(world).toBeInstanceOf(HTMLElement)
    if (!(world instanceof HTMLElement)) return
    expect(world.style.transform).toBe("translate(6px, 12px) scale(1)")
    expect(onCameraChange).not.toHaveBeenCalled()
  })

  it("does not listen for bridged Frame wheel pan messages", async() => {
    const onCameraChange = vi.fn()
    await act(async() => render(
      <CanvasBoard
        {...requiredBoard}
        camera={resting}
        onCameraChange={onCameraChange}
        projection={projection}
        resolver={resolver}
      />
    ))
    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull())
    const board = container.querySelector("[aria-label='Review']")
    const iframe = container.querySelector("iframe")
    expect(board).toBeInstanceOf(HTMLElement)
    expect(iframe).toBeInstanceOf(HTMLIFrameElement)
    if (!(board instanceof HTMLElement) ||
      !(iframe instanceof HTMLIFrameElement)) return
    stubBoardRect(board)
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
          intent: { type: "wheel", ...wheel, deltaX: 4, deltaY: 8 }
        }
      }))
    })

    expect(onCameraChange).not.toHaveBeenCalled()
  })

  it("leaves a sole selected Frame's wheel for the Frame", async() => {
    const onCameraChange = vi.fn()
    await act(async() => render(
      <CanvasBoard
        {...requiredBoard}
        camera={resting}
        onCameraChange={onCameraChange}
        projection={projection}
        resolver={resolver}
        selection={CanvasSelection.make([
          { _tag: "frame", frameId: "frame_checkout" }
        ])}
      />
    ))
    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull())
    const board = container.querySelector("[aria-label='Review']")
    const frame = container.querySelector("[aria-label='Checkout']")
    const iframe = container.querySelector("iframe")
    expect(board).toBeInstanceOf(HTMLElement)
    expect(frame).toBeInstanceOf(HTMLElement)
    expect(iframe).toBeInstanceOf(HTMLIFrameElement)
    if (
      !(board instanceof HTMLElement) ||
      !(frame instanceof HTMLElement) ||
      !(iframe instanceof HTMLIFrameElement)
    ) return
    stubBoardRect(board)
    vi.spyOn(frame, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 100, 100)
    )
    const frameWindow = iframe.contentWindow
    expect(frameWindow).not.toBeNull()
    if (frameWindow === null) return

    const event = dispatchWheel(window)
    await act(async() => {
      window.dispatchEvent(new MessageEvent("message", {
        origin: new URL(url).origin,
        source: frameWindow,
        data: {
          source: FRAME_INPUT_BRIDGE_SOURCE,
          schemaVersion: FRAME_INPUT_BRIDGE_SCHEMA_VERSION,
          intent: { type: "wheel", ...wheel, deltaX: 4, deltaY: 8 }
        }
      }))
    })

    expect(event.defaultPrevented).toBe(false)
    expect(onCameraChange).not.toHaveBeenCalled()
  })

  it("routes canvas wheel when more than one item is selected", async() => {
    const onCameraChange = vi.fn()
    await act(async() => render(
      <CanvasBoard
        {...requiredBoard}
        camera={resting}
        onCameraChange={onCameraChange}
        projection={projection}
        resolver={resolver}
        selection={CanvasSelection.make([
          { _tag: "frame", frameId: "frame_checkout" },
          { _tag: "frame", frameId: "frame_pricing" }
        ])}
      />
    ))
    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull())
    const board = container.querySelector("[aria-label='Review']")
    expect(board).toBeInstanceOf(HTMLElement)
    if (!(board instanceof HTMLElement)) return
    stubBoardRect(board)

    const event = dispatchWheel(window)
    const world = worldLayer(board)

    expect(event.defaultPrevented).toBe(true)
    expect(world).toBeInstanceOf(HTMLElement)
    if (!(world instanceof HTMLElement)) return
    expect(world.style.transform).toBe("translate(6px, 12px) scale(1)")
    expect(onCameraChange).not.toHaveBeenCalled()
  })

})

describe("ReplicaBoard camera", () => {
  it("keeps sync chrome outside the transformed world", async() => {
    await act(async() => render(
      <ReplicaBoard {...requiredBoard}  camera={posed} resolver={resolver} view={view} />
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

  it("forwards wheel navigation", async() => {
    const onCameraChange = vi.fn()
    await act(async() => render(
      <ReplicaBoard
        {...requiredBoard}
        camera={resting}
        onCameraChange={onCameraChange}
        resolver={resolver}
        view={view}
      />
    ))
    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull())
    const board = container.querySelector("[aria-label='Review']")
    expect(board).toBeInstanceOf(HTMLElement)
    if (!(board instanceof HTMLElement)) return
    stubBoardRect(board)

    const event = dispatchWheel(window)
    const world = worldLayer(board)

    expect(event.defaultPrevented).toBe(true)
    expect(world).toBeInstanceOf(HTMLElement)
    if (!(world instanceof HTMLElement)) return
    expect(world.style.transform).toBe("translate(6px, 12px) scale(1)")
    expect(onCameraChange).not.toHaveBeenCalled()
  })
})
