import { Predicate } from "effect"

import type { FrameInputIntent } from "@crit/protocol"

import { createFrameInputRelay } from "./relay-factory.js"

export { createFrameInputRelay, type FrameWheelDecision } from "./relay-factory.js"

export const offsetFrameInputIntent = (
  intent: FrameInputIntent,
  offset: { readonly left: number; readonly top: number; readonly scale?: number }
): FrameInputIntent => {
  if (intent.type !== "wheel" && intent.type !== "pinch") return intent
  const scale = offset.scale ?? 1
  const point = {
    clientX: offset.left + intent.clientX * scale,
    clientY: offset.top + intent.clientY * scale
  }
  if (intent.type === "pinch") return {
    ...intent,
    ...point,
    deltaX: intent.deltaX * scale,
    deltaY: intent.deltaY * scale
  }
  return { ...intent, ...point }
}

export const frameInputOffset = (frame: HTMLIFrameElement) => {
  const rect = frame.getBoundingClientRect()
  return {
    left: rect.left,
    top: rect.top,
    scale: frame.offsetWidth > 0 ? rect.width / frame.offsetWidth : 1
  }
}

type NativeGestureEvent = Event & {
  readonly clientX?: number
  readonly clientY?: number
  readonly scale?: number
}

const nativeGestureListener = (
  listener: (event: NativeGestureEvent) => void
): EventListener => listener as EventListener

const touchPoints = (event: TouchEvent) =>
  Array.from(event.touches, (touch) => ({ x: touch.clientX, y: touch.clientY }))

const usesNativeGestureEvents = (target: Window) => {
  const navigator = target.navigator
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  return !ios && "GestureEvent" in target
}

type SelectorTarget = EventTarget & {
  readonly isContentEditable?: boolean
  matches(selectors: string): boolean
}

const isSelectorTarget = (
  target: EventTarget | null
): target is SelectorTarget =>
  Predicate.hasProperty(target, "matches") &&
  Predicate.isFunction(target.matches)

const inputTarget = (target: EventTarget | null) => {
  return isSelectorTarget(target) && (
    target.isContentEditable === true ||
    target.matches(
      'input:not([type="button"]):not([type="submit"]):not([type="reset"]), textarea, select'
    )
  )
}

export const connectCanvasInput = (input: {
  readonly target: Window
  readonly root: HTMLElement
  readonly onIntent: (intent: FrameInputIntent) => void
  readonly ignore?: (point: {
    readonly clientX: number
    readonly clientY: number
  }) => boolean
}) => {
  const relay = createFrameInputRelay()
  const ignored = (clientX: number, clientY: number) =>
    input.ignore?.({ clientX, clientY }) === true
  const captureWheel = (event: WheelEvent) => {
    const rect = input.root.getBoundingClientRect()
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    ) return
    if (!event.ctrlKey && !event.metaKey && ignored(event.clientX, event.clientY)) return
    const decision = relay.wheel(event)
    if (!decision.handled) return
    event.preventDefault()
    event.stopPropagation()
    if (decision.intent !== undefined) {
      input.onIntent(decision.intent)
    }
  }
  const captureHotkey = (event: KeyboardEvent) => {
    if (event.key === "Escape" || event.defaultPrevented) return
    const intent = relay.hotkey({
      code: event.code,
      ctrlKey: event.ctrlKey,
      input: inputTarget(event.target),
      key: event.key,
      metaKey: event.metaKey
    })
    if (intent?.type !== "zoom-step" && intent?.type !== "tool") return
    event.preventDefault()
    event.stopImmediatePropagation()
    input.onIntent(intent)
  }
  const gesturePoint = (event: NativeGestureEvent) => {
    const rect = input.root.getBoundingClientRect()
    return {
      x: event.clientX ?? rect.left + rect.width / 2,
      y: event.clientY ?? rect.top + rect.height / 2
    }
  }
  const captureGestureStart = (event: NativeGestureEvent) => {
    event.preventDefault()
    event.stopPropagation()
    relay.gestureStart(event.scale, gesturePoint(event))
  }
  const captureGestureChange = (event: NativeGestureEvent) => {
    event.preventDefault()
    event.stopPropagation()
    input.onIntent(relay.gestureChange(event.scale, gesturePoint(event)))
  }
  const captureGestureEnd = (event: NativeGestureEvent) => {
    event.preventDefault()
    event.stopPropagation()
    relay.gestureEnd()
  }
  const captureTouchStart = (event: TouchEvent) => {
    const first = event.touches[0]
    if (first !== undefined && ignored(first.clientX, first.clientY)) return
    if (!relay.touchStart(touchPoints(event))) return
    event.preventDefault()
    event.stopPropagation()
  }
  const captureTouchMove = (event: TouchEvent) => {
    if (event.touches.length < 2) return
    event.preventDefault()
    event.stopPropagation()
    const intent = relay.touchMove(touchPoints(event))
    if (intent !== null) input.onIntent(intent)
  }
  const captureTouchEnd = (event: TouchEvent) => {
    relay.touchEnd(touchPoints(event))
  }
  const gestureStartListener = nativeGestureListener(captureGestureStart)
  const gestureChangeListener = nativeGestureListener(captureGestureChange)
  const gestureEndListener = nativeGestureListener(captureGestureEnd)
  const options = { capture: true, passive: false } as const
  const nativeGestures = usesNativeGestureEvents(input.target)
  input.target.addEventListener("wheel", captureWheel, options)
  const clearSelection = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
    event.preventDefault()
    event.stopPropagation()
    input.onIntent({ type: "clear-selection" })
  }
  input.target.addEventListener("keydown", clearSelection)
  input.target.addEventListener("keydown", captureHotkey, true)
  if (nativeGestures) {
    input.target.addEventListener(
      "gesturestart",
      gestureStartListener,
      options
    )
    input.target.addEventListener(
      "gesturechange",
      gestureChangeListener,
      options
    )
    input.target.addEventListener(
      "gestureend",
      gestureEndListener,
      options
    )
  } else {
    input.root.addEventListener("touchstart", captureTouchStart, options)
    input.root.addEventListener("touchmove", captureTouchMove, options)
    input.root.addEventListener("touchend", captureTouchEnd, options)
    input.root.addEventListener("touchcancel", captureTouchEnd, options)
  }
  return () => {
    relay.gestureEnd()
    input.target.removeEventListener("wheel", captureWheel, true)
    input.target.removeEventListener("keydown", clearSelection)
    input.target.removeEventListener("keydown", captureHotkey, true)
    if (nativeGestures) {
      input.target.removeEventListener(
        "gesturestart",
        gestureStartListener,
        true
      )
      input.target.removeEventListener(
        "gesturechange",
        gestureChangeListener,
        true
      )
      input.target.removeEventListener(
        "gestureend",
        gestureEndListener,
        true
      )
    } else {
      input.root.removeEventListener("touchstart", captureTouchStart, true)
      input.root.removeEventListener("touchmove", captureTouchMove, true)
      input.root.removeEventListener("touchend", captureTouchEnd, true)
      input.root.removeEventListener("touchcancel", captureTouchEnd, true)
    }
  }
}

export const connectSameOriginFrameInput = (input: {
  readonly target: Window
  readonly frameElement: HTMLIFrameElement
  readonly onIntent: (intent: FrameInputIntent) => void
}) => {
  const relay = createFrameInputRelay()
  const emit = (intent: FrameInputIntent) =>
    input.onIntent(
      offsetFrameInputIntent(intent, frameInputOffset(input.frameElement))
    )
  const captureWheel = (event: WheelEvent) => {
    if (event.defaultPrevented) return
    const decision = relay.wheel(event)
    if (!decision.handled) return
    event.preventDefault()
    event.stopPropagation()
    if (decision.intent !== undefined) emit(decision.intent)
  }
  const gesturePoint = (event: NativeGestureEvent) => {
    const rect = input.frameElement.getBoundingClientRect()
    return {
      x: event.clientX ?? rect.width / 2,
      y: event.clientY ?? rect.height / 2
    }
  }
  const captureGestureStart = (event: NativeGestureEvent) => {
    event.preventDefault()
    event.stopPropagation()
    relay.gestureStart(event.scale, gesturePoint(event))
  }
  const captureGestureChange = (event: NativeGestureEvent) => {
    event.preventDefault()
    event.stopPropagation()
    emit(relay.gestureChange(event.scale, gesturePoint(event)))
  }
  const captureGestureEnd = (event: NativeGestureEvent) => {
    event.preventDefault()
    event.stopPropagation()
    relay.gestureEnd()
  }
  const captureTouchStart = (event: TouchEvent) => {
    if (!relay.touchStart(touchPoints(event))) return
    event.preventDefault()
    event.stopPropagation()
  }
  const captureTouchMove = (event: TouchEvent) => {
    if (event.touches.length < 2) return
    event.preventDefault()
    event.stopPropagation()
    const intent = relay.touchMove(touchPoints(event))
    if (intent !== null) emit(intent)
  }
  const captureTouchEnd = (event: TouchEvent) => {
    relay.touchEnd(touchPoints(event))
  }
  const captureHotkey = (event: KeyboardEvent) => {
    if (event.key === "Escape" || event.defaultPrevented) return
    const intent = relay.hotkey({
      code: event.code,
      ctrlKey: event.ctrlKey,
      input: inputTarget(event.target),
      key: event.key,
      metaKey: event.metaKey
    })
    if (intent === null) return
    event.preventDefault()
    event.stopPropagation()
    emit(intent)
  }
  const selectFrame = (event: PointerEvent) => emit(relay.select(event))
  const gestureStartListener = nativeGestureListener(captureGestureStart)
  const gestureChangeListener = nativeGestureListener(captureGestureChange)
  const gestureEndListener = nativeGestureListener(captureGestureEnd)
  const options = { capture: true, passive: false } as const
  const nativeGestures = usesNativeGestureEvents(input.target)
  input.target.addEventListener("wheel", captureWheel, options)
  const clearSelection = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
    event.preventDefault()
    event.stopPropagation()
    input.onIntent({ type: "clear-selection" })
  }
  input.target.addEventListener("keydown", clearSelection)
  input.target.addEventListener("keydown", captureHotkey, true)
  input.target.addEventListener("pointerdown", selectFrame, true)
  if (nativeGestures) {
    input.target.addEventListener(
      "gesturestart",
      gestureStartListener,
      options
    )
    input.target.addEventListener(
      "gesturechange",
      gestureChangeListener,
      options
    )
    input.target.addEventListener(
      "gestureend",
      gestureEndListener,
      options
    )
  } else {
    input.target.addEventListener("touchstart", captureTouchStart, options)
    input.target.addEventListener("touchmove", captureTouchMove, options)
    input.target.addEventListener("touchend", captureTouchEnd, options)
    input.target.addEventListener("touchcancel", captureTouchEnd, options)
  }
  return () => {
    relay.gestureEnd()
    input.target.removeEventListener("wheel", captureWheel, true)
    input.target.removeEventListener("keydown", clearSelection)
    input.target.removeEventListener("keydown", captureHotkey, true)
    input.target.removeEventListener("pointerdown", selectFrame, true)
    if (nativeGestures) {
      input.target.removeEventListener(
        "gesturestart",
        gestureStartListener,
        true
      )
      input.target.removeEventListener(
        "gesturechange",
        gestureChangeListener,
        true
      )
      input.target.removeEventListener(
        "gestureend",
        gestureEndListener,
        true
      )
    } else {
      input.target.removeEventListener("touchstart", captureTouchStart, true)
      input.target.removeEventListener("touchmove", captureTouchMove, true)
      input.target.removeEventListener("touchend", captureTouchEnd, true)
      input.target.removeEventListener("touchcancel", captureTouchEnd, true)
    }
  }
}
