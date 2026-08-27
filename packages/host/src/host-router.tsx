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

import type { HostRuntime } from "./host-connection.js"
import { parseHostCanvasId } from "./host-canvas-id.js"
import { HostIndexView, HostScreenView } from "./host-views.js"

export type HostRouterContext = {
  readonly runtime: HostRuntime
}

const rootRoute = createRootRouteWithContext<HostRouterContext>()({
  component: () => <Outlet />
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: function HostIndexPage(): ReactElement {
    const { runtime } = useRouter().options.context
    return <HostIndexView runtime={runtime} />
  }
})

const canvasRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/canvas/$canvasId",
  component: function HostCanvasPage(): ReactElement {
    const { runtime } = useRouter().options.context
    return Result.match(parseHostCanvasId(canvasRoute.useParams().canvasId), {
      onFailure: () => <p role="alert">That is not a Canvas ID.</p>,
      onSuccess: (canvasId) => (
        <HostScreenView canvasId={canvasId} runtime={runtime} />
      )
    })
  }
})

export const hostRouteTree = rootRoute.addChildren([indexRoute, canvasRoute])

export const createHostRouter = (options: {
  readonly runtime: HostRuntime
  readonly history?: RouterHistory | undefined
}) =>
  createRouter({
    routeTree: hostRouteTree,
    context: {
      runtime: options.runtime
    },
    defaultNotFoundComponent: () => <p role="alert">That page does not exist.</p>,
    history: options.history ?? createBrowserHistory(),
    scrollRestoration: () => false
  })

export function HostRouter({ history, runtime }: {
  readonly history?: RouterHistory | undefined
  readonly runtime: HostRuntime
}): ReactElement {
  const [router] = useState(() => createHostRouter({ history, runtime }))
  return <RouterProvider router={router} />
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createHostRouter>
  }
}
