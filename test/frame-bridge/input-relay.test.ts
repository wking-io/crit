import { describe, expect, it } from "vitest"

import {
  connectCanvasInput,
  createFrameInputRelay,
  offsetFrameInputIntent
} from "../../src/frame-bridge/input-relay.js"
import {
  CRIT_FRAME_INPUT_SOURCE,
  frameInputIntentFromMessage,
  isCritFrameInputMessage
} from "../../src/frame-bridge/index.js"

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

describe("Frame input relay", () => {
  it("snapshots non-enumerable WheelEvent fields at the Canvas adapter", () => {
    const target = new EventTarget()
    Object.defineProperties(target, {
      GestureEvent: { value: class GestureEvent extends Event {} },
      navigator: {
        value: { maxTouchPoints: 0, platform: "MacIntel", userAgent: "" }
      }
    })
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

  it("accepts only normalized intents from the postMessage adapter", () => {
    const message = {
      source: CRIT_FRAME_INPUT_SOURCE,
      type: "tool",
      tool: "pan"
    } as const

    expect(isCritFrameInputMessage(message)).toBe(true)
    expect(frameInputIntentFromMessage(message)).toEqual({
      type: "tool",
      tool: "pan"
    })
    expect(isCritFrameInputMessage({
      source: CRIT_FRAME_INPUT_SOURCE,
      type: "hotkey",
      key: "h"
    })).toBe(false)
    expect(isCritFrameInputMessage({
      source: CRIT_FRAME_INPUT_SOURCE,
      type: "select",
      additive: true
    })).toBe(true)
    expect(isCritFrameInputMessage({
      source: CRIT_FRAME_INPUT_SOURCE,
      type: "select"
    })).toBe(false)
    expect(isCritFrameInputMessage({
      source: CRIT_FRAME_INPUT_SOURCE,
      type: "delete"
    })).toBe(true)
    expect(isCritFrameInputMessage({
      source: CRIT_FRAME_INPUT_SOURCE,
      type: "pinch",
      clientX: 20,
      clientY: 30,
      deltaX: 2,
      deltaY: -1,
      scaleFactor: 1.1
    })).toBe(true)
  })
})
