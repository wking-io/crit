import type { ElementCommentAnchor } from "../core/comment.js"
import { glyphSvgMarkup } from "../glyphs/index.js"

export const CRIT_FRAME_COMMENT_SOURCE = "@riff-refine/crit/frame-comments"
const COMMENT_PIN_GLYPH_SOURCE = JSON.stringify(glyphSvgMarkup("commentPin"))

export type FrameCommentPin = { readonly id: string; readonly anchor: ElementCommentAnchor }
export type FrameCommentEvent =
  | { readonly type: "ready" }
  | { readonly type: "select"; readonly anchor: ElementCommentAnchor }
  | { readonly type: "open"; readonly id: string }

const isEvent = (value: unknown): value is FrameCommentEvent & { readonly source: string } => {
  if (typeof value !== "object" || value === null || !("source" in value) || value.source !== CRIT_FRAME_COMMENT_SOURCE || !("type" in value)) return false
  if (value.type === "ready") return true
  if (value.type !== "select" && value.type !== "open") return false
  return value.type === "open"
    ? "id" in value && typeof value.id === "string"
    : "anchor" in value && typeof value.anchor === "object" && value.anchor !== null
}

export const connectBridgedFrameComments = (input: {
  readonly target: Window
  readonly frameElement: HTMLIFrameElement
  readonly onEvent: (event: FrameCommentEvent) => void
}) => {
  const receive = (event: MessageEvent) => {
    if (event.source !== input.frameElement.contentWindow || !isEvent(event.data)) return
    const { source: _source, ...message } = event.data
    input.onEvent(message)
  }
  input.target.addEventListener("message", receive)
  return {
    configure: (value: { readonly activeId?: string; readonly enabled: boolean; readonly color: string; readonly pins: ReadonlyArray<FrameCommentPin> }) =>
      input.frameElement.contentWindow?.postMessage({ source: CRIT_FRAME_COMMENT_SOURCE, type: "configure", ...value }, "*"),
    disconnect: () => input.target.removeEventListener("message", receive)
  }
}

export const critFrameCommentBridgeScript = String.raw`
(() => {
  if (window.parent === window) return
  const source = "${CRIT_FRAME_COMMENT_SOURCE}"
  const send = (message) => window.parent.postMessage({ source, ...message }, "*")
  const layer = document.createElement("div")
  layer.dataset.critCommentLayer = ""
  Object.assign(layer.style, { inset: "0", pointerEvents: "none", position: "fixed", zIndex: "2147483647" })
  const highlight = document.createElement("div")
  Object.assign(highlight.style, { border: "2px solid currentColor", borderRadius: "3px", boxSizing: "border-box", display: "none", pointerEvents: "none", position: "fixed" })
  layer.appendChild(highlight)
  document.documentElement.appendChild(layer)
  let enabled = false
  let color = "#77746c"
  let activeId = null
  let hovered = null
  let pins = []
  let queued = false
  const icon = ${COMMENT_PIN_GLYPH_SOURCE}
  const pageUrl = () => { const url = new URL(location.href); url.hash = ""; return url.toString() }
  const escape = (value) => CSS.escape ? CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, (character) => "\\\\" + character)
  const selectorFor = (element) => {
    const critId = element.getAttribute("data-crit-id")
    if (critId) return '[data-crit-id="' + critId.replace(/"/g, '\\"') + '"]'
    if (element.id) return "#" + escape(element.id)
    const testId = element.getAttribute("data-testid")
    if (testId) return '[data-testid="' + testId.replace(/"/g, '\\"') + '"]'
    const parts = []
    let current = element
    while (current && current !== document.documentElement) {
      let part = current.tagName.toLowerCase()
      const parent = current.parentElement
      if (parent) {
        const siblings = Array.from(parent.children).filter((candidate) => candidate.tagName === current.tagName)
        if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")"
      }
      parts.unshift(part)
      current = parent
    }
    return parts.join(" > ")
  }
  const fingerprintFor = (element) => {
    const value = { tagName: element.tagName.toLowerCase() }
    if (element.id) value.id = element.id
    const testId = element.getAttribute("data-testid"); if (testId) value.testId = testId
    const ariaLabel = element.getAttribute("aria-label"); if (ariaLabel) value.ariaLabel = ariaLabel
    const text = (element.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 120); if (text) value.text = text
    return value
  }
  const elementFor = (anchor) => {
    if (!anchor || anchor.kind !== "element" || anchor.documentUrl !== pageUrl()) return null
    try { return document.querySelector(anchor.selector) } catch { return null }
  }
  const render = () => {
    queued = false
    highlight.style.color = color
    if (enabled && hovered && hovered.isConnected) {
      const rect = hovered.getBoundingClientRect()
      Object.assign(highlight.style, { display: rect.width && rect.height ? "block" : "none", height: rect.height + "px", left: rect.left + "px", top: rect.top + "px", width: rect.width + "px" })
    } else highlight.style.display = "none"
    for (const pin of pins) {
      const button = layer.querySelector('[data-crit-comment-pin="' + pin.id + '"]')
      const element = elementFor(pin.anchor)
      if (!button || !element) { if (button) button.style.display = "none"; continue }
      const rect = element.getBoundingClientRect()
      Object.assign(button.style, { color, display: rect.width && rect.height ? "grid" : "none", left: rect.left + rect.width * pin.anchor.xRatio + "px", top: rect.top + rect.height * pin.anchor.yRatio + "px" })
    }
  }
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(render) } }
  const syncPins = () => {
    const ids = new Set(pins.map((pin) => pin.id))
    for (const node of layer.querySelectorAll("[data-crit-comment-pin]")) if (!ids.has(node.dataset.critCommentPin)) node.remove()
    for (const pin of pins) {
      let button = layer.querySelector('[data-crit-comment-pin="' + pin.id + '"]')
      if (!button) {
        button = document.createElement("button")
        button.type = "button"; button.dataset.critCommentPin = pin.id; button.setAttribute("aria-label", "Open comment"); button.innerHTML = icon + '<span data-crit-comment-dot></span>'
        Object.assign(button.style, { alignItems: "center", background: "white", border: "1px solid currentColor", borderRadius: "999px", boxShadow: "0 2px 6px rgba(0,0,0,.18)", cursor: "pointer", height: "24px", justifyContent: "center", padding: "3px", pointerEvents: "auto", position: "fixed", transform: "translate(-50%, -100%)", transition: "background 80ms ease, border-color 80ms ease, box-shadow 80ms ease", width: "24px" })
        const svg = button.querySelector("svg"); if (svg) Object.assign(svg.style, { transition: "opacity 80ms ease, transform 80ms cubic-bezier(.22,1,.36,1)" })
        const dot = button.querySelector("[data-crit-comment-dot]"); if (dot) Object.assign(dot.style, { background: "currentColor", borderRadius: "999px", height: "7px", left: "50%", opacity: "0", position: "absolute", top: "50%", transform: "translate(-50%,-50%) scale(.35)", transition: "opacity 80ms ease, transform 80ms cubic-bezier(.22,1,.36,1)", width: "7px" })
        button.addEventListener("click", (event) => { event.preventDefault(); event.stopImmediatePropagation(); send({ type: "open", id: pin.id }) }, true)
        layer.appendChild(button)
      }
      const active = pin.id === activeId
      button.setAttribute("aria-expanded", active ? "true" : "false")
      Object.assign(button.style, { background: active ? "transparent" : "white", borderColor: active ? "transparent" : "currentColor", boxShadow: active ? "none" : "0 2px 6px rgba(0,0,0,.18)" })
      const svg = button.querySelector("svg"); if (svg) Object.assign(svg.style, { opacity: active ? "0" : "1", transform: active ? "scale(.35)" : "scale(1)" })
      const dot = button.querySelector("[data-crit-comment-dot]"); if (dot) Object.assign(dot.style, { opacity: active ? "1" : "0", transform: active ? "translate(-50%,-50%) scale(1)" : "translate(-50%,-50%) scale(.35)" })
    }
    queue()
  }
  addEventListener("message", (event) => {
    const message = event.data
    if (event.source !== window.parent || !message || message.source !== source || message.type !== "configure") return
    enabled = message.enabled === true; color = typeof message.color === "string" ? message.color : color; pins = Array.isArray(message.pins) ? message.pins : []; activeId = typeof message.activeId === "string" ? message.activeId : null
    if (!enabled) hovered = null
    syncPins()
    // The initial ready event can race the parent's React effect on a cached
    // frame. A configure message doubles as a handshake so the parent can
    // reliably distinguish an instrumented frame from the fallback overlay.
    send({ type: "ready" })
  })
  addEventListener("pointermove", (event) => { if (!enabled || !(event.target instanceof Element) || event.target.closest("[data-crit-comment-layer]")) return; hovered = event.target; queue() }, true)
  addEventListener("pointerleave", () => { hovered = null; queue() }, true)
  addEventListener("click", (event) => {
    const target = event.target
    if (!enabled || !(target instanceof Element) || target.closest("[data-crit-comment-layer]")) return
    event.preventDefault(); event.stopImmediatePropagation()
    const rect = target.getBoundingClientRect(); if (!rect.width || !rect.height) return
    send({ type: "select", anchor: { kind: "element", documentUrl: pageUrl(), selector: selectorFor(target), fingerprint: fingerprintFor(target), xRatio: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), yRatio: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) } })
  }, true)
  addEventListener("scroll", queue, { capture: true, passive: true })
  addEventListener("resize", queue, { passive: true })
  new MutationObserver((records) => { if (records.some((record) => !(record.target instanceof Element) || !record.target.closest("[data-crit-comment-layer]"))) queue() }).observe(document.documentElement, { attributes: true, childList: true, subtree: true })
  if (window.ResizeObserver) new ResizeObserver(queue).observe(document.documentElement)
  send({ type: "ready" })
})()
`
