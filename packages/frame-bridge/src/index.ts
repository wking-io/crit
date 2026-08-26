import { Option } from "effect"

import {
  FRAME_INPUT_BRIDGE_SCHEMA_VERSION,
  FRAME_INPUT_BRIDGE_SOURCE,
  decodeFrameInputBridgeMessage,
  type FrameBridgeOrigin,
  type FrameInputIntent
} from "@crit/protocol"

import {
  createFrameInputRelay,
  offsetFrameInputIntent
} from "./input-relay.js"
import { isTrustedFrameBridgeEvent } from "./origin.js"

export {
  createFrameInputRelay,
  connectCanvasInput,
  connectSameOriginFrameInput,
  offsetFrameInputIntent,
  type FrameWheelDecision
} from "./input-relay.js"
export {
  frameBridgeOriginFromHref,
  isTrustedFrameBridgeEvent
} from "./origin.js"
export {
  FRAME_ROUTE_BRIDGE_HTML_MARKER,
  assignLiveFrameRoute,
  connectLiveFrameRoute,
  critFrameRouteBridgeScript
} from "./route.js"
export type {
  FrameBridgeOrigin,
  FrameInputIntent,
  FrameRoute
} from "@crit/protocol"

export const connectBridgedFrameInput = (input: {
  readonly target: Window
  readonly frameElement: HTMLIFrameElement
  readonly frameOrigin: FrameBridgeOrigin
  readonly onIntent: (intent: FrameInputIntent) => void
}) => {
  const relayMessage = (event: MessageEvent) => {
    if (!isTrustedFrameBridgeEvent(event, {
      origin: input.frameOrigin,
      source: input.frameElement.contentWindow
    })) return
    const decoded = decodeFrameInputBridgeMessage(event.data)
    if (Option.isNone(decoded)) return
    input.onIntent(
      offsetFrameInputIntent(
        decoded.value.intent,
        input.frameElement.getBoundingClientRect()
      )
    )
  }
  input.target.addEventListener("message", relayMessage)
  return () => input.target.removeEventListener("message", relayMessage)
}

export const critFrameInputBridgeScript = (input: {
  readonly parentOrigin: FrameBridgeOrigin
}) => String.raw`
(() => {
  if (window.parent === window) return
  const parentOrigin = ${JSON.stringify(input.parentOrigin)}
  const source = "${FRAME_INPUT_BRIDGE_SOURCE}"
  const schemaVersion = ${FRAME_INPUT_BRIDGE_SCHEMA_VERSION}
  const relay = (${createFrameInputRelay.toString()})()
  const send = (intent) => window.parent.postMessage({ source, schemaVersion, intent }, parentOrigin)
  const isSelectorTarget = (target) => target !== null && "matches" in target
  window.addEventListener("keydown", (event) => {
    const target = event.target
    const input = isSelectorTarget(target) && (
      target.isContentEditable ||
      target.matches('input:not([type="button"]):not([type="submit"]):not([type="reset"]), textarea, select')
    )
    const intent = relay.hotkey({
      code: event.code,
      ctrlKey: event.ctrlKey,
      input,
      key: event.key,
      metaKey: event.metaKey
    })
    if (intent === null) return
    event.preventDefault()
    event.stopImmediatePropagation()
    send(intent)
  }, { capture: true })
  window.addEventListener("pointerdown", (event) => {
    send(relay.select(event))
  }, { capture: true })
  window.addEventListener("wheel", (event) => {
    const decision = relay.wheel(event)
    if (!decision.handled) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (decision.intent) send(decision.intent)
  }, { capture: true, passive: false })
  const startGesture = (event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
    relay.gestureStart(event.scale, {
      x: Number.isFinite(event.clientX) ? event.clientX : window.innerWidth / 2,
      y: Number.isFinite(event.clientY) ? event.clientY : window.innerHeight / 2
    })
  }
  const changeGesture = (event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
    send(relay.gestureChange(event.scale, {
      x: Number.isFinite(event.clientX) ? event.clientX : window.innerWidth / 2,
      y: Number.isFinite(event.clientY) ? event.clientY : window.innerHeight / 2
    }))
  }
  const endGesture = (event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
    relay.gestureEnd()
  }
  const touchPoints = (event) => Array.from(event.touches, (touch) => ({
    x: touch.clientX,
    y: touch.clientY
  }))
  const startTouch = (event) => {
    if (!relay.touchStart(touchPoints(event))) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  const moveTouch = (event) => {
    if (event.touches.length < 2) return
    event.preventDefault()
    event.stopImmediatePropagation()
    const intent = relay.touchMove(touchPoints(event))
    if (intent) send(intent)
  }
  const endTouch = (event) => relay.touchEnd(touchPoints(event))
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  const options = { capture: true, passive: false }
  if (!ios && "GestureEvent" in window) {
    window.addEventListener("gesturestart", startGesture, options)
    window.addEventListener("gesturechange", changeGesture, options)
    window.addEventListener("gestureend", endGesture, options)
  } else {
    window.addEventListener("touchstart", startTouch, options)
    window.addEventListener("touchmove", moveTouch, options)
    window.addEventListener("touchend", endTouch, options)
    window.addEventListener("touchcancel", endTouch, options)
  }
})()
`
