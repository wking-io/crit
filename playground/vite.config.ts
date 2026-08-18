import { defineConfig, type ServerOptions } from "vite"
import { fileURLToPath } from "node:url"
import { relative as pathRelative } from "node:path"
import { build } from "esbuild"
import type { Plugin } from "vite"

import { crit, type CritVitePluginOptions } from "../src/vite/index.js"
import { critFrameInputBridgeScript } from "../src/frame-bridge/index.js"
import { critFrameCommentBridgeScript } from "../src/frame-bridge/comment-bridge.js"
import { causeMessage } from "../src/internal/cause-message.js"
import {
  featuresForPlaygroundProfile,
  resolvePlaygroundProfile,
  type PlaygroundProfile
} from "./src/playground-profile.js"

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

export type PlaygroundMode = PlaygroundProfile

export const playgroundMode = (
  environment: Readonly<Record<string, string | undefined>>
): PlaygroundMode => {
  if (environment.CRIT_PLAYGROUND_MODE === "alpha") return "alpha"
  if (environment.CRIT_PLAYGROUND_MODE === "release") return "release"
  return "development"
}

const profileFromRequest = (
  cookieHeader: string | undefined,
  fallback: PlaygroundProfile
) => resolvePlaygroundProfile({
  cookie: cookieHeader ?? null,
  fallback
})

export const orbFramePlugin = (
  fallbackProfile: PlaygroundProfile = "development"
): Plugin => {
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
        const commentsEnabled = featuresForPlaygroundProfile(
          profileFromRequest(request.headers.cookie, fallbackProfile)
        ).comments
        void bundle().then(({ javascript, css }) => {
          const scripts = [
            critFrameInputBridgeScript,
            ...(commentsEnabled ? [critFrameCommentBridgeScript] : []),
            javascript
          ]
            .map((script) => `<script>${escapeInline(script, "script")}</script>`).join("")
          const frameUrl = escapeAttribute(`${pathname}${url.search}`)
          const html = `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="crit-frame-url" content="${frameUrl}"><style>${escapeInline(css, "style")}</style></head><body><div id="root"></div>${scripts}</body></html>`
          response.statusCode = 200
          response.setHeader("Content-Type", "text/html; charset=utf-8")
          response.setHeader("x-amp-review-widget", "off")
          response.end(html)
        }).catch((cause: unknown) => {
          bundlePromise = undefined
          server.config.logger.error(
            `Unable to build the inline frame application: ${causeMessage(cause, "unknown build error")}`
          )
          response.statusCode = 500
          response.setHeader("Content-Type", "text/plain; charset=utf-8")
          response.end("Unable to build the inline frame application.")
        })
      })
    }
  }
}

const playgroundEditorPlugin = (): Plugin => ({
  name: "crit-playground-editor",
  enforce: "pre",
  resolveId(id) {
    if (id === "virtual:crit-editor.js") {
      return fileURLToPath(new URL("./src/editor-shell.tsx", import.meta.url))
    }
  }
})

const port = Number.parseInt(
  process.env.PORT ?? process.env.CRIT_PLAYGROUND_PORT ?? "5173",
  10
)
const ampOrb = Boolean(process.env.AMP_ORB)
export const playgroundPublicUrl = (
  environment: Readonly<Record<string, string | undefined>>
) => environment.PUBLIC_URL ?? environment.PORTLESS_URL

const mode = playgroundMode(process.env)
const publicUrl = playgroundPublicUrl(process.env)
let critOptions: CritVitePluginOptions = {
  features: featuresForPlaygroundProfile(mode),
  frameCommentBridge: true,
  frameLoading: ampOrb ? "relay" : "navigate",
  featuresForRequest: (request) => featuresForPlaygroundProfile(
    resolvePlaygroundProfile({
      cookie: request.headers.get("cookie"),
      fallback: mode
    })
  )
}
if (publicUrl) {
  critOptions = { ...critOptions, publicOrigin: publicUrl }
}
const serverOptions: ServerOptions = {
  host: process.env.HOST ?? "127.0.0.1",
  port,
  strictPort: true,
  fs: {
    allow: [fileURLToPath(new URL("..", import.meta.url))]
  }
}
if (ampOrb) {
  serverOptions.allowedHosts = true
}

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  define: {
    __CRIT_PLAYGROUND_DEFAULT_PROFILE__: JSON.stringify(mode),
    __CRIT_PLAYGROUND_FRAME_LOADING__: JSON.stringify(
      ampOrb ? "relay" : "navigate"
    ),
    __CRIT_RELEASE_ENTRY__: JSON.stringify(
      fileURLToPath(new URL("../dist/react/index.js", import.meta.url))
    )
  },
  plugins: [
    playgroundEditorPlugin(),
    ...(ampOrb ? [orbFramePlugin(mode)] : []),
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
    } satisfies Plugin,
    crit(critOptions)
  ],
  server: serverOptions
})
