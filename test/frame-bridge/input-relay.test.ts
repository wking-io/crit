import { describe, expect, it } from "vitest"

import {
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

describe("Frame input relay", () => {
  it("keeps Frame scrolling local while routing canvas pan and zoom", () => {
    const relay = createFrameInputRelay()

    expect(relay.wheel(wheel, true)).toEqual({ handled: false })
    expect(relay.wheel(wheel, false)).toMatchObject({
      handled: true,
      intent: { type: "wheel", deltaX: 4, deltaY: 8 }
    })
    expect(
      relay.wheel({ ...wheel, ctrlKey: true }, true)
    ).toMatchObject({
      handled: true,
      intent: { type: "wheel", ctrlKey: true }
    })
  })

  it("suppresses synthetic zoom wheels during native gestures", () => {
    const relay = createFrameInputRelay()
    relay.gestureStart(1, { x: 40, y: 50 })

    expect(relay.wheel({ ...wheel, ctrlKey: true }, true)).toEqual({
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
    expect(relay.wheel({ ...wheel, ctrlKey: true }, true).intent).toBeDefined()
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
