import { defineConfig } from "vite"
import { fileURLToPath } from "node:url"
import { relative as pathRelative } from "node:path"
import { build } from "esbuild"
import type { Plugin } from "vite"

import { crit } from "../src/vite/index.js"
import { critFrameInputBridgeScript } from "../src/frame-bridge/index.js"
import { critFrameCommentBridgeScript } from "../src/frame-bridge/comment-bridge.js"

const framePattern = /^\/synth\/?$/
const escapeInline = (value: string, element: "script" | "style") =>
  value.replace(new RegExp(`</${element}`, "gi"), `<\\/${element}`)
const escapeAttribute = (value: string) => value
  .replace(/&/g, "&amp;")
  .replace(/"/g, "&quot;")
  .replace(/</g, "&lt;")
export const isOrbFrameSource = (file: string) =>
  /^(?:playground\/src|src)\/.*\.(?:ts|tsx|css|svg)$/.test(
    pathRelative(fileURLToPath(new URL("..", import.meta.url)), file)
  )

export const orbFramePlugin = (): Plugin => {
  let bundlePromise: Promise<{ readonly javascript: string; readonly css: string }> | undefined
  const bundle = () => bundlePromise ??= build({
    entryPoints: [fileURLToPath(new URL("./src/frame-entry.tsx", import.meta.url))],
    bundle: true,
    format: "iife",
    minify: true,
    platform: "browser",
    write: false,
    outdir: fileURLToPath(new URL("./.inline-frame-build", import.meta.url)),
    define: { "process.env.NODE_ENV": '"production"' }
  }).then((result) => ({
    javascript: result.outputFiles.find((file) => file.path.endsWith(".js"))?.text ?? "",
    css: result.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? ""
  }))
  return {
    name: "crit-orb-inline-frames",
    apply: "serve",
    handleHotUpdate(context) {
      if (!isOrbFrameSource(context.file)) return
      bundlePromise = undefined
      context.server.ws.send({ type: "full-reload", path: "*" })
      return []
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? "/", "http://crit.localhost")
        const pathname = url.pathname
        if (request.method !== "GET" || !framePattern.test(pathname)) return next()
        void bundle().then(({ javascript, css }) => {
          const scripts = [critFrameInputBridgeScript, critFrameCommentBridgeScript, javascript]
            .map((script) => `<script>${escapeInline(script, "script")}</script>`).join("")
          const frameUrl = escapeAttribute(`${pathname}${url.search}`)
          const html = `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="crit-frame-url" content="${frameUrl}"><style>${escapeInline(css, "style")}</style></head><body><div id="root"></div>${scripts}</body></html>`
          response.statusCode = 200
          response.setHeader("Content-Type", "text/html; charset=utf-8")
          response.setHeader("x-amp-review-widget", "off")
          response.end(html)
        }).catch((cause: unknown) => {
          bundlePromise = undefined
          server.config.logger.error(`Unable to build the inline frame application: ${cause instanceof Error ? cause.message : "unknown build error"}`)
          response.statusCode = 500
          response.setHeader("Content-Type", "text/plain; charset=utf-8")
          response.end("Unable to build the inline frame application.")
        })
      })
    }
  }
}

const port = Number.parseInt(
  process.env.PORT ?? process.env.CRIT_PLAYGROUND_PORT ?? "5173",
  10
)

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [
    ...(process.env.AMP_ORB ? [orbFramePlugin()] : []),
    {
      name: "crit-feature-lab-home",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          const url = new URL(
            request.url ?? "/",
            "http://crit.localhost"
          )
          if (request.method !== "GET" || url.pathname !== "/") {
            next()
            return
          }
          request.url = `/crit/feature-lab${url.search}`
          next()
        })
      }
    },
    crit({
      ...(process.env.AMP_ORB ? { frameLoading: "relay" as const } : {}),
      ...(process.env.PUBLIC_URL ? { publicOrigin: process.env.PUBLIC_URL } : {})
    })
  ],
  server: {
    host: process.env.HOST ?? "127.0.0.1",
    port,
    strictPort: true,
    ...(process.env.AMP_ORB ? { allowedHosts: true as const } : {})
  }
})
