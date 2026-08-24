import {
  FRAME_INPUT_BRIDGE_SCHEMA_VERSION,
  FRAME_INPUT_BRIDGE_SOURCE,
  FrameBridgeOrigin
} from "@crit/protocol"
import { Option, Schema } from "effect"
import { describe, expect, it } from "vitest"

import {
  connectCanvasInput,
  connectSameOriginFrameInput,
  createFrameInputRelay,
  offsetFrameInputIntent
} from "../src/input-relay.js"
import {
  connectBridgedFrameInput,
  critFrameInputBridgeScript,
  frameBridgeOriginFromHref
} from "../src/index.js"

const frameOrigin = Schema.decodeUnknownSync(FrameBridgeOrigin)("https://shop.example")
const parentOrigin = Schema.decodeUnknownSync(FrameBridgeOrigin)("https://app.example")

const wheel = {
  clientX: 20,
  clientY: 30,
  ctrlKey: false,
  metaKey: false,
  deltaX: 4,
  deltaY: 8
}

const canvasInputWindow = (target: EventTarget): Window => {
  // SAFETY: This fixture supplies every Window member read by connectCanvasInput
  // and inherits the real EventTarget listener implementation.
  return target as Window
}

const canvasInputRoot = (target: EventTarget): HTMLElement => {
  // SAFETY: This fixture supplies getBoundingClientRect, the only HTMLElement
  // member read by connectCanvasInput, and inherits real event dispatch.
  return target as HTMLElement
}

const bridgedInputFrame = (contentWindow: Window): HTMLIFrameElement => {
  const frame = {
    contentWindow,
    getBoundingClientRect: () => ({ left: 100, top: 200 })
  }
  // SAFETY: This fixture supplies every HTMLIFrameElement member read by the
  // bridged and same-origin input adapters.
  return frame as HTMLIFrameElement
}

const gestureHost = () => {
  const target = new EventTarget()
  Object.defineProperties(target, {
    GestureEvent: { value: class GestureEvent extends Event {} },
    navigator: {
      value: { maxTouchPoints: 0, platform: "MacIntel", userAgent: "" }
    }
  })
  return target
}

describe("Frame input relay", () => {
  it("snapshots non-enumerable WheelEvent fields at the Canvas adapter", () => {
    const target = gestureHost()
    const root = new EventTarget()
    Object.defineProperty(root, "getBoundingClientRect", {
      value: () => ({ bottom: 600, left: 0, right: 800, top: 0 })
    })
    const intents: Array<unknown> = []
    const disconnect = connectCanvasInput({
      target: canvasInputWindow(target),
      root: canvasInputRoot(root),
      onIntent: (intent) => intents.push(intent)
    })
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
    disconnect()

    expect(event.defaultPrevented).toBe(true)
    expect(intents).toEqual([{ type: "wheel", ...wheel }])
  })

  it("lets the Canvas ignore a wheel over a selected Frame", () => {
    const target = gestureHost()
    const root = new EventTarget()
    Object.defineProperty(root, "getBoundingClientRect", {
      value: () => ({ bottom: 600, left: 0, right: 800, top: 0 })
    })
    const intents: Array<unknown> = []
    const disconnect = connectCanvasInput({
      target: canvasInputWindow(target),
      root: canvasInputRoot(root),
      ignore: ({ clientX, clientY }) => clientX < 50 && clientY < 50,
      onIntent: (intent) => intents.push(intent)
    })
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
    disconnect()

    expect(event.defaultPrevented).toBe(false)
    expect(intents).toEqual([])
  })

  it("routes trackpad pan and zoom across Frame content", () => {
    const relay = createFrameInputRelay()

    expect(relay.wheel(wheel)).toMatchObject({
      handled: true,
      intent: { type: "wheel", deltaX: 4, deltaY: 8 }
    })
    expect(relay.wheel(wheel)).toMatchObject({
      handled: true,
      intent: { type: "wheel", deltaX: 4, deltaY: 8 }
    })
    expect(
      relay.wheel({ ...wheel, ctrlKey: true })
    ).toMatchObject({
      handled: true,
      intent: { type: "wheel", ctrlKey: true }
    })
  })

  it("suppresses synthetic zoom wheels during native gestures", () => {
    const relay = createFrameInputRelay()
    relay.gestureStart(1, { x: 40, y: 50 })

    expect(relay.wheel({ ...wheel, ctrlKey: true })).toEqual({
      handled: true
    })
    expect(relay.gestureChange(1.25, { x: 40, y: 50 })).toEqual({
      type: "pinch",
      clientX: 40,
      clientY: 50,
      deltaX: 0,
      deltaY: 0,
      scaleFactor: 1.25
    })
    expect(relay.gestureChange(1.5, { x: 45, y: 48 })).toMatchObject({
      deltaX: 5,
      deltaY: -2,
      scaleFactor: 1.2
    })

    relay.gestureEnd()
    expect(relay.wheel({ ...wheel, ctrlKey: true }).intent).toBeDefined()
  })

  it("distinguishes two-touch panning from zooming", () => {
    const panRelay = createFrameInputRelay()
    panRelay.touchStart([{ x: 0, y: 0 }, { x: 100, y: 0 }])
    expect(panRelay.touchMove([{ x: 20, y: 0 }, { x: 120, y: 0 }])).toMatchObject({
      type: "pinch",
      deltaX: 20,
      deltaY: 0,
      scaleFactor: 1
    })

    const zoomRelay = createFrameInputRelay()
    zoomRelay.touchStart([{ x: 0, y: 0 }, { x: 100, y: 0 }])
    expect(zoomRelay.touchMove([{ x: 0, y: 0 }, { x: 130, y: 0 }])).toMatchObject({
      type: "pinch",
      clientX: 65,
      scaleFactor: 1.3
    })
  })

  it("normalizes tool and zoom hotkeys with input guards", () => {
    const relay = createFrameInputRelay()

    expect(relay.hotkey({
      code: "KeyV",
      ctrlKey: false,
      input: false,
      key: "v",
      metaKey: false
    })).toEqual({ type: "tool", tool: "select" })
    expect(relay.hotkey({
      code: "KeyH",
      ctrlKey: false,
      input: true,
      key: "h",
      metaKey: false
    })).toBeNull()
    expect(relay.hotkey({
      code: "Equal",
      ctrlKey: true,
      input: true,
      key: "+",
      metaKey: false
    })).toEqual({ type: "zoom-step", direction: 1 })
    expect(relay.hotkey({
      code: "Backspace",
      ctrlKey: false,
      input: false,
      key: "Backspace",
      metaKey: false
    })).toEqual({ type: "delete" })
    expect(relay.hotkey({
      code: "Backspace",
      ctrlKey: false,
      input: true,
      key: "Backspace",
      metaKey: false
    })).toBeNull()
  })

  it("preserves additive Frame selection across iframe input", () => {
    const relay = createFrameInputRelay()

    expect(relay.select()).toEqual({ type: "select", additive: false })
    expect(relay.select({ metaKey: true })).toEqual({
      type: "select",
      additive: true
    })
    expect(relay.select({ shiftKey: true })).toEqual({
      type: "select",
      additive: true
    })
  })

  it("lets adapters offset pointer intents without changing other intents", () => {
    expect(offsetFrameInputIntent(
      { type: "wheel", ...wheel },
      { left: 100, top: 200 }
    )).toMatchObject({ clientX: 120, clientY: 230 })
    expect(offsetFrameInputIntent(
      { type: "tool", tool: "pan" },
      { left: 100, top: 200 }
    )).toEqual({ type: "tool", tool: "pan" })
  })

  it("decodes versioned postMessage intents and ignores malformed traffic", () => {
    const target = new EventTarget()
    const frameChannel = new MessageChannel()
    const frameWindow = canvasInputWindow(frameChannel.port1)
    const intents: Array<unknown> = []
    const disconnect = connectBridgedFrameInput({
      target: canvasInputWindow(target),
      frameElement: bridgedInputFrame(frameWindow),
      frameOrigin,
      onIntent: (intent) => intents.push(intent)
    })
    const dispatch = (event: MessageEvent) => target.dispatchEvent(event)

    dispatch(
      new MessageEvent("message", {
        origin: frameOrigin,
        source: frameWindow,
        data: { source: FRAME_INPUT_BRIDGE_SOURCE, type: "wheel", ...wheel }
      })
    )
    dispatch(
      new MessageEvent("message", {
        origin: frameOrigin,
        source: frameWindow,
        data: {
          source: FRAME_INPUT_BRIDGE_SOURCE,
          schemaVersion: 1,
          intent: { type: "select" }
        }
      })
    )
    dispatch(
      new MessageEvent("message", {
        origin: frameOrigin,
        source: canvasInputWindow(frameChannel.port2),
        data: {
          source: FRAME_INPUT_BRIDGE_SOURCE,
          schemaVersion: 1,
          intent: { type: "delete" }
        }
      })
    )
    dispatch(
      new MessageEvent("message", {
        origin: "https://evil.example",
        source: frameWindow,
        data: {
          source: FRAME_INPUT_BRIDGE_SOURCE,
          schemaVersion: 1,
          intent: { type: "delete" }
        }
      })
    )
    dispatch(
      new MessageEvent("message", {
        origin: frameOrigin,
        source: frameWindow,
        data: {
          source: FRAME_INPUT_BRIDGE_SOURCE,
          schemaVersion: 1,
          intent: { type: "wheel", ...wheel }
        }
      })
    )
    disconnect()
    frameChannel.port1.close()
    frameChannel.port2.close()
    dispatch(
      new MessageEvent("message", {
        origin: frameOrigin,
        source: frameWindow,
        data: {
          source: FRAME_INPUT_BRIDGE_SOURCE,
          schemaVersion: 1,
          intent: { type: "delete" }
        }
      })
    )

    expect(intents).toEqual([{
      type: "wheel",
      ...wheel,
      clientX: 120,
      clientY: 230
    }])
  })

  it("serializes a closed factory that matches the host relay", () => {
    const script = critFrameInputBridgeScript({ parentOrigin })
    expect(() => new Function(script)).not.toThrow()
    const factorySource = createFrameInputRelay.toString()
    expect(factorySource).not.toMatch(/\bimport\b|\brequire\b/)
    expect(factorySource).not.toContain("Predicate")
    expect(factorySource).not.toContain("FrameInputBridgeMessageSchema")
    const serialized = new Function(`return (${factorySource})()`)()
    const live = createFrameInputRelay()
    expect(serialized.wheel(wheel)).toEqual(live.wheel(wheel))
    expect(serialized.select({ metaKey: true })).toEqual(live.select({ metaKey: true }))
    expect(serialized.hotkey({
      code: "KeyV",
      ctrlKey: false,
      input: false,
      key: "v",
      metaKey: false
    })).toEqual(live.hotkey({
      code: "KeyV",
      ctrlKey: false,
      input: false,
      key: "v",
      metaKey: false
    }))
    expect(script).toContain(
      `const schemaVersion = ${FRAME_INPUT_BRIDGE_SCHEMA_VERSION}`
    )
    expect(script).toContain(`const parentOrigin = ${JSON.stringify(parentOrigin)}`)
    expect(script).toContain(
      "postMessage({ source, schemaVersion, intent }, parentOrigin)"
    )
    expect(script).not.toContain(', "*"')
    expect(script).not.toContain("typeof")
    expect(script).not.toContain("instanceof HTMLElement")
  })

  it("reads an event.origin from a Frame href", () => {
    expect(frameBridgeOriginFromHref("https://shop.example/checkout")).toEqual(
      Option.some(frameOrigin)
    )
    expect(Option.isNone(frameBridgeOriginFromHref("not a url"))).toBe(true)
  })

  it("offsets same-origin Frame wheel and hotkey intents onto the Canvas", () => {
    const target = gestureHost()
    const intents: Array<unknown> = []
    const disconnect = connectSameOriginFrameInput({
      target: canvasInputWindow(target),
      frameElement: bridgedInputFrame(canvasInputWindow(target)),
      onIntent: (intent) => intents.push(intent)
    })
    const event = new Event("wheel", { cancelable: true })
    Object.defineProperties(event, {
      clientX: { value: 20 },
      clientY: { value: 30 },
      ctrlKey: { value: false },
      deltaX: { value: 4 },
      deltaY: { value: 8 },
      metaKey: { value: false }
    })
    const key = new Event("keydown", { cancelable: true })
    Object.defineProperties(key, {
      code: { value: "KeyV" },
      ctrlKey: { value: false },
      key: { value: "v" },
      metaKey: { value: false }
    })

    target.dispatchEvent(event)
    target.dispatchEvent(key)
    disconnect()

    expect(intents).toEqual([
      { type: "wheel", ...wheel, clientX: 120, clientY: 230 },
      { type: "tool", tool: "select" }
    ])
  })

  it("does not steal a same-origin wheel the Frame already handled", () => {
    const target = gestureHost()
    const intents: Array<unknown> = []
    const disconnect = connectSameOriginFrameInput({
      target: canvasInputWindow(target),
      frameElement: bridgedInputFrame(canvasInputWindow(target)),
      onIntent: (intent) => intents.push(intent)
    })
    const event = new Event("wheel", { cancelable: true })
    Object.defineProperties(event, {
      clientX: { value: 20 },
      clientY: { value: 30 },
      ctrlKey: { value: false },
      deltaX: { value: 4 },
      deltaY: { value: 8 },
      metaKey: { value: false }
    })
    event.preventDefault()

    target.dispatchEvent(event)
    disconnect()

    expect(intents).toEqual([])
  })
})
