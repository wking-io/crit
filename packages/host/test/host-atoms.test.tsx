import { LocalBrowserConnection } from "@crit/client"
import { Id } from "@crit/domain"
import { LocalDaemonInstanceNonce } from "@crit/replica/http"
import { Schema } from "effect"
import { AtomRegistry } from "effect/unstable/reactivity"
import { describe, expect, it } from "vitest"

import { hostScreenAtom } from "../src/host-atoms.js"
import { localCanvasId } from "../src/index.js"

const instance = Schema.decodeUnknownSync(LocalDaemonInstanceNonce)(
  "0123456789abcdef0123456789abcdef"
)

const shopCanvasId = Id.canvas("canvas_shop")

describe("hostScreenAtom", () => {
  it("is invalid for a bad fragment and can be read after the registry is replaced", () => {
    const atom = hostScreenAtom("#crit=")(localCanvasId)
    const first = AtomRegistry.make()
    expect(first.get(atom)).toEqual({ _tag: "invalid" })
    first.dispose()
    expect(() => first.get(atom)).toThrow(/disposed/)
    const second = AtomRegistry.make()
    expect(second.get(atom)).toEqual({ _tag: "invalid" })
    second.dispose()
  })

  it("keeps a named canvas invalid when the fragment is bad", () => {
    const atom = hostScreenAtom("#crit=")(shopCanvasId)
    const registry = AtomRegistry.make()
    expect(registry.get(atom)).toEqual({ _tag: "invalid" })
    registry.dispose()
  })

  it("reuses the atom for the same fragment and canvas id", () => {
    const descriptor = LocalBrowserConnection.make({
      baseUrl: "http://127.0.0.1:49152",
      instance
    })
    const fragment = LocalBrowserConnection.encode(descriptor)
    expect(hostScreenAtom(fragment)(localCanvasId))
      .toBe(hostScreenAtom(fragment)(localCanvasId))
  })

  it("starts connecting for a valid fragment", () => {
    const descriptor = LocalBrowserConnection.make({
      baseUrl: "http://127.0.0.1:49152",
      instance
    })
    const registry = AtomRegistry.make()
    expect(registry.get(hostScreenAtom(LocalBrowserConnection.encode(descriptor))(localCanvasId))._tag)
      .toBe("connecting")
    registry.dispose()
  })

  it("boots a named canvas separately from canvas_local on the same fragment", () => {
    const descriptor = LocalBrowserConnection.make({
      baseUrl: "http://127.0.0.1:49152",
      instance
    })
    const fragment = LocalBrowserConnection.encode(descriptor)
    const local = hostScreenAtom(fragment)(localCanvasId)
    const shop = hostScreenAtom(fragment)(shopCanvasId)
    expect(shop).not.toBe(local)
    const registry = AtomRegistry.make()
    expect(registry.get(local)._tag).toBe("connecting")
    const shopScreen = registry.get(shop)
    expect(shopScreen._tag).toBe("ready")
    if (shopScreen._tag === "ready") {
      expect(shopScreen.props.canvasId).toBe(shopCanvasId)
    }
    registry.dispose()
  })
})
