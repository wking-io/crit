import {
  ApplicationRouteRepresentation,
  ArtifactRepresentation,
  Id,
  WebUrlRepresentation
} from "@crit/domain"
import { FRAME_ROUTE_BRIDGE_HTML_MARKER } from "@crit/frame-bridge"
import {
  FRAME_INPUT_BRIDGE_SCHEMA_VERSION,
  FRAME_INPUT_BRIDGE_SOURCE,
  FRAME_ROUTE_BRIDGE_SCHEMA_VERSION,
  FRAME_ROUTE_BRIDGE_SOURCE
} from "@crit/protocol"
import {
  ApplicationUnavailableRenderPlan,
  ArtifactBytesRenderPlan,
  ArtifactUnavailableRenderPlan,
  IframeRenderPlan,
  type RenderPlan
} from "@crit/representations"
import { Effect, Match } from "effect"
import { StrictMode, act, type ReactElement } from "react"
import { flushSync } from "react-dom"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  FrameRenderer,
  type FrameRendererFrame,
  type FrameRepresentationResolver
} from "../src/index.js"
import { CritRegistry } from "./crit-registry.js"

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true })

const representation = WebUrlRepresentation.make({ url: "https://example.com/checkout" })
const frame = (
  revision: string,
  nextRepresentation = representation
): FrameRendererFrame => ({
  title: "Checkout",
  representation: nextRepresentation,
  representationChangedByChangeId: Id.change(revision)
})
const iframePlan = (url: string): RenderPlan => IframeRenderPlan.make({
  representation: WebUrlRepresentation.make({ url }),
  url
})

let container: HTMLDivElement
let root: Root

const render = (element: ReactElement) => root.render(
  <CritRegistry>{element}</CritRegistry>
)
const waitFor = (assertion: () => void) => act(async() => vi.waitFor(assertion))
const prepareFrameDocument = (iframe: HTMLIFrameElement) => {
  const frameDocument = iframe.contentDocument
  if (frameDocument === null) throw new Error("Expected a writable Frame document")
  frameDocument.open()
  frameDocument.write("<!doctype html><html><head></head><body></body></html>")
  frameDocument.close()
  return frameDocument
}

beforeEach(() => {
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async() => {
  await act(async() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

describe("FrameRenderer", () => {
  it("renders loading and then a live iframe without a referrer", async() => {
    let complete: ((plan: RenderPlan) => void) | undefined
    const resolver: FrameRepresentationResolver = {
      resolve: () => Effect.callback<RenderPlan, unknown>((resume) => {
        complete = (plan) => resume(Effect.succeed(plan))
      })
    }

    await act(async() => render(<FrameRenderer frame={frame("change_frame_loading")} resolver={resolver} />))
    expect(container.textContent).toBe("Loading Checkout.")

    await act(async() => {
      complete?.(iframePlan("https://example.com/ready"))
    })
    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull())
    const iframe = container.querySelector("iframe")
    expect(iframe?.getAttribute("src")).toBe("https://example.com/ready")
    expect(iframe?.getAttribute("title")).toBe("Checkout")
    expect(iframe?.getAttribute("referrerpolicy")).toBe("no-referrer")
    expect(iframe?.hasAttribute("sandbox")).toBe(false)
  })

  it("keeps the same iframe when painting is paused", async() => {
    const resolver: FrameRepresentationResolver = {
      resolve: () => Effect.succeed(iframePlan("https://example.com/ready"))
    }
    await act(async() => render(
      <FrameRenderer frame={frame("change_frame_paused")} resolver={resolver} />
    ))
    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull())
    const iframe = container.querySelector("iframe")
    expect(iframe).toBeInstanceOf(HTMLIFrameElement)

    await act(async() => render(
      <FrameRenderer
        frame={frame("change_frame_paused")}
        paused
        resolver={resolver}
      />
    ))
    expect(container.querySelector("iframe")).toBe(iframe)
    expect(iframe?.getAttribute("data-paused")).toBe("true")
    expect(container.textContent).toContain("Frame paused while offscreen")
  })

  it("injects and connects the input bridge for a same-origin live iframe", async() => {
    const url = "https://example.com/fixture"
    const resolver: FrameRepresentationResolver = {
      resolve: () => Effect.succeed(iframePlan(url))
    }
    const onInputIntent = vi.fn()

    await act(async() => render(
      <FrameRenderer
        frame={frame("change_frame_input_bridge")}
        onInputIntent={onInputIntent}
        resolver={resolver}
      />
    ))
    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull())
    const iframe = container.querySelector("iframe")
    if (iframe === null) throw new Error("Expected a live Frame")
    const frameDocument = prepareFrameDocument(iframe)

    iframe.dispatchEvent(new Event("load"))
    iframe.dispatchEvent(new Event("load"))

    const scripts = frameDocument.querySelectorAll(
      "script[data-crit-input-bridge]"
    )
    expect(scripts).toHaveLength(1)
    expect(scripts[0]?.textContent).toContain(FRAME_INPUT_BRIDGE_SOURCE)

    const frameWindow = iframe.contentWindow
    if (frameWindow === null) throw new Error("Expected a live Frame window")
    await act(async() => {
      window.dispatchEvent(new MessageEvent("message", {
        origin: new URL(url).origin,
        source: frameWindow,
        data: {
          source: FRAME_INPUT_BRIDGE_SOURCE,
          schemaVersion: FRAME_INPUT_BRIDGE_SCHEMA_VERSION,
          intent: { type: "select", additive: true }
        }
      }))
    })

    expect(onInputIntent).toHaveBeenCalledWith({
      type: "select",
      additive: true
    })
  })

  it("injects and connects the route bridge for a same-origin live iframe", async() => {
    const url = "https://example.com/fixture-route"
    const resolver: FrameRepresentationResolver = {
      resolve: () => Effect.succeed(iframePlan(url))
    }
    const onRouteChange = vi.fn()

    await act(async() => render(
      <FrameRenderer
        frame={frame("change_frame_route_bridge")}
        onRouteChange={onRouteChange}
        resolver={resolver}
      />
    ))
    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull())
    const iframe = container.querySelector("iframe")
    if (iframe === null) throw new Error("Expected a live Frame")
    const frameDocument = prepareFrameDocument(iframe)

    iframe.dispatchEvent(new Event("load"))
    iframe.dispatchEvent(new Event("load"))

    const scripts = frameDocument.querySelectorAll(
      `script[${FRAME_ROUTE_BRIDGE_HTML_MARKER}]`
    )
    expect(scripts).toHaveLength(1)
    expect(scripts[0]?.textContent).toContain(FRAME_ROUTE_BRIDGE_SOURCE)

    const frameWindow = iframe.contentWindow
    if (frameWindow === null) throw new Error("Expected a live Frame window")
    onRouteChange.mockClear()
    await act(async() => {
      window.dispatchEvent(new MessageEvent("message", {
        origin: new URL(url).origin,
        source: frameWindow,
        data: {
          source: FRAME_ROUTE_BRIDGE_SOURCE,
          schemaVersion: FRAME_ROUTE_BRIDGE_SCHEMA_VERSION,
          route: "/checkout?x=1"
        }
      }))
    })

    expect(onRouteChange).toHaveBeenCalledWith("/checkout?x=1")
  })

  it("does not inject the input bridge without an input callback", async() => {
    const url = "https://example.com/fixture-without-input"
    const resolver: FrameRepresentationResolver = {
      resolve: () => Effect.succeed(iframePlan(url))
    }

    await act(async() => render(
      <FrameRenderer
        frame={frame("change_frame_without_input_bridge")}
        resolver={resolver}
      />
    ))
    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull())
    const iframe = container.querySelector("iframe")
    if (iframe === null) throw new Error("Expected a live Frame")
    const frameDocument = prepareFrameDocument(iframe)

    iframe.dispatchEvent(new Event("load"))

    expect(
      frameDocument.querySelector("script[data-crit-input-bridge]")
    ).toBeNull()
    expect(
      frameDocument.querySelector(`script[${FRAME_ROUTE_BRIDGE_HTML_MARKER}]`)
    ).toBeNull()
  })

  it("skips input bridge injection when the Frame document is blocked", async() => {
    const resolver: FrameRepresentationResolver = {
      resolve: () => Effect.succeed(iframePlan("https://example.com/blocked"))
    }

    await act(async() => render(
      <FrameRenderer
        frame={frame("change_frame_blocked_input_bridge")}
        onInputIntent={() => undefined}
        resolver={resolver}
      />
    ))
    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull())
    const iframe = container.querySelector("iframe")
    if (iframe === null) throw new Error("Expected a live Frame")
    Object.defineProperty(iframe, "contentDocument", {
      configurable: true,
      get: () => {
        throw new DOMException("Blocked", "SecurityError")
      }
    })

    expect(() => iframe.dispatchEvent(new Event("load"))).not.toThrow()
    expect(container.querySelector("iframe")).toBe(iframe)
  })

  it.each([
    { reason: "application-unbound", expected: "application is not bound" },
    { reason: "artifact-not-found", expected: "artifact was not found" },
    { reason: "artifact-corrupt", expected: "artifact failed its integrity check" }
  ] satisfies ReadonlyArray<{
    readonly reason: "application-unbound" | "artifact-not-found" | "artifact-corrupt"
    readonly expected: string
  }>)("renders the $reason unavailable state", async({ reason, expected }) => {
    const artifact = ArtifactRepresentation.make({
      artifactId: Id.artifact("artifact_react_unavailable"),
      digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    })
    const plan = reason === "application-unbound"
      ? ApplicationUnavailableRenderPlan.make({
        reason,
        representation: ApplicationRouteRepresentation.make({
          applicationId: Id.application("application_react_unavailable"),
          route: "/checkout"
        })
      })
      : ArtifactUnavailableRenderPlan.make({ reason, representation: artifact })
    const resolver: FrameRepresentationResolver = { resolve: () => Effect.succeed(plan) }

    await act(async() => render(<FrameRenderer frame={frame("change_frame_unavailable")} resolver={resolver} />))
    await waitFor(() => expect(
      container.querySelector('[role="status"]')?.textContent
    ).toContain(expected))
    expect(container.querySelector("iframe")).toBeNull()
  })

  it("renders a bounded operational failure without exposing its cause", async() => {
    const resolver: FrameRepresentationResolver = {
      resolve: () => Effect.fail("private resolver failure")
    }
    await act(async() => render(<FrameRenderer frame={frame("change_frame_failure")} resolver={resolver} />))
    await waitFor(() => expect(
      container.querySelector('[role="alert"]')?.textContent
    ).toBe("Could not load Checkout."))
    expect(container.textContent).not.toContain("private resolver failure")
  })

  it("rejects stale completion and does not re-resolve an unchanged revision", async() => {
    const completions = new Map<string, (plan: RenderPlan) => void>()
    let resolves = 0
    const resolver: FrameRepresentationResolver = {
      resolve: (input) => Effect.uninterruptible(Effect.callback<RenderPlan, unknown>((resume) => {
        resolves += 1
        Match.value(input).pipe(
          Match.tag("webUrl", (input) => {
            completions.set(input.url, (plan) => resume(Effect.succeed(plan)))
          }),
          Match.orElse(() => {})
        )
      }))
    }
    const first = frame(
      "change_frame_first",
      WebUrlRepresentation.make({ url: "https://example.com/first" })
    )
    const second = frame(
      "change_frame_second",
      WebUrlRepresentation.make({ url: "https://example.com/second" })
    )

    await act(async() => render(<FrameRenderer frame={first} resolver={resolver} />))
    await act(async() => render(<FrameRenderer frame={second} resolver={resolver} />))
    await act(async() => {
      completions.get("https://example.com/second")?.(iframePlan("https://example.com/second"))
    })
    await act(async() => {
      completions.get("https://example.com/first")?.(iframePlan("https://example.com/first"))
    })
    await waitFor(() => expect(
      container.querySelector("iframe")?.getAttribute("src")
    ).toBe("https://example.com/second"))

    const equivalentSecond = frame(
      "change_frame_second",
      WebUrlRepresentation.make({ url: "https://example.com/second" })
    )
    await act(async() => render(<FrameRenderer frame={equivalentSecond} resolver={resolver} />))
    expect(resolves).toBe(2)

    const changedWithoutNewRevision = frame(
      "change_frame_second",
      WebUrlRepresentation.make({ url: "https://example.com/third" })
    )
    await act(async() => render(
      <FrameRenderer frame={changedWithoutNewRevision} resolver={resolver} />
    ))
    await act(async() => {
      completions.get("https://example.com/third")?.(iframePlan("https://example.com/third"))
    })
    expect(resolves).toBe(3)
    await waitFor(() => expect(
      container.querySelector("iframe")?.getAttribute("src")
    ).toBe("https://example.com/third"))
  })

  it("hides a resolved plan immediately when the resolver changes", async() => {
    const first: FrameRepresentationResolver = {
      resolve: () => Effect.succeed(iframePlan("https://example.com/first-resolver"))
    }
    const second: FrameRepresentationResolver = { resolve: () => Effect.never }
    const currentFrame = frame("change_frame_resolver")

    await act(async() => render(<FrameRenderer frame={currentFrame} resolver={first} />))
    await waitFor(() => expect(
      container.querySelector("iframe")?.getAttribute("src")
    ).toBe("https://example.com/first-resolver"))

    flushSync(() => render(<FrameRenderer frame={currentFrame} resolver={second} />))
    expect(container.querySelector("iframe")).toBeNull()
    expect(container.textContent).toBe("Loading Checkout.")
  })

  it("interrupts pending resolution on unmount", async() => {
    let interrupted = false
    const resolver: FrameRepresentationResolver = {
      resolve: () => Effect.never.pipe(
        Effect.onInterrupt(() => Effect.sync(() => {
          interrupted = true
        }))
      )
    }
    await act(async() => render(<FrameRenderer frame={frame("change_frame_interrupt")} resolver={resolver} />))
    await act(async() => root.unmount())
    expect(interrupted).toBe(true)
    root = createRoot(container)
  })

  it("interrupts pending resolution when the representation revision changes", async() => {
    let interrupted = false
    const pending: FrameRepresentationResolver = {
      resolve: () => Effect.never.pipe(
        Effect.onInterrupt(() => Effect.sync(() => {
          interrupted = true
        }))
      )
    }
    const resolved: FrameRepresentationResolver = {
      resolve: () => Effect.succeed(iframePlan("https://example.com/replacement"))
    }

    await act(async() => render(<FrameRenderer frame={frame("change_frame_pending")} resolver={pending} />))
    await act(async() => render(<FrameRenderer frame={frame("change_frame_replacement")} resolver={resolved} />))
    expect(interrupted).toBe(true)
    await waitFor(() => expect(
      container.querySelector("iframe")?.getAttribute("src")
    ).toBe("https://example.com/replacement"))
  })

  it("renders HTML artifact bytes in a sandboxed iframe", async() => {
    const created: Array<Blob> = []
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn((blob: Blob) => {
        created.push(blob)
        return "blob:html-artifact"
      })
    })
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn()
    })
    const plan = ArtifactBytesRenderPlan.make({
      representation: ArtifactRepresentation.make({
        artifactId: Id.artifact("artifact_react_html"),
        digest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
      }),
      bytes: Uint8Array.from(
        new TextEncoder().encode("\uFEFF \n<HTML><body>Snapshot</body></HTML>")
      )
    })
    const resolver: FrameRepresentationResolver = {
      resolve: () => Effect.succeed(plan)
    }

    await act(async() => render(
      <FrameRenderer
        frame={frame("change_artifact_html", plan.representation)}
        resolver={resolver}
      />
    ))
    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull())

    const iframe = container.querySelector("iframe")
    expect(iframe?.getAttribute("src")).toBe("blob:html-artifact")
    expect(iframe?.getAttribute("sandbox")).toBe("allow-scripts")
    expect(iframe?.getAttribute("title")).toBe("Checkout")
    expect(created[0]?.type).toBe("text/html")
    expect(container.querySelector("a")).toBeNull()
  })

  it("downloads opaque artifact bytes and revokes each object URL once", async() => {
    const created: Array<Blob> = []
    const revoked: Array<string> = []
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn((blob: Blob) => {
        created.push(blob)
        return `blob:artifact-${created.length}`
      })
    })
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn((url: string) => revoked.push(url))
    })
    const artifact = (suffix: string, byte: number) => ArtifactBytesRenderPlan.make({
      representation: ArtifactRepresentation.make({
        artifactId: Id.artifact(`artifact_react_${suffix}`),
        digest: `sha256:${suffix.repeat(64).slice(0, 64)}`
      }),
      bytes: Uint8Array.from([byte, byte + 1])
    })
    let selected = artifact("a", 1)
    const resolver: FrameRepresentationResolver = { resolve: () => Effect.succeed(selected) }

    await act(async() => render(<FrameRenderer frame={frame("change_artifact_a", selected.representation)} resolver={resolver} />))
    await waitFor(() => expect(container.querySelector("a")).not.toBeNull())
    const firstLink = container.querySelector("a")
    expect(firstLink?.getAttribute("href")).toBe("blob:artifact-1")
    expect(firstLink?.getAttribute("download")).toBe("artifact_react_a")
    expect(created[0]?.type).toBe("application/octet-stream")
    expect(created[0]?.size).toBe(2)
    expect(container.querySelector("iframe")).toBeNull()

    selected = artifact("b", 3)
    await act(async() => render(<FrameRenderer frame={frame("change_artifact_b", selected.representation)} resolver={resolver} />))
    await waitFor(() => expect(revoked).toEqual(["blob:artifact-1"]))
    expect(container.querySelector("a")?.getAttribute("href")).toBe("blob:artifact-2")

    await act(async() => root.unmount())
    expect(revoked).toEqual(["blob:artifact-1", "blob:artifact-2"])
    root = createRoot(container)
  })

  it("revokes every StrictMode artifact URL exactly once", async() => {
    const created: Array<string> = []
    const revoked: Array<string> = []
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => {
        const href = `blob:strict-${created.length + 1}`
        created.push(href)
        return href
      })
    })
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn((url: string) => revoked.push(url))
    })
    const plan = ArtifactBytesRenderPlan.make({
      representation: ArtifactRepresentation.make({
        artifactId: Id.artifact("artifact_react_strict"),
        digest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      }),
      bytes: Uint8Array.from([1, 2, 3])
    })
    const resolver: FrameRepresentationResolver = { resolve: () => Effect.succeed(plan) }

    await act(async() => render(<StrictMode>
      <FrameRenderer frame={frame("change_artifact_strict", plan.representation)} resolver={resolver} />
    </StrictMode>))
    await waitFor(() => expect(created.length).toBeGreaterThan(0))
    await act(async() => root.unmount())

    expect(revoked.toSorted()).toEqual(created.toSorted())
    expect(new Set(revoked).size).toBe(revoked.length)
    root = createRoot(container)
  })
})
