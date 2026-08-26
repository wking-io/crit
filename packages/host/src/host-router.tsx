import { Result } from "effect"
import { useState, type ReactElement } from "react"
import {
  Outlet,
  RouterProvider,
  createBrowserHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  useRouter,
  type RouterHistory
} from "@tanstack/react-router"

import { parseHostCanvasId } from "./host-canvas-id.js"
import { HostIndexView, HostScreenView } from "./host-views.js"

export type HostRouterContext = {
  readonly fragment: string
}

const rootRoute = createRootRouteWithContext<HostRouterContext>()({
  component: () => <Outlet />
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: function HostIndexPage(): ReactElement {
    const { fragment } = useRouter().options.context
    return <HostIndexView fragment={fragment} />
  }
})

const canvasRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/canvas/$canvasId",
  component: function HostCanvasPage(): ReactElement {
    const { fragment } = useRouter().options.context
    return Result.match(parseHostCanvasId(canvasRoute.useParams().canvasId), {
      onFailure: () => <p role="alert">That is not a Canvas ID.</p>,
      onSuccess: (canvasId) => <HostScreenView canvasId={canvasId} fragment={fragment} />
    })
  }
})

export const hostRouteTree = rootRoute.addChildren([indexRoute, canvasRoute])

export const createHostRouter = (options: {
  readonly fragment: string
  readonly history?: RouterHistory | undefined
}) =>
  createRouter({
    routeTree: hostRouteTree,
    context: { fragment: options.fragment },
    defaultNotFoundComponent: () => <p role="alert">That page does not exist.</p>,
    history: options.history ?? createBrowserHistory(),
    scrollRestoration: () => false
  })

export function HostRouter({ fragment, history }: {
  readonly fragment: string
  readonly history?: RouterHistory | undefined
}): ReactElement {
  const [router] = useState(() => createHostRouter({ fragment, history }))
  return <RouterProvider router={router} />
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createHostRouter>
  }
}
