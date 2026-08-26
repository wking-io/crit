import { Option } from "effect"

import {
  FRAME_ROUTE_BRIDGE_SCHEMA_VERSION,
  FRAME_ROUTE_BRIDGE_SOURCE,
  decodeFrameRouteBridgeMessage,
  type FrameBridgeOrigin,
  type FrameRoute
} from "@crit/protocol"

import { isTrustedFrameBridgeEvent } from "./origin.js"

export const assignLiveFrameRoute = (
  frameElement: HTMLIFrameElement,
  url: string
) => {
  frameElement.src = url
}

export const connectLiveFrameRoute = (input: {
  readonly target: Window
  readonly frameElement: HTMLIFrameElement
  readonly frameOrigin: FrameBridgeOrigin
  readonly onRoute: (route: FrameRoute) => void
}) => {
  const deliver = (route: string) => {
    const decoded = decodeFrameRouteBridgeMessage({
      source: FRAME_ROUTE_BRIDGE_SOURCE,
      schemaVersion: FRAME_ROUTE_BRIDGE_SCHEMA_VERSION,
      route
    })
    if (Option.isSome(decoded)) input.onRoute(decoded.value.route)
  }
  const readSameOriginRoute = () => {
    try {
      const frameWindow = input.frameElement.contentWindow
      if (frameWindow === null) return
      deliver(`${frameWindow.location.pathname}${frameWindow.location.search}`)
    } catch {
      return
    }
  }
  const receive = (event: MessageEvent) => {
    if (!isTrustedFrameBridgeEvent(event, {
      origin: input.frameOrigin,
      source: input.frameElement.contentWindow
    })) return
    const decoded = decodeFrameRouteBridgeMessage(event.data)
    if (Option.isSome(decoded)) input.onRoute(decoded.value.route)
  }
  input.target.addEventListener("message", receive)
  input.frameElement.addEventListener("load", readSameOriginRoute)
  return () => {
    input.target.removeEventListener("message", receive)
    input.frameElement.removeEventListener("load", readSameOriginRoute)
  }
}

export const FRAME_ROUTE_BRIDGE_HTML_MARKER = "data-crit-route-bridge"

export const critFrameRouteBridgeScript = (input: {
  readonly parentOrigin: FrameBridgeOrigin
}) => String.raw`
(() => {
  if (window.parent === window) return
  const parentOrigin = ${JSON.stringify(input.parentOrigin)}
  const source = "${FRAME_ROUTE_BRIDGE_SOURCE}"
  const schemaVersion = ${FRAME_ROUTE_BRIDGE_SCHEMA_VERSION}
  const send = () => window.parent.postMessage({
    source,
    schemaVersion,
    route: window.location.pathname + window.location.search
  }, parentOrigin)
  const wrap = (method) => (...args) => {
    const result = method.apply(window.history, args)
    send()
    return result
  }
  window.history.pushState = wrap(window.history.pushState)
  window.history.replaceState = wrap(window.history.replaceState)
  window.addEventListener("popstate", send)
})()
`
