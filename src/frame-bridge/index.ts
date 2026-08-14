import { Option, Schema } from "effect"

import {
  createFrameInputRelay,
  FrameInputIntent,
  offsetFrameInputIntent,
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

const CritFrameInputMessage = Schema.Struct({
  source: Schema.Literal(CRIT_FRAME_INPUT_SOURCE),
  intent: FrameInputIntent
})

const decodeCritFrameInputMessage = Schema.decodeUnknownOption(
  CritFrameInputMessage
)

export const connectBridgedFrameInput = (input: {
  readonly target: Window
  readonly frameElement: HTMLIFrameElement
  readonly onIntent: (intent: FrameInputIntent) => void
}) => {
  const relayMessage = (event: MessageEvent) => {
    if (event.source !== input.frameElement.contentWindow) return
    const decoded = decodeCritFrameInputMessage(event.data)
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

export const critFrameInputBridgeScript = String.raw`
(() => {
  if (window.parent === window) return
  const source = "${CRIT_FRAME_INPUT_SOURCE}"
  const relay = (${createFrameInputRelay.toString()})()
  const send = (intent) => window.parent.postMessage({ source, intent }, "*")
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
