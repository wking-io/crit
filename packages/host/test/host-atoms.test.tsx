import { LocalBrowserConnection } from "@crit/client"
import { Id } from "@crit/domain"
import { LocalDaemonInstanceNonce } from "@crit/replica/http"
import { Schema } from "effect"
import { AtomRegistry } from "effect/unstable/reactivity"
import { describe, expect, it } from "vitest"

import { hostIndexAtom, hostScreenAtom } from "../src/host-atoms.js"

const instance = Schema.decodeUnknownSync(LocalDaemonInstanceNonce)(
  "0123456789abcdef0123456789abcdef"
)

const shopCanvasId = Id.canvas("canvas_shop")
const reviewCanvasId = Id.canvas("canvas_review")

describe("hostScreenAtom", () => {
  it("is invalid for a bad fragment and can be read after the registry is replaced", () => {
    const atom = hostScreenAtom("#crit=")(shopCanvasId)
    const first = AtomRegistry.make()
    expect(first.get(atom)).toEqual({ _tag: "invalid" })
    first.dispose()
    expect(() => first.get(atom)).toThrow(/disposed/)
    const second = AtomRegistry.make()
    expect(second.get(atom)).toEqual({ _tag: "invalid" })
    second.dispose()
  })

  it("reuses the atom for the same fragment and canvas id", () => {
    const descriptor = LocalBrowserConnection.make({
      baseUrl: "http://127.0.0.1:49152",
      instance
    })
    const fragment = LocalBrowserConnection.encode(descriptor)
    expect(hostScreenAtom(fragment)(shopCanvasId))
      .toBe(hostScreenAtom(fragment)(shopCanvasId))
  })

  it("is ready for a valid fragment without creating a canvas", () => {
    const descriptor = LocalBrowserConnection.make({
      baseUrl: "http://127.0.0.1:49152",
      instance
    })
    const registry = AtomRegistry.make()
    const screen = registry.get(hostScreenAtom(LocalBrowserConnection.encode(descriptor))(shopCanvasId))
    expect(screen._tag).toBe("ready")
    if (screen._tag === "ready") {
      expect(screen.props.canvasId).toBe(shopCanvasId)
    }
    registry.dispose()
  })

  it("boots two named canvases as separate atoms on the same fragment", () => {
    const descriptor = LocalBrowserConnection.make({
      baseUrl: "http://127.0.0.1:49152",
      instance
    })
    const fragment = LocalBrowserConnection.encode(descriptor)
    const shop = hostScreenAtom(fragment)(shopCanvasId)
    const review = hostScreenAtom(fragment)(reviewCanvasId)
    expect(review).not.toBe(shop)
    const registry = AtomRegistry.make()
    const shopScreen = registry.get(shop)
    const reviewScreen = registry.get(review)
    expect(shopScreen._tag).toBe("ready")
    expect(reviewScreen._tag).toBe("ready")
    if (shopScreen._tag === "ready") {
      expect(shopScreen.props.canvasId).toBe(shopCanvasId)
    }
    if (reviewScreen._tag === "ready") {
      expect(reviewScreen.props.canvasId).toBe(reviewCanvasId)
    }
    registry.dispose()
  })
})

describe("hostIndexAtom", () => {
  it("is invalid for a bad fragment", () => {
    const registry = AtomRegistry.make()
    expect(registry.get(hostIndexAtom("#crit="))).toEqual({ _tag: "invalid" })
    registry.dispose()
  })

  it("starts connecting for a valid fragment", () => {
    const descriptor = LocalBrowserConnection.make({
      baseUrl: "http://127.0.0.1:49152",
      instance
    })
    const registry = AtomRegistry.make()
    expect(registry.get(hostIndexAtom(LocalBrowserConnection.encode(descriptor)))._tag)
      .toBe("connecting")
    registry.dispose()
  })
})
