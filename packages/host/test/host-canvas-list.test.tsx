import { CanvasTitle, Id } from "@crit/domain"
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
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { HostCanvasList } from "../src/index.js"

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true })

const title = Schema.decodeUnknownSync(CanvasTitle)("Shop")
const fragment = "#crit=session"

let container: HTMLDivElement
let root: Root

const renderList = (listings: Parameters<typeof HostCanvasList>[0]["listings"]) => {
  const rootRoute = createRootRoute({
    component: () => <HostCanvasList fragment={fragment} listings={listings} />
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
  return { element: <RouterProvider router={router} />, router }
}

const render = (element: ReactElement) => root.render(<StrictMode>{element}</StrictMode>)

beforeEach(() => {
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async() => {
  await act(async() => root.unmount())
  container.remove()
})

describe("HostCanvasList", () => {
  it("shows the empty copy when no canvases exist", async() => {
    await act(async() => render(renderList([]).element))
    expect(container.textContent).toBe("No canvases yet.")
    expect(container.querySelector("a")).toBeNull()
  })

  it("links each canvas to its route and keeps the session hash", async() => {
    const { element, router } = renderList([{ canvasId: Id.canvas("canvas_shop"), title }])
    await act(async() => render(element))
    const link = container.querySelector("a")
    expect(link?.textContent).toBe("Shop")
    expect(link?.getAttribute("href")).toBe("/canvas/canvas_shop#crit=session")
    await act(async() => {
      link?.click()
    })
    expect(router.state.location.pathname).toBe("/canvas/canvas_shop")
    expect(router.state.location.hash).toBe("crit=session")
  })
})
