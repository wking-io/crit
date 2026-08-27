import type { FrameBridgeOrigin } from "@crit/protocol"
import { Option, Schema } from "effect"
import type { Plugin, ViteDevServer } from "vite"

import {
  announceLocalApplication,
  applicationOriginFromHref,
  critApplicationIdentityPath,
  readLocalDaemonAnnounceTarget,
  readProjectApplicationId
} from "./announce.js"
import { renderFrameAncestorsResponseHeaders } from "./headers.js"
import {
  FRAME_ROUTE_BRIDGE_HTML_MARKER,
  critFrameRouteBridgeScript
} from "./route.js"

const ListeningAddress = Schema.Struct({
  address: Schema.String,
  port: Schema.Number
})

const identityRequestPath = (url: string | undefined): string => {
  if (url === undefined) return ""
  const start = url.startsWith("http://") || url.startsWith("https://")
    ? new URL(url).pathname
    : url.split("?")[0] ?? ""
  return start
}

const applicationOriginFromServer = (server: ViteDevServer): string | undefined => {
  const locals = server.resolvedUrls?.local ?? []
  const preferred = locals.find((href) => {
    try {
      return new URL(href).hostname === "127.0.0.1"
    } catch {
      return false
    }
  }) ?? locals[0]
  if (preferred !== undefined) {
    return applicationOriginFromHref(preferred)
  }
  const address = Schema.decodeUnknownOption(ListeningAddress)(server.httpServer?.address())
  if (Option.isNone(address)) return undefined
  const host = address.value.address === "::" || address.value.address === "0.0.0.0"
    ? "127.0.0.1"
    : address.value.address
  return applicationOriginFromHref(`http://${host}:${address.value.port}/`)
}

export const frameRouteBridgeVitePlugin = (input: {
  readonly parentOrigin: FrameBridgeOrigin
}): Plugin => ({
  name: "crit-frame-route-bridge",
  transformIndexHtml(html) {
    if (html.includes(FRAME_ROUTE_BRIDGE_HTML_MARKER)) return
    return [{
      tag: "script",
      attrs: { [FRAME_ROUTE_BRIDGE_HTML_MARKER]: "" },
      children: critFrameRouteBridgeScript(input),
      injectTo: "head-prepend"
    }]
  },
  configureServer(server) {
    const applicationId = readProjectApplicationId(server.config.root)
    if (applicationId !== undefined) {
      server.middlewares.use((request, response, next) => {
        if (identityRequestPath(request.url) !== critApplicationIdentityPath) {
          next()
          return
        }
        if (request.method !== "GET" && request.method !== "HEAD") {
          next()
          return
        }
        response.setHeader("content-type", "application/json")
        response.end(JSON.stringify({ applicationId }))
      })
    }
    let announced = false
    const announce = () => {
      if (announced || applicationId === undefined) return
      const origin = applicationOriginFromServer(server)
      const descriptor = readLocalDaemonAnnounceTarget(server.config.root)
        ?? readLocalDaemonAnnounceTarget(process.cwd())
      if (origin === undefined || descriptor === undefined) return
      announced = true
      void announceLocalApplication({
        applicationId,
        origin,
        instance: descriptor.instance,
        daemonBaseUrl: descriptor.baseUrl
      })
    }
    const listen = () => {
      server.httpServer?.once("listening", announce)
      if (server.httpServer?.listening) announce()
    }
    listen()
    return listen
  }
})

export const frameAncestorsPreviewVitePlugin = (input: {
  readonly parentOrigin: FrameBridgeOrigin
}): Plugin => ({
  name: "crit-frame-ancestors-preview",
  configurePreviewServer(server) {
    const headers = renderFrameAncestorsResponseHeaders(input)
    server.middlewares.use((_request, response, next) => {
      response.setHeader(
        "content-security-policy",
        headers["content-security-policy"]
      )
      next()
    })
  }
})
