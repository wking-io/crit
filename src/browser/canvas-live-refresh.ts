import { Effect, Option, Schema } from "effect"

import type { CanvasSession } from "../session/canvas-session.js"

/** The Vite dev server has no live-refresh channel for this page. */
export interface DisabledCanvasLiveRefreshEndpoint {
  readonly enabled: false
}

/**
 * Where the editor reaches Vite's HMR WebSocket. A null authority component
 * explicitly inherits from the page location; unlike undefined, that intent
 * survives the JSON handoff from the Vite plugin to the browser.
 */
export interface EnabledCanvasLiveRefreshEndpoint {
  readonly enabled: true
  readonly protocol: string | null
  readonly host: string | null
  readonly port: number | null
  readonly path: string
  /**
   * Vite rejects browser WebSocket connections (requests carrying an Origin
   * header) without its per-server token. The token is embedded in every
   * script Vite serves, so sharing it with the served editor grants nothing
   * new.
   */
  readonly token: string
}

export type CanvasLiveRefreshEndpoint =
  | DisabledCanvasLiveRefreshEndpoint
  | EnabledCanvasLiveRefreshEndpoint

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
  readonly session: Pick<CanvasSession, "refresh" | "refreshPresence">
  readonly endpoint: CanvasLiveRefreshEndpoint
  readonly location?: CanvasLiveRefreshLocation
  readonly createSocket?: (url: string) => CanvasLiveRefreshSocket
  readonly reconnectDelayMillis?: number
  readonly heartbeatIntervalMillis?: number
}

const CanvasLiveRefreshPayload = Schema.Struct({
  type: Schema.optionalKey(Schema.String),
  event: Schema.optionalKey(Schema.String),
  data: Schema.optionalKey(Schema.Struct({
    id: Schema.optionalKey(Schema.String)
  }))
})
const decodeCanvasLiveRefreshPayload = Schema.decodeUnknownOption(
  Schema.fromJsonString(CanvasLiveRefreshPayload)
)

export const canvasLiveRefreshSocketUrl = (
  endpoint: EnabledCanvasLiveRefreshEndpoint,
  location: CanvasLiveRefreshLocation
) => {
  const protocol =
    endpoint.protocol ?? (location.protocol === "https:" ? "wss" : "ws")
  const hostname = endpoint.host ?? location.hostname
  const port = endpoint.port === null
    ? location.port
    : String(endpoint.port)
  const rawPath = endpoint.path
  const path = rawPath.startsWith("/") ? rawPath : `/${rawPath}`
  const query = `?token=${encodeURIComponent(endpoint.token)}`
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
  const endpoint = options.endpoint
  const location =
    options.location ??
    globalThis.location
  if (!endpoint.enabled || location === undefined) return () => {}

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
    const decoded = decodeCanvasLiveRefreshPayload(event.data)
    if (Option.isNone(decoded)) return
    const payload = decoded.value
    if (payload.type !== "custom" || payload.data?.id !== options.canvasId) {
      return
    }
    if (payload.event === "crit:canvas-changed") {
      Effect.runFork(
        options.session.refresh().pipe(Effect.catch(() => Effect.void))
      )
    } else if (payload.event === "crit:agent-activity") {
      Effect.runFork(
        options.session.refreshPresence().pipe(
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
