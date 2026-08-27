import { createMemoryHistory } from "@tanstack/react-router"
import { StrictMode, act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { HostRoot, resolveHostRuntime } from "../src/index.js"

const fetchMock = vi.hoisted(() => {
  const mock = vi.fn<typeof globalThis.fetch>()
  vi.stubGlobal("fetch", mock)
  return mock
})

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true })

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async() => {
  await act(async() => root.unmount())
  container.remove()
  fetchMock.mockReset()
})

describe("HostRoot hosted Access", () => {
  it("shows the Access denial when the hosted directory returns 401", async() => {
    fetchMock.mockImplementation(async() => new Response(null, { status: 401 }))

    await act(async() => root.render(
      <StrictMode>
        <HostRoot
          history={createMemoryHistory({ initialEntries: ["/"] })}
          runtime={resolveHostRuntime({
            fragment: "",
            injected: undefined,
            origin: "https://crit.example"
          })}
        />
      </StrictMode>
    ))

    await act(async() => vi.waitFor(() => {
      expect(container.querySelector("[role='alert']")?.textContent).toBe(
        "Crit Access denied this browser session."
      )
    }))
  })
})
