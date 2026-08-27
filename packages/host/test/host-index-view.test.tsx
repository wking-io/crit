import { RegistryProvider } from "@effect/atom-react"
import { LocalBrowserConnection } from "@crit/client"
import { LocalDaemonInstanceNonce } from "@crit/replica/http"
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider
} from "@tanstack/react-router"
import { Schema } from "effect"
import { StrictMode, act, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { HostIndexView } from "../src/host-views.js"

const fetchMock = vi.hoisted(() => {
  const mock = vi.fn<typeof globalThis.fetch>()
  vi.stubGlobal("fetch", mock)
  return mock
})

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true })

const instance = Schema.decodeUnknownSync(LocalDaemonInstanceNonce)(
  "0123456789abcdef0123456789abcdef"
)
const localOrigin = "http://127.0.0.1:5173"

const listedResponse = () => new Response(JSON.stringify([{
  canvasId: "canvas_launch_lab",
  title: "Launch lab"
}]), {
  status: 200,
  headers: { "content-type": "application/json" }
})

const holdRegistryTasks = () => {
  const tasks: Array<() => void> = []
  return {
    scheduleTask: (task: () => void) => {
      tasks.push(task)
      return () => {
        const index = tasks.indexOf(task)
        if (index !== -1) tasks.splice(index, 1)
      }
    },
    pending: () => tasks.length
  }
}

const scheduleOnMicrotask = (task: () => void) => {
  let cancelled = false
  queueMicrotask(() => {
    if (!cancelled) task()
  })
  return () => {
    cancelled = true
  }
}

let container: HTMLDivElement
let root: Root

const render = (element: ReactElement) => root.render(<StrictMode>{element}</StrictMode>)

const indexAt = (
  fragment: string,
  scheduleTask: (task: () => void) => () => void
) => {
  const rootRoute = createRootRoute({
    component: () => (
      <RegistryProvider scheduleTask={scheduleTask}>
        <HostIndexView fragment={fragment} origin={localOrigin} />
      </RegistryProvider>
    )
  })
  const canvasRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/canvas/$canvasId"
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([canvasRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
    scrollRestoration: () => false
  })
  return <RouterProvider router={router} />
}

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

describe("HostIndexView registry scheduler", () => {
  it("stays connecting when scheduled registry work never runs after list success", async() => {
    const descriptor = LocalBrowserConnection.make({
      baseUrl: "http://127.0.0.1:5173",
      instance
    })
    let release!: (response: Response) => void
    const listed = new Promise<Response>((resolve) => {
      release = resolve
    })
    fetchMock.mockImplementation(() => listed)
    const held = holdRegistryTasks()

    await act(async() => render(
      indexAt(LocalBrowserConnection.encode(descriptor), held.scheduleTask)
    ))
    expect(container.querySelector("[role='status']")?.textContent).toBe(
      "Connecting to Crit…"
    )

    release(listedResponse())
    await listed
    await Promise.resolve()
    await Promise.resolve()

    expect(fetchMock).toHaveBeenCalled()
    expect(held.pending()).toBeGreaterThan(0)
    expect(container.querySelector("[role='status']")?.textContent).toBe(
      "Connecting to Crit…"
    )
    expect(container.querySelector("a")).toBeNull()
  })

  it("shows the canvas list when registry work runs on microtasks", async() => {
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
      indexAt(LocalBrowserConnection.encode(descriptor), scheduleOnMicrotask)
    ))
    expect(container.querySelector("[role='status']")?.textContent).toBe(
      "Connecting to Crit…"
    )

    await act(async() => {
      release(listedResponse())
    })

    await act(async() => vi.waitFor(() => {
      expect(container.querySelector("a")?.textContent).toBe("Launch lab")
    }))
    expect(container.querySelector("[role='status']")).toBeNull()
  })
})
