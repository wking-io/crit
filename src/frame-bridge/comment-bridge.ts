import type { ElementCommentAnchor } from "../core/comment.js"

export const CRIT_FRAME_COMMENT_SOURCE = "@riff-refine/crit/frame-comments"

export type FrameCommentPin = { readonly id: string; readonly anchor: ElementCommentAnchor }
export type FrameCommentEvent =
  | { readonly type: "ready" }
  | { readonly type: "select"; readonly anchor: ElementCommentAnchor; readonly clientX: number; readonly clientY: number }
  | { readonly type: "open"; readonly id: string; readonly clientX: number; readonly clientY: number }

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)
const isEvent = (value: unknown): value is FrameCommentEvent & { readonly source: string } => {
  if (typeof value !== "object" || value === null || !("source" in value) || value.source !== CRIT_FRAME_COMMENT_SOURCE || !("type" in value)) return false
  if (value.type === "ready") return true
  if ((value.type !== "select" && value.type !== "open") || !("clientX" in value) || !finite(value.clientX) || !("clientY" in value) || !finite(value.clientY)) return false
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
    if (message.type === "ready") return input.onEvent(message)
    const rect = input.frameElement.getBoundingClientRect()
    input.onEvent({ ...message, clientX: rect.left + message.clientX, clientY: rect.top + message.clientY })
  }
  input.target.addEventListener("message", receive)
  return {
    configure: (value: { readonly enabled: boolean; readonly color: string; readonly pins: ReadonlyArray<FrameCommentPin> }) =>
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
  let hovered = null
  let pins = []
  let queued = false
  const icon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 18 18" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M9 1.75C12.3137 1.75 15 4.438 15 7.75C15 12.25 10.5833 15.75 9 16.25C7.4167 15.75 3 12.25 3 7.75C3 4.438 5.6863 1.75 9 1.75ZM9 5.75C7.8954 5.75 7 6.646 7 7.75C7 8.854 7.8954 9.75 9 9.75C10.1046 9.75 11 8.854 11 7.75C11 6.646 10.1046 5.75 9 5.75Z" fill="currentColor" fill-opacity="0.3"></path><path d="M9 9.75C10.1046 9.75 11 8.854 11 7.75C11 6.646 10.1046 5.75 9 5.75C7.8954 5.75 7 6.646 7 7.75C7 8.854 7.8954 9.75 9 9.75Z" stroke="currentColor" fill="none"></path><path d="M9 16.25C10.5833 15.75 15 12.25 15 7.75C15 4.438 12.3137 1.75 9 1.75C5.6863 1.75 3 4.438 3 7.75C3 12.25 7.4167 15.75 9 16.25Z" stroke="currentColor" fill="none"></path></svg>'
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
      if (layer.querySelector('[data-crit-comment-pin="' + pin.id + '"]')) continue
      const button = document.createElement("button")
      button.type = "button"; button.dataset.critCommentPin = pin.id; button.setAttribute("aria-label", "Open comment"); button.innerHTML = icon
      Object.assign(button.style, { alignItems: "center", background: "white", border: "1px solid currentColor", borderRadius: "999px", boxShadow: "0 2px 6px rgba(0,0,0,.18)", cursor: "pointer", height: "24px", justifyContent: "center", padding: "3px", pointerEvents: "auto", position: "fixed", transform: "translate(-50%, -100%)", width: "24px" })
      button.addEventListener("click", (event) => { event.preventDefault(); event.stopImmediatePropagation(); send({ type: "open", id: pin.id, clientX: event.clientX, clientY: event.clientY }) }, true)
      layer.appendChild(button)
    }
    queue()
  }
  addEventListener("message", (event) => {
    const message = event.data
    if (!message || message.source !== source || message.type !== "configure") return
    enabled = message.enabled === true; color = typeof message.color === "string" ? message.color : color; pins = Array.isArray(message.pins) ? message.pins : []
    if (!enabled) hovered = null
    syncPins()
  })
  addEventListener("pointermove", (event) => { if (!enabled || !(event.target instanceof Element) || event.target.closest("[data-crit-comment-layer]")) return; hovered = event.target; queue() }, true)
  addEventListener("pointerleave", () => { hovered = null; queue() }, true)
  addEventListener("click", (event) => {
    const target = event.target
    if (!enabled || !(target instanceof Element) || target.closest("[data-crit-comment-layer]")) return
    event.preventDefault(); event.stopImmediatePropagation()
    const rect = target.getBoundingClientRect(); if (!rect.width || !rect.height) return
    send({ type: "select", anchor: { kind: "element", documentUrl: pageUrl(), selector: selectorFor(target), fingerprint: fingerprintFor(target), xRatio: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), yRatio: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) }, clientX: event.clientX, clientY: event.clientY })
  }, true)
  addEventListener("scroll", queue, { capture: true, passive: true })
  addEventListener("resize", queue, { passive: true })
  new MutationObserver((records) => { if (records.some((record) => !(record.target instanceof Element) || !record.target.closest("[data-crit-comment-layer]"))) queue() }).observe(document.documentElement, { attributes: true, childList: true, subtree: true })
  if (window.ResizeObserver) new ResizeObserver(queue).observe(document.documentElement)
  send({ type: "ready" })
})()
`
