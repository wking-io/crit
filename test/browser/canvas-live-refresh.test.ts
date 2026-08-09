import { describe, expect, it } from "vitest"
import { Effect } from "effect"

import {
  canvasLiveRefreshSocketUrl,
  connectCanvasLiveRefresh,
  type CanvasLiveRefreshSocket
} from "../../src/browser/canvas-live-refresh.js"

type Listener = (event: { readonly data?: unknown }) => void

class FakeSocket implements CanvasLiveRefreshSocket {
  readonly sent: Array<string> = []
  closed = false
  private readonly listeners = new Map<string, Array<Listener>>()

  constructor(readonly url: string) {}

  addEventListener(type: string, listener: Listener) {
    const existing = this.listeners.get(type) ?? []
    existing.push(listener)
    this.listeners.set(type, existing)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.emit("close", {})
  }

  emit(type: string, event: { readonly data?: unknown }) {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

const makeSession = () => {
  const counts = { canvas: 0, activity: 0 }
  return {
    counts,
    session: {
      refresh: () =>
        Effect.sync(() => {
          counts.canvas += 1
          return true
        }),
      refreshAgentActivity: () =>
        Effect.sync(() => {
          counts.activity += 1
          return true
        })
    }
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

const pageLocation = { protocol: "http:", hostname: "127.0.0.1", port: "5173" }

describe("connectCanvasLiveRefresh", () => {
  it("resolves the socket URL the way Vite's own client does", () => {
    expect(canvasLiveRefreshSocketUrl({}, pageLocation)).toBe(
      "ws://127.0.0.1:5173/"
    )
    expect(
      canvasLiveRefreshSocketUrl(
        { token: "secret" },
        { protocol: "https:", hostname: "crit.test", port: "" }
      )
    ).toBe("wss://crit.test/?token=secret")
    expect(
      canvasLiveRefreshSocketUrl(
        {
          protocol: "wss",
          host: "hmr.test",
          port: 24678,
          path: "/base/hmr",
          token: "t/1"
        },
        pageLocation
      )
    ).toBe("wss://hmr.test:24678/base/hmr?token=t%2F1")
  })

  it("refreshes the session for this Canvas's hints and ignores everything else", async () => {
    const { counts, session } = makeSession()
    const sockets: Array<FakeSocket> = []
    const dispose = connectCanvasLiveRefresh({
      canvasId: "homepage",
      session,
      endpoint: { token: "secret" },
      location: pageLocation,
      createSocket: (url) => {
        const socket = new FakeSocket(url)
        sockets.push(socket)
        return socket
      }
    })
    const socket = sockets[0]!

    socket.emit("open", {})
    const custom = (event: string, id: string) =>
      socket.emit("message", {
        data: JSON.stringify({ type: "custom", event, data: { id } })
      })
    custom("crit:canvas-changed", "homepage")
    custom("crit:canvas-changed", "other-canvas")
    custom("crit:agent-activity", "homepage")
    custom("crit:agent-activity", "other-canvas")
    custom("crit:unrelated", "homepage")
    socket.emit("message", { data: JSON.stringify({ type: "update" }) })
    socket.emit("message", { data: "not json" })
    socket.emit("message", { data: undefined })
    await settle()
    dispose()

    expect(socket.url).toBe("ws://127.0.0.1:5173/?token=secret")
    expect(counts).toEqual({ canvas: 1, activity: 1 })
    expect(socket.closed).toBe(true)
  })

  it("reconnects after a dropped connection until disposed", async () => {
    const { session } = makeSession()
    const sockets: Array<FakeSocket> = []
    const dispose = connectCanvasLiveRefresh({
      canvasId: "homepage",
      session,
      location: pageLocation,
      reconnectDelayMillis: 1,
      createSocket: (url) => {
        const socket = new FakeSocket(url)
        sockets.push(socket)
        return socket
      }
    })

    sockets[0]!.emit("close", {})
    await settle()
    const reconnected = sockets.length
    dispose()
    await settle()

    expect(reconnected).toBe(2)
    expect(sockets.length).toBe(2)
    expect(sockets[1]!.closed).toBe(true)
  })

  it("keeps the connection alive with Vite-style pings until disposed", async () => {
    const { session } = makeSession()
    const sockets: Array<FakeSocket> = []
    const dispose = connectCanvasLiveRefresh({
      canvasId: "homepage",
      session,
      location: pageLocation,
      heartbeatIntervalMillis: 1,
      createSocket: (url) => {
        const socket = new FakeSocket(url)
        sockets.push(socket)
        return socket
      }
    })
    const socket = sockets[0]!

    socket.emit("open", {})
    await settle()
    dispose()
    const pings = socket.sent.length
    await settle()

    expect(pings).toBeGreaterThan(0)
    expect(socket.sent[0]).toBe(JSON.stringify({ type: "ping" }))
    expect(socket.sent.length).toBe(pings)
  })

  it("stays offline when the endpoint is disabled", () => {
    const { session } = makeSession()
    let created = 0
    const dispose = connectCanvasLiveRefresh({
      canvasId: "homepage",
      session,
      endpoint: { enabled: false },
      location: pageLocation,
      createSocket: (url) => {
        created += 1
        return new FakeSocket(url)
      }
    })
    dispose()

    expect(created).toBe(0)
  })
})
