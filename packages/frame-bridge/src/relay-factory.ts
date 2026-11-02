import type { FrameInputIntent } from "@crit/protocol"

export type FrameWheelDecision = {
  readonly handled: boolean
  readonly intent?: Extract<FrameInputIntent, { readonly type: "wheel" }>
}

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
      const modified = input.ctrlKey || input.metaKey
      if (!modified && input.key === "Escape") {
        return { type: "clear-selection" }
      }
      if (input.input && !modified) return null
      const key = input.key.toLowerCase()
      if (!modified && key === "backspace") {
        return { type: "delete" }
      }
      if (!modified && (key === "v" || key === "h")) {
        return { type: "tool", tool: key === "v" ? "select" : "pan" }
      }
      if (!modified) return null
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
