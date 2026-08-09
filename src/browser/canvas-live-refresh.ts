import { Effect } from "effect"

import type { CanvasSession } from "../session/canvas-session.js"

/**
 * Where the Vite dev server's HMR WebSocket endpoint lives, as resolved by the
 * Crit Vite plugin from the dev server's own configuration. Every field is
 * optional; missing pieces fall back to the page's location, mirroring how
 * Vite's own client resolves its socket URL.
 */
export interface CanvasLiveRefreshEndpoint {
  readonly enabled?: boolean
  readonly protocol?: string
  readonly host?: string
  readonly port?: number | string
  readonly path?: string
  /**
   * Vite rejects browser WebSocket connections (requests carrying an Origin
   * header) without its per-server token. The token is embedded in every
   * script Vite serves, so sharing it with the served editor grants nothing
   * new.
   */
  readonly token?: string
}

/** The subset of the page location needed to resolve the socket URL. */
export interface CanvasLiveRefreshLocation {
  readonly protocol: string
  readonly hostname: string
  readonly port: string
}

/** The subset of a WebSocket the live-refresh channel relies on. */
export interface CanvasLiveRefreshSocket {
  addEventListener(
    type: "open" | "message" | "close" | "error",
    listener: (event: { readonly data?: unknown }) => void
  ): void
  send(data: string): void
  close(): void
}

export interface CanvasLiveRefreshOptions {
  readonly canvasId: string
  readonly session: Pick<CanvasSession, "refresh" | "refreshAgentActivity">
  readonly endpoint?: CanvasLiveRefreshEndpoint
  readonly location?: CanvasLiveRefreshLocation
  readonly createSocket?: (url: string) => CanvasLiveRefreshSocket
  readonly reconnectDelayMillis?: number
  readonly heartbeatIntervalMillis?: number
}

export const canvasLiveRefreshSocketUrl = (
  endpoint: CanvasLiveRefreshEndpoint,
  location: CanvasLiveRefreshLocation
) => {
  const protocol =
    endpoint.protocol ?? (location.protocol === "https:" ? "wss" : "ws")
  const hostname = endpoint.host ?? location.hostname
  const port = endpoint.port === undefined || endpoint.port === ""
    ? location.port
    : String(endpoint.port)
  const rawPath = endpoint.path ?? "/"
  const path = rawPath.startsWith("/") ? rawPath : `/${rawPath}`
  const query =
    endpoint.token === undefined
      ? ""
      : `?token=${encodeURIComponent(endpoint.token)}`
  return `${protocol}://${hostname}${port === "" ? "" : `:${port}`}${path}${query}`
}

/**
 * Subscribes a Canvas Session to the live refresh hint channel over the Vite
 * dev server's HMR WebSocket, for pages whose scripts are not served through
 * Vite's module graph and therefore have no `import.meta.hot` — most notably
 * the served `/crit/:canvasId` editor. Change hints are an optimization; the
 * session's poll remains the fallback, so socket failures are silent and
 * reconnection is patient. Returns a dispose function.
 */
export const connectCanvasLiveRefresh = (
  options: CanvasLiveRefreshOptions
): (() => void) => {
  const endpoint = options.endpoint ?? {}
  const location =
    options.location ??
    (globalThis.location as CanvasLiveRefreshLocation | undefined)
  if (endpoint.enabled === false || location === undefined) return () => {}

  const url = canvasLiveRefreshSocketUrl(endpoint, location)
  const createSocket =
    options.createSocket ??
    ((target: string) => new WebSocket(target, "vite-hmr"))
  const reconnectDelay = options.reconnectDelayMillis ?? 1_000
  const heartbeatInterval = options.heartbeatIntervalMillis ?? 30_000

  let disposed = false
  let socket: CanvasLiveRefreshSocket | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let reconnect: ReturnType<typeof setTimeout> | undefined

  const stopHeartbeat = () => {
    if (heartbeat !== undefined) clearInterval(heartbeat)
    heartbeat = undefined
  }

  const deliver = (event: { readonly data?: unknown }) => {
    if (typeof event.data !== "string") return
    let payload: {
      readonly type?: string
      readonly event?: string
      readonly data?: { readonly id?: string }
    }
    try {
      payload = JSON.parse(event.data) as typeof payload
    } catch {
      return
    }
    if (payload.type !== "custom" || payload.data?.id !== options.canvasId) {
      return
    }
    if (payload.event === "crit:canvas-changed") {
      Effect.runFork(
        options.session.refresh().pipe(Effect.catch(() => Effect.void))
      )
    } else if (payload.event === "crit:agent-activity") {
      Effect.runFork(
        options.session.refreshAgentActivity().pipe(
          Effect.catch(() => Effect.void)
        )
      )
    }
  }

  const open = () => {
    const active = createSocket(url)
    socket = active
    active.addEventListener("open", () => {
      if (disposed) return
      stopHeartbeat()
      heartbeat = setInterval(
        () => active.send(JSON.stringify({ type: "ping" })),
        heartbeatInterval
      )
    })
    active.addEventListener("message", deliver)
    active.addEventListener("error", () => {})
    active.addEventListener("close", () => {
      stopHeartbeat()
      if (disposed) return
      reconnect = setTimeout(open, reconnectDelay)
    })
  }
  open()

  return () => {
    disposed = true
    stopHeartbeat()
    if (reconnect !== undefined) clearTimeout(reconnect)
    socket?.close()
  }
}
