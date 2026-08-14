import {
  createFrameInputRelay,
  offsetFrameInputIntent,
  type FrameInputIntent
} from "./input-relay.js"

export {
  createFrameInputRelay,
  connectCanvasInput,
  connectSameOriginFrameInput,
  offsetFrameInputIntent,
  type FrameInputIntent,
  type FrameWheelDecision
} from "./input-relay.js"
export {
  CRIT_FRAME_COMMENT_SOURCE,
  connectBridgedFrameComments,
  critFrameCommentBridgeScript,
  type FrameCommentEvent,
  type FrameCommentPin
} from "./comment-bridge.js"

export const CRIT_FRAME_INPUT_SOURCE = "@riff-refine/crit/frame-input"

export type CritFrameInputMessage = FrameInputIntent & {
  readonly source: typeof CRIT_FRAME_INPUT_SOURCE
}

const finiteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value)

export const isCritFrameInputMessage = (
  value: unknown
): value is CritFrameInputMessage => {
  if (
    typeof value !== "object" ||
    value === null ||
    !("source" in value) ||
    value.source !== CRIT_FRAME_INPUT_SOURCE ||
    !("type" in value)
  ) return false
  if (value.type === "select") {
    return "additive" in value && typeof value.additive === "boolean"
  }
  if (value.type === "delete") return true
  if (value.type === "tool") {
    return "tool" in value && (value.tool === "select" || value.tool === "pan")
  }
  if (value.type === "zoom-step") {
    return "direction" in value &&
      (value.direction === -1 || value.direction === 1)
  }
  if (value.type === "pinch") {
    return "clientX" in value && finiteNumber(value.clientX) &&
      "clientY" in value && finiteNumber(value.clientY) &&
      "deltaX" in value && finiteNumber(value.deltaX) &&
      "deltaY" in value && finiteNumber(value.deltaY) &&
      "scaleFactor" in value && finiteNumber(value.scaleFactor) &&
      value.scaleFactor > 0
  }
  return value.type === "wheel" &&
    "clientX" in value && finiteNumber(value.clientX) &&
    "clientY" in value && finiteNumber(value.clientY) &&
    "deltaX" in value && finiteNumber(value.deltaX) &&
    "deltaY" in value && finiteNumber(value.deltaY) &&
    "ctrlKey" in value && typeof value.ctrlKey === "boolean" &&
    "metaKey" in value && typeof value.metaKey === "boolean"
}

export const frameInputIntentFromMessage = (
  message: CritFrameInputMessage
): FrameInputIntent => {
  switch (message.type) {
    case "select":
      return { type: message.type, additive: message.additive }
    case "delete":
      return { type: message.type }
    case "tool":
      return { type: message.type, tool: message.tool }
    case "zoom-step":
      return { type: message.type, direction: message.direction }
    case "wheel":
      return {
        type: message.type,
        clientX: message.clientX,
        clientY: message.clientY,
        ctrlKey: message.ctrlKey,
        metaKey: message.metaKey,
        deltaX: message.deltaX,
        deltaY: message.deltaY
      }
    case "pinch":
      return {
        type: message.type,
        clientX: message.clientX,
        clientY: message.clientY,
        deltaX: message.deltaX,
        deltaY: message.deltaY,
        scaleFactor: message.scaleFactor
      }
  }
}

export const connectBridgedFrameInput = (input: {
  readonly target: Window
  readonly frameElement: HTMLIFrameElement
  readonly onIntent: (intent: FrameInputIntent) => void
}) => {
  const relayMessage = (event: MessageEvent) => {
    if (
      event.source !== input.frameElement.contentWindow ||
      !isCritFrameInputMessage(event.data)
    ) return
    input.onIntent(
      offsetFrameInputIntent(
        frameInputIntentFromMessage(event.data),
        input.frameElement.getBoundingClientRect()
      )
    )
  }
  input.target.addEventListener("message", relayMessage)
  return () => input.target.removeEventListener("message", relayMessage)
}

export const critFrameInputBridgeScript = String.raw`
(() => {
  if (window.parent === window) return
  const source = "${CRIT_FRAME_INPUT_SOURCE}"
  const relay = (${createFrameInputRelay.toString()})()
  const send = (message) => window.parent.postMessage({ source, ...message }, "*")
  window.addEventListener("keydown", (event) => {
    const target = event.target
    const input = target instanceof HTMLElement && (
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
      x: typeof event.clientX === "number" ? event.clientX : window.innerWidth / 2,
      y: typeof event.clientY === "number" ? event.clientY : window.innerHeight / 2
    })
  }
  const changeGesture = (event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
    send(relay.gestureChange(event.scale, {
      x: typeof event.clientX === "number" ? event.clientX : window.innerWidth / 2,
      y: typeof event.clientY === "number" ? event.clientY : window.innerHeight / 2
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
