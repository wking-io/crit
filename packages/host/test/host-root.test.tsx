import { LocalBrowserConnection } from "@crit/client"
import { LocalDaemonInstanceNonce } from "@crit/replica/http"
import { createMemoryHistory } from "@tanstack/react-router"
import { Schema } from "effect"
import { StrictMode, act, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { HostRoot } from "../src/index.js"

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true })

const instance = Schema.decodeUnknownSync(LocalDaemonInstanceNonce)(
  "0123456789abcdef0123456789abcdef"
)

let container: HTMLDivElement
let root: Root

const render = (element: ReactElement) => root.render(<StrictMode>{element}</StrictMode>)

const hostAt = (path: string, fragment: string) => (
  <HostRoot
    fragment={fragment}
    history={createMemoryHistory({ initialEntries: [path] })}
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
})
