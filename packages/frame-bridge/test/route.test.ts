import {
  FRAME_ROUTE_BRIDGE_SCHEMA_VERSION,
  FRAME_ROUTE_BRIDGE_SOURCE,
  FrameBridgeOrigin,
  type FrameRoute
} from "@crit/protocol"
import { Schema } from "effect"
import { describe, expect, it, vi } from "vitest"

import {
  assignLiveFrameRoute,
  connectLiveFrameRoute,
  critFrameRouteBridgeScript
} from "../src/index.js"

const frameOrigin = Schema.decodeUnknownSync(FrameBridgeOrigin)(
  "https://shop.example"
)
const parentOrigin = Schema.decodeUnknownSync(FrameBridgeOrigin)(
  "https://app.example"
)

const frameWindow = (target: EventTarget): Window => target as Window

const bridgedFrame = (contentWindow: Window): HTMLIFrameElement => {
  const target = new EventTarget()
  Object.defineProperty(target, "contentWindow", { value: contentWindow })
  return target as HTMLIFrameElement
}

describe("Live Frame route bridge", () => {
  it("assigns the live URL again when the route changes", () => {
    const iframe = document.createElement("iframe")

    assignLiveFrameRoute(iframe, "https://shop.example/checkout")
    expect(iframe.src).toBe("https://shop.example/checkout")

    assignLiveFrameRoute(iframe, "https://shop.example/cart")
    expect(iframe.src).toBe("https://shop.example/cart")
  })

  it("delivers trusted route messages and ignores a hostile origin", () => {
    const target = new EventTarget()
    const source = frameWindow(new EventTarget())
    const routes: Array<FrameRoute> = []
    const disconnect = connectLiveFrameRoute({
      target: frameWindow(target),
      frameElement: bridgedFrame(source),
      frameOrigin,
      onRoute: (route) => routes.push(route)
    })
    const message = {
      source: FRAME_ROUTE_BRIDGE_SOURCE,
      schemaVersion: FRAME_ROUTE_BRIDGE_SCHEMA_VERSION,
      route: "/checkout?x=1"
    }

    target.dispatchEvent(new MessageEvent("message", {
      data: message,
      origin: "https://evil.example",
      source
    }))
    target.dispatchEvent(new MessageEvent("message", {
      data: message,
      origin: frameOrigin,
      source
    }))
    disconnect()
    target.dispatchEvent(new MessageEvent("message", {
      data: { ...message, route: "/after-disconnect" },
      origin: frameOrigin,
      source
    }))

    expect(routes).toEqual(["/checkout?x=1"])
  })

  it("reads the same-origin location on Frame load", () => {
    const target = new EventTarget()
    const source = frameWindow(new EventTarget())
    Object.defineProperty(source, "location", {
      value: { pathname: "/checkout/", search: "?step=payment" }
    })
    const frame = bridgedFrame(source)
    const onRoute = vi.fn()
    const disconnect = connectLiveFrameRoute({
      target: frameWindow(target),
      frameElement: frame,
      frameOrigin,
      onRoute
    })

    frame.dispatchEvent(new Event("load"))
    disconnect()

    expect(onRoute).toHaveBeenCalledWith("/checkout/?step=payment")
  })

  it("generates a history bridge for the named parent origin", () => {
    const script = critFrameRouteBridgeScript({ parentOrigin })
    const postMessage = vi.fn()
    const location = { pathname: "/checkout", search: "" }
    const listeners = new Map<string, () => void>()
    const frame = {
      parent: { postMessage },
      location,
      history: {
        pushState: () => {
          location.pathname = "/cart"
          location.search = "?x=1"
        },
        replaceState: () => {
          location.pathname = "/payment"
          location.search = ""
        }
      },
      addEventListener: (type: string, listener: () => void) => {
        listeners.set(type, listener)
      }
    }

    expect(() => new Function("window", script)(frame)).not.toThrow()
    frame.history.pushState()
    frame.history.replaceState()
    listeners.get("popstate")?.()

    expect(postMessage).toHaveBeenNthCalledWith(1, {
      source: FRAME_ROUTE_BRIDGE_SOURCE,
      schemaVersion: FRAME_ROUTE_BRIDGE_SCHEMA_VERSION,
      route: "/cart?x=1"
    }, parentOrigin)
    expect(postMessage).toHaveBeenNthCalledWith(2, {
      source: FRAME_ROUTE_BRIDGE_SOURCE,
      schemaVersion: FRAME_ROUTE_BRIDGE_SCHEMA_VERSION,
      route: "/payment"
    }, parentOrigin)
    expect(postMessage).toHaveBeenNthCalledWith(3, {
      source: FRAME_ROUTE_BRIDGE_SOURCE,
      schemaVersion: FRAME_ROUTE_BRIDGE_SCHEMA_VERSION,
      route: "/payment"
    }, parentOrigin)
    expect(script).toContain(`const parentOrigin = ${JSON.stringify(parentOrigin)}`)
    expect(script).toContain("window.history.pushState")
    expect(script).toContain("window.history.replaceState")
    expect(script).toContain('"popstate"')
    expect(script).toContain("}, parentOrigin)")
    expect(script).not.toContain('"*"')
    expect(script).not.toContain("typeof")
  })
})
