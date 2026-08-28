import { IntegratedConnectionDocument, LocalBrowserConnection } from "@crit/client"
import { LocalDaemonInstanceNonce } from "@crit/replica/http"
import { createMemoryHistory } from "@tanstack/react-router"
import { Schema } from "effect"
import { StrictMode, act, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { HostRoot, resolveHostRuntime } from "../src/index.js"

const fetchMock = vi.hoisted(() => {
  const mock = vi.fn<typeof globalThis.fetch>()
  vi.stubGlobal("fetch", mock)
  return mock
})

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true })

const instance = Schema.decodeUnknownSync(LocalDaemonInstanceNonce)(
  "0123456789abcdef0123456789abcdef"
)

let container: HTMLDivElement
let root: Root

const render = (element: ReactElement) => root.render(<StrictMode>{element}</StrictMode>)

const fetched = (url: string): boolean => fetchMock.mock.calls.some(
  ([input, init]) => String(input) === url && init?.method === "GET"
)

const hostAt = (
  path: string,
  fragment: string,
  origin = "http://127.0.0.1:5173",
  injected?: IntegratedConnectionDocument
) => (
  <HostRoot
    history={createMemoryHistory({ initialEntries: [path] })}
    runtime={resolveHostRuntime({ fragment, injected, origin })}
  />
)

beforeEach(() => {
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async() => {
  await act(async() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  fetchMock.mockReset()
})

describe("HostRoot", () => {
  it("renders the failure copy for an invalid fragment", async() => {
    await act(async() => render(hostAt("/", "#crit=")))
    expect(container.querySelector("[role='alert']")?.textContent).toBe(
      "Unable to connect to Crit."
    )
  })

  it("renders the same invalid-fragment copy after a remount", async() => {
    await act(async() => render(hostAt("/", "#crit=")))
    await act(async() => root.unmount())
    container.remove()
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async() => render(hostAt("/", "#crit=")))
    expect(container.querySelector("[role='alert']")?.textContent).toBe(
      "Unable to connect to Crit."
    )
  })

  it("renders a not-found alert for an unknown path", async() => {
    await act(async() => render(hostAt("/nope", "#crit=")))
    expect(container.querySelector("[role='alert']")?.textContent).toBe(
      "That page does not exist."
    )
  })

  it("renders a distinct alert for an invalid canvas route", async() => {
    await act(async() => render(hostAt("/canvas/shop", "#crit=")))
    expect(container.querySelector("[role='alert']")?.textContent).toBe(
      "That is not a Canvas ID."
    )
    expect(container.textContent).not.toContain("Unable to connect to Crit.")
  })

  it("builds clients from a valid fragment and reports an unreachable daemon", async() => {
    const descriptor = LocalBrowserConnection.make({
      baseUrl: "http://127.0.0.1:49152",
      instance
    })

    await act(async() => render(
      hostAt("/", LocalBrowserConnection.encode(descriptor))
    ))

    await act(async() => vi.waitFor(
      () =>
        expect(container.querySelector("[role='alert']")?.textContent).toBe(
          "The local daemon is unreachable."
        ),
      { timeout: 10_000 }
    ))
  }, 15_000)

  it("opens a named canvas from its route and still reports an unreachable daemon", async() => {
    const descriptor = LocalBrowserConnection.make({
      baseUrl: "http://127.0.0.1:49152",
      instance
    })

    await act(async() => render(
      hostAt("/canvas/canvas_shop", LocalBrowserConnection.encode(descriptor))
    ))

    await act(async() => vi.waitFor(
      () =>
        expect(container.querySelector("[role='alert']")?.textContent).toBe(
          "The local daemon is unreachable."
        ),
      { timeout: 10_000 }
    ))
  }, 15_000)

  it("lists local canvases after a successful list", async() => {
    const descriptor = LocalBrowserConnection.make({
      baseUrl: "http://127.0.0.1:5173",
      instance
    })
    let release!: (response: Response) => void
    const listed = new Promise<Response>((resolve) => {
      release = resolve
    })
    fetchMock.mockImplementation(() => listed)

    await act(async() => render(
      hostAt("/", LocalBrowserConnection.encode(descriptor))
    ))
    expect(container.querySelector("[role='status']")?.textContent).toBe(
      "Connecting to Crit…"
    )

    await act(async() => {
      release(new Response(JSON.stringify([{
        canvasId: "canvas_launch_lab",
        title: "Launch lab"
      }]), {
        status: 200,
        headers: { "content-type": "application/json" }
      }))
    })

    await act(async() => vi.waitFor(() => {
      expect(container.querySelector("a")?.textContent).toBe("Launch lab")
    }))
    expect(container.querySelector("[role='status']")).toBeNull()
    expect(fetched(
      `http://127.0.0.1:5173/browser/${instance}/api/v1/canvas`
    )).toBe(true)
  })

  it("lists canvases through the integrated same-origin prefix", async() => {
    let release!: (response: Response) => void
    const listed = new Promise<Response>((resolve) => {
      release = resolve
    })
    fetchMock.mockImplementation(() => listed)

    await act(async() => render(
      hostAt("/", "", "http://127.0.0.1:5173", Schema.decodeUnknownSync(
        IntegratedConnectionDocument
      )({
        kind: "integrated",
        apiBase: "/__crit/"
      }))
    ))

    await act(async() => {
      release(new Response(JSON.stringify([{
        canvasId: "canvas_launch_lab",
        title: "Launch lab"
      }]), {
        status: 200,
        headers: { "content-type": "application/json" }
      }))
    })

    await act(async() => vi.waitFor(() => {
      expect(container.querySelector("a")?.textContent).toBe("Launch lab")
      expect(container.querySelector("a")?.getAttribute("href")).toBe(
        "/canvas/canvas_launch_lab"
      )
    }))
    expect(fetched("http://127.0.0.1:5173/__crit/api/v1/canvas")).toBe(true)
  })

  it("lists hosted canvases from the same-origin directory", async() => {
    fetchMock.mockImplementation(async() => new Response(JSON.stringify({
      kind: "canvas-directory",
      schemaVersion: 1,
      canvases: [{
        canvasId: "canvas_hosted",
        workspaceId: "workspace_default",
        title: "Hosted review"
      }]
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    }))
    await act(async() => render(hostAt("/", "", "https://crit.example")))

    await act(async() => vi.waitFor(() => {
      expect(container.querySelector("a")?.textContent).toBe("Hosted review")
    }))
    expect(fetched("http://localhost:3000/canvas")).toBe(true)
  })

  it("builds hosted canvas ports without a local capability", async() => {
    fetchMock.mockImplementation(async(input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname === "/identity") {
        return new Response(JSON.stringify({
          kind: "access-authenticated-person",
          schemaVersion: 1,
          address: "ada@acme.com"
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      }
      return new Response(JSON.stringify({
        _tag: "canvasNotFound",
        canvasId: "canvas_shop"
      }), {
        status: 404,
        headers: { "content-type": "application/json" }
      })
    })
    await act(async() => render(hostAt(
      "/canvas/canvas_shop",
      "",
      "https://crit.example"
    )))

    await act(async() => vi.waitFor(() => {
      expect(fetched("http://localhost:3000/identity")).toBe(true)
      expect(fetched("http://localhost:3000/canvas/canvas_shop")).toBe(true)
    }, { timeout: 10_000 }))
  })
})
