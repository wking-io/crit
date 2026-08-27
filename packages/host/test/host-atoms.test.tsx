import { LocalBrowserConnection } from "@crit/client"
import { Id } from "@crit/domain"
import { LocalDaemonInstanceNonce } from "@crit/replica/http"
import { Schema } from "effect"
import { AtomRegistry } from "effect/unstable/reactivity"
import { afterEach, describe, expect, it, vi } from "vitest"

import { HostIndexScreen, hostIndexAtom, HostScreen, hostScreenAtom } from "../src/host-atoms.js"

const fetchMock = vi.hoisted(() => {
  const mock = vi.fn<typeof globalThis.fetch>(() => new Promise(() => {}))
  vi.stubGlobal("fetch", mock)
  return mock
})

const instance = Schema.decodeUnknownSync(LocalDaemonInstanceNonce)(
  "0123456789abcdef0123456789abcdef"
)

const shopCanvasId = Id.canvas("canvas_shop")
const reviewCanvasId = Id.canvas("canvas_review")
const localOrigin = "http://127.0.0.1:5173"

afterEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation(() => new Promise(() => {}))
})

describe("hostScreenAtom", () => {
  it("is invalid for a bad fragment and can be read after the registry is replaced", () => {
    const atom = hostScreenAtom("#crit=")(localOrigin)(shopCanvasId)
    const first = AtomRegistry.make()
    expect(first.get(atom)).toEqual({
      _tag: "invalid",
      reason: "Unable to connect to Crit."
    })
    first.dispose()
    expect(() => first.get(atom)).toThrow(/disposed/)
    const second = AtomRegistry.make()
    expect(second.get(atom)).toEqual({
      _tag: "invalid",
      reason: "Unable to connect to Crit."
    })
    second.dispose()
  })

  it("reuses the atom for the same fragment and canvas id", () => {
    const descriptor = LocalBrowserConnection.make({
      baseUrl: "http://127.0.0.1:49152",
      instance
    })
    const fragment = LocalBrowserConnection.encode(descriptor)
    expect(hostScreenAtom(fragment)(localOrigin)(shopCanvasId))
      .toBe(hostScreenAtom(fragment)(localOrigin)(shopCanvasId))
  })

  it("is ready for a valid fragment without creating a canvas", () => {
    const descriptor = LocalBrowserConnection.make({
      baseUrl: "http://127.0.0.1:49152",
      instance
    })
    const registry = AtomRegistry.make()
    const screen = registry.get(
      hostScreenAtom(LocalBrowserConnection.encode(descriptor))(localOrigin)(
        shopCanvasId
      )
    )
    expect(HostScreen.$is("ready")(screen)).toBe(true)
    if (HostScreen.$is("ready")(screen)) {
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
    const shop = hostScreenAtom(fragment)(localOrigin)(shopCanvasId)
    const review = hostScreenAtom(fragment)(localOrigin)(reviewCanvasId)
    expect(review).not.toBe(shop)
    const registry = AtomRegistry.make()
    const shopScreen = registry.get(shop)
    const reviewScreen = registry.get(review)
    expect(HostScreen.$is("ready")(shopScreen)).toBe(true)
    expect(HostScreen.$is("ready")(reviewScreen)).toBe(true)
    if (HostScreen.$is("ready")(shopScreen)) {
      expect(shopScreen.props.canvasId).toBe(shopCanvasId)
    }
    if (HostScreen.$is("ready")(reviewScreen)) {
      expect(reviewScreen.props.canvasId).toBe(reviewCanvasId)
    }
    registry.dispose()
  })
})

describe("hostIndexAtom", () => {
  it("is invalid for a bad fragment", () => {
    const registry = AtomRegistry.make()
    expect(registry.get(hostIndexAtom("#crit=")(localOrigin))).toEqual({
      _tag: "invalid",
      reason: "Unable to connect to Crit."
    })
    registry.dispose()
  })

  it("is invalid for a fragment-free loopback origin", () => {
    const registry = AtomRegistry.make()
    expect(registry.get(hostIndexAtom("")(localOrigin))).toEqual({
      _tag: "invalid",
      reason: "Hosted mode requires a non-loopback HTTPS origin."
    })
    registry.dispose()
  })

  it("starts connecting for a valid fragment", () => {
    const descriptor = LocalBrowserConnection.make({
      baseUrl: "http://127.0.0.1:49152",
      instance
    })
    const registry = AtomRegistry.make()
    expect(HostIndexScreen.$is("connecting")(registry.get(
      hostIndexAtom(LocalBrowserConnection.encode(descriptor))(localOrigin)
    ))).toBe(true)
    registry.dispose()
  })

  it("becomes ready after a successful local list", async() => {
    const descriptor = LocalBrowserConnection.make({
      baseUrl: "http://127.0.0.1:5173",
      instance
    })
    fetchMock.mockImplementation(async() => new Response(JSON.stringify([{
      canvasId: "canvas_launch_lab",
      title: "Launch lab"
    }]), {
      status: 200,
      headers: { "content-type": "application/json" }
    }))
    const registry = AtomRegistry.make()
    const atom = hostIndexAtom(LocalBrowserConnection.encode(descriptor))(localOrigin)
    const keep = registry.mount(atom)
    expect(HostIndexScreen.$is("connecting")(registry.get(atom))).toBe(true)
    await vi.waitFor(() => {
      expect(HostIndexScreen.$is("ready")(registry.get(atom))).toBe(true)
    })
    const screen = registry.get(atom)
    expect(HostIndexScreen.$is("ready")(screen)).toBe(true)
    if (HostIndexScreen.$is("ready")(screen)) {
      expect(screen.listings).toEqual([{
        canvasId: "canvas_launch_lab",
        title: "Launch lab"
      }])
    }
    keep()
    registry.dispose()
  })
})
