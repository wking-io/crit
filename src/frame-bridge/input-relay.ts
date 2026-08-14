export type FrameInputIntent =
  | { readonly type: "select"; readonly additive: boolean }
  | { readonly type: "delete" }
  | { readonly type: "tool"; readonly tool: "select" | "pan" }
  | { readonly type: "zoom-step"; readonly direction: -1 | 1 }
  | {
      readonly type: "wheel"
      readonly clientX: number
      readonly clientY: number
      readonly ctrlKey: boolean
      readonly metaKey: boolean
      readonly deltaX: number
      readonly deltaY: number
    }
  | {
      readonly type: "pinch"
      readonly clientX: number
      readonly clientY: number
      readonly deltaX: number
      readonly deltaY: number
      readonly scaleFactor: number
    }

export type FrameWheelDecision = {
  readonly handled: boolean
  readonly intent?: Extract<FrameInputIntent, { readonly type: "wheel" }>
}

/**
 * Owns the stateful routing shared by the Canvas, same-origin Frame, and
 * injected cross-origin bridge adapters. The implementation deliberately has
 * no closures so the injected adapter can serialize this exact factory.
 */
export function createFrameInputRelay() {
  let gestureScale = 1
  let gestureActive = false
  let gesturePointX = 0
  let gesturePointY = 0
  let touchInitialDistance = 1
  let touchInitialX = 0
  let touchInitialY = 0
  let touchMode: "undecided" | "pan" | "zoom" = "undecided"

  const touchMetrics = (
    points: ReadonlyArray<{ readonly x: number; readonly y: number }>
  ) => {
    const first = points[0]!
    const second = points[1]!
    return {
      distance: Math.max(1, Math.hypot(
        second.x - first.x,
        second.y - first.y
      )),
      x: (first.x + second.x) / 2,
      y: (first.y + second.y) / 2
    }
  }

  return {
    select: (input?: {
      readonly ctrlKey?: boolean
      readonly metaKey?: boolean
      readonly shiftKey?: boolean
    }) => ({
      type: "select" as const,
      additive:
        input?.ctrlKey === true ||
        input?.metaKey === true ||
        input?.shiftKey === true
    }),
    hotkey: (input: {
      readonly code: string
      readonly ctrlKey: boolean
      readonly input: boolean
      readonly key: string
      readonly metaKey: boolean
    }): FrameInputIntent | null => {
      if (input.input && !input.ctrlKey && !input.metaKey) return null
      const key = input.key.toLowerCase()
      if (!input.ctrlKey && !input.metaKey && key === "backspace") {
        return { type: "delete" }
      }
      if (!input.ctrlKey && !input.metaKey && (key === "v" || key === "h")) {
        return { type: "tool", tool: key === "v" ? "select" : "pan" }
      }
      if (!input.ctrlKey && !input.metaKey) return null
      if (
        input.key === "+" ||
        input.key === "=" ||
        input.code === "NumpadAdd"
      ) return { type: "zoom-step", direction: 1 }
      if (
        input.key === "-" ||
        input.key === "_" ||
        input.code === "NumpadSubtract"
      ) return { type: "zoom-step", direction: -1 }
      return null
    },
    wheel: (
      input: {
        readonly clientX: number
        readonly clientY: number
        readonly ctrlKey: boolean
        readonly metaKey: boolean
        readonly deltaX: number
        readonly deltaY: number
      }
    ): FrameWheelDecision => {
      if (gestureActive && (input.ctrlKey || input.metaKey)) {
        return { handled: true }
      }
      return {
        handled: true,
        intent: {
          type: "wheel",
          clientX: input.clientX,
          clientY: input.clientY,
          ctrlKey: input.ctrlKey,
          metaKey: input.metaKey,
          deltaX: input.deltaX,
          deltaY: input.deltaY
        }
      }
    },
    gestureStart: (
      scale: number | undefined,
      point: { readonly x: number; readonly y: number }
    ) => {
      gestureActive = true
      gestureScale =
        scale !== undefined && Number.isFinite(scale) && scale > 0 ? scale : 1
      gesturePointX = point.x
      gesturePointY = point.y
    },
    gestureChange: (
      scale: number | undefined,
      point: { readonly x: number; readonly y: number }
    ): Extract<FrameInputIntent, { readonly type: "pinch" }> => {
      const nextScale =
        scale !== undefined && Number.isFinite(scale) && scale > 0
          ? scale
          : gestureScale
      const scaleFactor = nextScale / gestureScale
      const deltaX = point.x - gesturePointX
      const deltaY = point.y - gesturePointY
      gestureScale = nextScale
      gesturePointX = point.x
      gesturePointY = point.y
      return {
        type: "pinch",
        clientX: point.x,
        clientY: point.y,
        deltaX,
        deltaY,
        scaleFactor
      }
    },
    gestureEnd: () => {
      gestureActive = false
      gestureScale = 1
      gesturePointX = 0
      gesturePointY = 0
      touchMode = "undecided"
    },
    touchStart: (
      points: ReadonlyArray<{ readonly x: number; readonly y: number }>
    ) => {
      if (points.length < 2) return false
      const metrics = touchMetrics(points)
      gestureActive = true
      gestureScale = metrics.distance
      gesturePointX = metrics.x
      gesturePointY = metrics.y
      touchInitialDistance = metrics.distance
      touchInitialX = metrics.x
      touchInitialY = metrics.y
      touchMode = "undecided"
      return true
    },
    touchMove: (
      points: ReadonlyArray<{ readonly x: number; readonly y: number }>
    ): Extract<FrameInputIntent, { readonly type: "pinch" }> | null => {
      if (points.length < 2) return null
      if (!gestureActive) {
        const metrics = touchMetrics(points)
        gestureActive = true
        gestureScale = metrics.distance
        gesturePointX = metrics.x
        gesturePointY = metrics.y
        touchInitialDistance = metrics.distance
        touchInitialX = metrics.x
        touchInitialY = metrics.y
        touchMode = "undecided"
        return null
      }
      const metrics = touchMetrics(points)
      const distanceChange = Math.abs(
        metrics.distance - touchInitialDistance
      )
      const originDistance = Math.hypot(
        metrics.x - touchInitialX,
        metrics.y - touchInitialY
      )
      if (touchMode === "undecided") {
        if (distanceChange > 24) touchMode = "zoom"
        else if (originDistance > 16) touchMode = "pan"
        else return null
      } else if (touchMode === "pan" && distanceChange > 64) {
        touchMode = "zoom"
        gestureScale = touchInitialDistance
      }
      const scaleFactor = touchMode === "zoom"
        ? metrics.distance / gestureScale
        : 1
      const intent = {
        type: "pinch" as const,
        clientX: metrics.x,
        clientY: metrics.y,
        deltaX: metrics.x - gesturePointX,
        deltaY: metrics.y - gesturePointY,
        scaleFactor
      }
      gestureScale = metrics.distance
      gesturePointX = metrics.x
      gesturePointY = metrics.y
      return intent
    },
    touchEnd: (
      points: ReadonlyArray<{ readonly x: number; readonly y: number }>
    ) => {
      if (points.length >= 2) return
      gestureActive = false
      gestureScale = 1
      gesturePointX = 0
      gesturePointY = 0
      touchMode = "undecided"
    }
  }
}

export const offsetFrameInputIntent = (
  intent: FrameInputIntent,
  offset: { readonly left: number; readonly top: number }
): FrameInputIntent =>
  intent.type === "wheel" || intent.type === "pinch"
    ? {
        ...intent,
        clientX: offset.left + intent.clientX,
        clientY: offset.top + intent.clientY
      }
    : intent

type NativeGestureEvent = Event & {
  readonly clientX?: number
  readonly clientY?: number
  readonly scale?: number
}

const nativeGestureListener = (
  listener: (event: NativeGestureEvent) => void
): EventListener => {
  // SAFETY: WebKit dispatches gesture events as Event instances with these
  // optional coordinates and scale fields, but lib.dom does not declare them.
  return listener as EventListener
}

const touchPoints = (event: TouchEvent) =>
  Array.from(event.touches, (touch) => ({ x: touch.clientX, y: touch.clientY }))

const usesNativeGestureEvents = (target: Window) => {
  const navigator = target.navigator
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  return !ios && "GestureEvent" in target
}

const inputTarget = (target: EventTarget | null) => {
  return target !== null &&
    "matches" in target &&
    typeof target.matches === "function" && (
      ("isContentEditable" in target && target.isContentEditable === true) ||
      target.matches(
        'input:not([type="button"]):not([type="submit"]):not([type="reset"]), textarea, select'
      )
    )
}

export const connectCanvasInput = (input: {
  readonly target: Window
  readonly root: HTMLElement
  readonly onIntent: (intent: FrameInputIntent) => void
}) => {
  const relay = createFrameInputRelay()
  const captureWheel = (event: WheelEvent) => {
    const rect = input.root.getBoundingClientRect()
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    ) return
    const decision = relay.wheel(event)
    if (!decision.handled) return
    event.preventDefault()
    event.stopPropagation()
    if (decision.intent !== undefined) {
      input.onIntent(decision.intent)
    }
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
      offsetFrameInputIntent(intent, input.frameElement.getBoundingClientRect())
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
