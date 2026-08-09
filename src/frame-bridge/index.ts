export const CRIT_FRAME_INPUT_SOURCE = "@riff-refine/crit/frame-input"

export type CritFrameInputMessage =
  | {
      readonly source: typeof CRIT_FRAME_INPUT_SOURCE
      readonly type: "select"
    }
  | {
      readonly source: typeof CRIT_FRAME_INPUT_SOURCE
      readonly type: "wheel"
      readonly clientX: number
      readonly clientY: number
      readonly ctrlKey: boolean
      readonly metaKey: boolean
      readonly deltaX: number
      readonly deltaY: number
    }
  | {
      readonly source: typeof CRIT_FRAME_INPUT_SOURCE
      readonly type: "hotkey"
      readonly altKey: boolean
      readonly code: string
      readonly ctrlKey: boolean
      readonly input: boolean
      readonly key: string
      readonly metaKey: boolean
      readonly shiftKey: boolean
    }
  | {
      readonly source: typeof CRIT_FRAME_INPUT_SOURCE
      readonly type: "pinch"
      readonly clientX: number
      readonly clientY: number
      readonly scaleFactor: number
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
  if (value.type === "select") return true
  if (value.type === "hotkey") {
    return "altKey" in value && typeof value.altKey === "boolean" &&
      "code" in value && typeof value.code === "string" &&
      "ctrlKey" in value && typeof value.ctrlKey === "boolean" &&
      "input" in value && typeof value.input === "boolean" &&
      "key" in value && typeof value.key === "string" &&
      "metaKey" in value && typeof value.metaKey === "boolean" &&
      "shiftKey" in value && typeof value.shiftKey === "boolean"
  }
  if (value.type === "pinch") {
    return "clientX" in value && finiteNumber(value.clientX) &&
      "clientY" in value && finiteNumber(value.clientY) &&
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

export const critFrameInputBridgeScript = String.raw`
(() => {
  if (window.parent === window) return
  const source = "${CRIT_FRAME_INPUT_SOURCE}"
  const send = (message) => window.parent.postMessage({ source, ...message }, "*")
  window.addEventListener("keydown", (event) => {
    const target = event.target
    const input = target instanceof HTMLElement && (
      target.isContentEditable ||
      target.matches('input:not([type="button"]):not([type="submit"]):not([type="reset"]), textarea, select')
    )
    if (input && !event.ctrlKey && !event.metaKey) return
    const key = event.key.toLowerCase()
    const toolShortcut = !event.ctrlKey && !event.metaKey && (key === "v" || key === "h")
    const zoomShortcut = (event.ctrlKey || event.metaKey) && (
      event.key === "+" || event.key === "=" || event.key === "-" || event.key === "_" ||
      event.code === "NumpadAdd" || event.code === "NumpadSubtract"
    )
    if (!toolShortcut && !zoomShortcut) return
    event.preventDefault()
    event.stopImmediatePropagation()
    send({
      type: "hotkey",
      altKey: event.altKey,
      code: event.code,
      ctrlKey: event.ctrlKey,
      input,
      key: event.key,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey
    })
  }, { capture: true })
  window.addEventListener("pointerdown", () => {
    send({ type: "select" })
  }, { capture: true })
  let gestureScale = 1
  let gestureActive = false
  window.addEventListener("wheel", (event) => {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (gestureActive && (event.ctrlKey || event.metaKey)) return
    send({
      type: "wheel",
      clientX: event.clientX,
      clientY: event.clientY,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      deltaX: event.deltaX,
      deltaY: event.deltaY
    })
  }, { capture: true, passive: false })
  window.addEventListener("gesturestart", (event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
    gestureActive = true
    gestureScale = event.scale || 1
  }, { capture: true, passive: false })
  window.addEventListener("gesturechange", (event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
    const nextScale = event.scale || gestureScale
    const scaleFactor = nextScale / gestureScale
    gestureScale = nextScale
    send({
      type: "pinch",
      clientX: typeof event.clientX === "number" ? event.clientX : window.innerWidth / 2,
      clientY: typeof event.clientY === "number" ? event.clientY : window.innerHeight / 2,
      scaleFactor
    })
  }, { capture: true, passive: false })
  window.addEventListener("gestureend", (event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
    gestureActive = false
    gestureScale = 1
  }, { capture: true, passive: false })
})()
`
