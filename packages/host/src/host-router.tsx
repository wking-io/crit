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
  readonly origin: string
}

const rootRoute = createRootRouteWithContext<HostRouterContext>()({
  component: () => <Outlet />
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: function HostIndexPage(): ReactElement {
    const { fragment, origin } = useRouter().options.context
    return <HostIndexView fragment={fragment} origin={origin} />
  }
})

const canvasRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/canvas/$canvasId",
  component: function HostCanvasPage(): ReactElement {
    const { fragment, origin } = useRouter().options.context
    return Result.match(parseHostCanvasId(canvasRoute.useParams().canvasId), {
      onFailure: () => <p role="alert">That is not a Canvas ID.</p>,
      onSuccess: (canvasId) => (
        <HostScreenView canvasId={canvasId} fragment={fragment} origin={origin} />
      )
    })
  }
})

export const hostRouteTree = rootRoute.addChildren([indexRoute, canvasRoute])

export const createHostRouter = (options: {
  readonly fragment: string
  readonly origin: string
  readonly history?: RouterHistory | undefined
}) =>
  createRouter({
    routeTree: hostRouteTree,
    context: {
      fragment: options.fragment,
      origin: options.origin
    },
    defaultNotFoundComponent: () => <p role="alert">That page does not exist.</p>,
    history: options.history ?? createBrowserHistory(),
    scrollRestoration: () => false
  })

export function HostRouter({ fragment, history, origin }: {
  readonly fragment: string
  readonly history?: RouterHistory | undefined
  readonly origin: string
}): ReactElement {
  const [router] = useState(() => createHostRouter({ fragment, history, origin }))
  return <RouterProvider router={router} />
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createHostRouter>
  }
}
