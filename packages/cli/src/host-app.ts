import { existsSync } from "node:fs"
import http from "node:http"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { Duplex } from "node:stream"
import { fileURLToPath } from "node:url"
import path from "node:path"

import { hostTokenHeader, type IntegratedHostPlane } from "@crit/local"
import { Effect, Redacted, Schema, Scope } from "effect"
import { createServer, type Plugin, type ViteDevServer } from "vite"

export const HOST_PORT = 5173
export const HOST_ORIGIN = `http://127.0.0.1:${HOST_PORT}`

export class HostAppFailure extends Schema.TaggedError<HostAppFailure>()(
  "HostAppFailure",
  { message: Schema.String }
) {}

export const resolveHostRoot = (
  from = fileURLToPath(new URL("../../host", import.meta.url))
): string | undefined => existsSync(path.join(from, "vite.config.ts")) ? from : undefined

const rewriteCritPath = (url: string, instance: string) => {
  const parsed = new URL(url, HOST_ORIGIN)
  const rest = parsed.pathname.startsWith("/__crit/")
    ? parsed.pathname.slice("/__crit/".length)
    : ""
  return `/browser/${instance}/${rest}${parsed.search}`
}

const hopByHop = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade"
])

const daemonHeaders = (request: IncomingMessage, plane: IntegratedHostPlane) => {
  const headers: http.OutgoingHttpHeaders = {}
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue
    const name = key.toLowerCase()
    if (name === hostTokenHeader || hopByHop.has(name)) continue
    headers[key] = value
  }
  const daemon = new URL(plane.daemonOrigin)
  headers.host = daemon.host
  if (headers.origin === undefined) headers.origin = plane.hostOrigin
  headers[hostTokenHeader] = Redacted.value(plane.hostToken)
  return { headers, daemon }
}

const proxyHttp = (
  request: IncomingMessage,
  response: ServerResponse,
  plane: IntegratedHostPlane
) => {
  const { headers, daemon } = daemonHeaders(request, plane)
  const upstream = http.request({
    hostname: daemon.hostname,
    port: daemon.port,
    path: rewriteCritPath(request.url ?? "/", plane.instance),
    method: request.method,
    headers
  }, (proxied) => {
    response.writeHead(proxied.statusCode ?? 502, proxied.headers)
    proxied.pipe(response)
  })
  upstream.on("error", () => {
    if (!response.headersSent) response.writeHead(502)
    response.end()
  })
  request.pipe(upstream)
}

const proxyUpgrade = (
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  plane: IntegratedHostPlane
) => {
  const { headers, daemon } = daemonHeaders(request, plane)
  headers.connection = "upgrade"
  headers.upgrade = "websocket"
  const upstream = http.request({
    hostname: daemon.hostname,
    port: daemon.port,
    path: rewriteCritPath(request.url ?? "/", plane.instance),
    method: "GET",
    headers
  })
  upstream.on("upgrade", (proxied, proxiedSocket, proxiedHead) => {
    const lines = [`HTTP/1.1 ${proxied.statusCode} ${proxied.statusMessage}`]
    for (const [key, value] of Object.entries(proxied.headers)) {
      if (value === undefined) continue
      if (Array.isArray(value)) {
        for (const item of value) lines.push(`${key}: ${item}`)
      } else {
        lines.push(`${key}: ${value}`)
      }
    }
    socket.write(`${lines.join("\r\n")}\r\n\r\n`)
    if (proxiedHead.length > 0) socket.write(proxiedHead)
    if (head.length > 0) proxiedSocket.write(head)
    proxiedSocket.pipe(socket)
    socket.pipe(proxiedSocket)
  })
  upstream.on("error", () => {
    socket.destroy()
  })
  upstream.end()
}

export const integratedHostPlugin = (plane: IntegratedHostPlane): Plugin => ({
  name: "crit-integrated-host",
  transformIndexHtml(html) {
    const document = JSON.stringify({ kind: "integrated", apiBase: "/__crit/" })
    return html.replace(
      "<head>",
      `<head><script type="application/json" id="crit-host-runtime">${document}</script>`
    )
  },
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const url = request.url ?? ""
      if (
        request.method === "GET" &&
        (url === "/__crit/connection" || url.startsWith("/__crit/connection?"))
      ) {
        response.statusCode = 200
        response.setHeader("content-type", "application/json")
        response.setHeader("cache-control", "no-store")
        response.end(JSON.stringify({ kind: "integrated", apiBase: "/__crit/" }))
        return
      }
      if (url === "/__crit" || url.startsWith("/__crit/")) {
        proxyHttp(request, response, plane)
        return
      }
      next()
    })
    server.httpServer?.on("upgrade", (request, socket, head) => {
      const url = request.url ?? ""
      if (url === "/__crit" || url.startsWith("/__crit/")) {
        proxyUpgrade(request, socket, head, plane)
      }
    })
  }
})

export const startIntegratedHost = (
  plane: IntegratedHostPlane
): Effect.Effect<ViteDevServer, HostAppFailure, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.tryPromise({
      try: async() => {
        const root = resolveHostRoot()
        if (root === undefined) {
          throw new HostAppFailure({ message: "Unable to find the Crit browser application" })
        }
        const server = await createServer({
          configFile: path.join(root, "vite.config.ts"),
          root,
          plugins: [integratedHostPlugin(plane)],
          server: {
            host: "127.0.0.1",
            port: HOST_PORT,
            strictPort: true
          }
        })
        await server.listen()
        return server
      },
      catch: (cause) => new HostAppFailure({
        message: cause instanceof Error
          ? cause.message
          : "Unable to start the Crit browser application"
      })
    }),
    (server: ViteDevServer) => Effect.promise(() => server.close())
  )
