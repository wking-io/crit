import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http"
import path from "node:path"
import { Readable } from "node:stream"
import { fileURLToPath } from "node:url"

import { build } from "esbuild"
import { Effect, Layer, ManagedRuntime } from "effect"
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite"

import type { CanvasLiveRefreshEndpoint } from "../browser/canvas-live-refresh.js"
import {
  CRIT_MANIFEST_FILE,
  CRIT_MANIFEST_PATH,
  CritManifest,
  type ResolvedCritManifest
} from "../discovery/index.js"
import {
  DEFAULT_CRIT_API_PATH,
  makeCritHttpHandler,
  parseCritHttpRoute
} from "../http/contract.js"
import { FileSystemCanvasRepository } from "../node/file-system-canvas-repository.js"
import { FileSystemAgentActivity } from "../node/file-system-agent-activity.js"
import { FileSystemSnapshotArchive } from "../node/file-system-snapshot-archive.js"
import { GitAuthorIdentity } from "../node/git-author.js"
import { CanvasRepositoryCritClient } from "../runtime/canvas-repository-crit-client.js"
import { CanvasRepository } from "../runtime/canvas-repository.js"
import { AgentActivityStore } from "../runtime/agent-activity.js"
import { CritClientUnavailable } from "../runtime/canvas-failure.js"
import { critFrameInputBridgeScript } from "../frame-bridge/index.js"
import { critFrameCommentBridgeScript } from "../frame-bridge/comment-bridge.js"
import {
  CRIT_SNAPSHOT_PATH,
  SnapshotNotFound
} from "../runtime/snapshot-archive.js"
import { SnapshotService, SnapshotServiceLive } from "../runtime/snapshot-service.js"

export interface CritVitePluginOptions {
  readonly enabled?: boolean
  readonly root?: string
  readonly apiPath?: string
  readonly manifest?: string | false
  readonly manifestPath?: string
  readonly editorPath?: string | false
  readonly frameInputBridge?: boolean
  readonly frameLoading?: "navigate" | "parent-fetch"
  /** Trusted browser-visible origin used for manifest URLs and frame loading. */
  readonly publicOrigin?: string
}

const normalizePublicOrigin = (value: string | undefined) => {
  if (value === undefined) return undefined
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new TypeError("Crit publicOrigin must be a valid HTTP(S) URL")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("Crit publicOrigin must be an HTTP(S) URL")
  }
  return url.origin
}

type CritViteServer = Pick<ViteDevServer, "middlewares" | "httpServer"> &
  Partial<Pick<ViteDevServer, "watcher" | "ws">>

const webHeaders = (input: IncomingHttpHeaders) => {
  const headers = new Headers()
  for (const [name, value] of Object.entries(input)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item)
    } else {
      headers.set(name, value)
    }
  }
  return headers
}

const webRequest = (request: IncomingMessage) => {
  const host = request.headers.host ?? "crit.local"
  const url = new URL(request.url ?? "/", `http://${host}`)
  const method = request.method ?? "GET"
  const base = { method, headers: webHeaders(request.headers) }
  if (method === "GET" || method === "HEAD") {
    return new Request(url, base)
  }
  return new Request(url, {
    ...base,
    body: Readable.toWeb(request) as ReadableStream<Uint8Array>,
    duplex: "half"
  } as RequestInit & { duplex: "half" })
}

const sendWebResponse = async (
  output: Response,
  response: ServerResponse
) => {
  response.statusCode = output.status
  output.headers.forEach((value, name) => response.setHeader(name, value))
  response.end(Buffer.from(await output.arrayBuffer()))
}

const sendUnexpectedFailure = (response: ServerResponse, cause: unknown) => {
  if (response.headersSent) {
    response.destroy(cause instanceof Error ? cause : undefined)
    return
  }
  response.statusCode = 500
  response.setHeader("Cache-Control", "no-store")
  response.setHeader("Content-Type", "application/json; charset=utf-8")
  response.end(
    JSON.stringify({
      error: {
        code: "unavailable",
        message: cause instanceof Error ? cause.message : "Crit middleware failed"
      }
    })
  )
}

const sendJson = (response: ServerResponse, status: number, body: unknown) => {
  response.statusCode = status
  response.setHeader("Cache-Control", "no-store")
  response.setHeader("Content-Type", "application/json; charset=utf-8")
  response.setHeader("X-Content-Type-Options", "nosniff")
  response.end(JSON.stringify(body))
}

const requireGet = (
  request: IncomingMessage,
  response: ServerResponse
) => {
  if (request.method === "GET") return true
  response.setHeader("Allow", "GET")
  sendJson(response, 405, {
    error: { code: "method-not-allowed", message: "Use GET" }
  })
  return false
}

const requestPathname = (request: IncomingMessage) =>
  new URL(request.url ?? "/", "http://crit.local").pathname

const requestedSnapshotId = (request: IncomingMessage) => {
  const pathname = requestPathname(request)
  if (!pathname.startsWith(CRIT_SNAPSHOT_PATH)) return undefined
  const artifactId = pathname.slice(CRIT_SNAPSHOT_PATH.length)
  return /^[a-z0-9-]+$/.test(artifactId) ? artifactId : ""
}

const requestedEditorCanvasId = (
  request: IncomingMessage,
  editorPath: string | false
) => {
  if (editorPath === false) return undefined
  const base = `/${editorPath.replace(/^\/+|\/+$/g, "")}`
  const pathname = requestPathname(request).replace(/\/+$/, "") || "/"
  if (pathname === base) return "default"
  if (!pathname.startsWith(`${base}/`)) return undefined
  const encoded = pathname.slice(base.length + 1)
  if (encoded.length === 0 || encoded.includes("/")) return undefined
  try {
    return decodeURIComponent(encoded)
  } catch {
    return ""
  }
}

const normalizedEditorPath = (editorPath: string) =>
  `/${editorPath.replace(/^\/+|\/+$/g, "")}`

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")

const editorHtml = (
  canvasId: string,
  editorAssetPath: string,
  liveRefresh: CanvasLiveRefreshEndpoint
) => {
  const escapedCanvasId = escapeHtml(canvasId)
  const escapedLiveRefresh = escapeHtml(JSON.stringify(liveRefresh))
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Crit · ${escapedCanvasId}</title>
    <style>html,body,#crit-root{height:100%;margin:0;overflow:hidden;overscroll-behavior:none;overscroll-behavior-x:none}</style>
  </head>
  <body data-crit-canvas-id="${escapedCanvasId}" data-crit-live-refresh="${escapedLiveRefresh}">
    <div id="crit-root"></div>
    <script type="module" src="${editorAssetPath}"></script>
  </body>
</html>`
}

/**
 * Resolves where the editor reaches the HMR WebSocket for Canvas data hints.
 * This remains explicit because preview uses a self-contained editor bundle,
 * while development also uses the same socket for browser and agent writes.
 */
const liveRefreshEndpointFromConfig = (
  config: ResolvedConfig
): CanvasLiveRefreshEndpoint => {
  if (config.server.ws === false) return { enabled: false }
  const hmr = typeof config.server.hmr === "object" ? config.server.hmr : undefined
  const port =
    hmr?.clientPort ??
    hmr?.port ??
    (config.server.middlewareMode && hmr?.server === undefined
      ? 24678
      : undefined)
  const base = hmr?.path === undefined
    ? config.base
    : path.posix.join(config.base, hmr.path)
  return {
    enabled: true,
    token: config.webSocketToken,
    ...(hmr?.protocol === undefined ? {} : { protocol: hmr.protocol }),
    ...(hmr?.host === undefined ? {} : { host: hmr.host }),
    ...(port === undefined ? {} : { port }),
    ...(base === "/" ? {} : { path: base })
  }
}

const VIRTUAL_EDITOR_ID = "virtual:crit-editor.js"
const VIRTUAL_EDITOR_PATH = `/@id/${VIRTUAL_EDITOR_ID}`

const resolveReactEntry = () => {
  const javascriptEntry = fileURLToPath(
    new URL("../react/index.js", import.meta.url)
  )
  return existsSync(javascriptEntry)
    ? javascriptEntry
    : javascriptEntry.replace(/\.js$/, ".ts")
}

const resolvedVirtualEditorId = () =>
  path.join(path.dirname(resolveReactEntry()), "__crit_virtual_editor.js")

const editorModuleSource = (
  reactEntry: string,
  delivery: "vite" | "bundle",
  frameLoading: "navigate" | "parent-fetch" = "navigate",
  publicOrigin?: string
) => {
  const frameLoadingPolicy = frameLoading === "parent-fetch"
    ? { strategy: "parent-fetch", ...(publicOrigin === undefined ? {} : { aliasOrigin: publicOrigin }) }
    : { strategy: "navigate" }
  return `
  import { createElement, Fragment } from "react"
  import { createRoot } from "react-dom/client"
  import { DialRoot, useDialKit } from "dialkit"
  ${delivery === "vite"
    ? `import "/@vite/client"
  import "dialkit/styles.css"`
    : `import dialKitStyles from "dialkit/styles.css"`}
  import {
    connectCanvasLiveRefresh,
    Crit,
    DEFAULT_CANVAS_CAMERA_OPTIONS,
    DEFAULT_FRAME_CHROME_SETTINGS
  } from ${JSON.stringify(reactEntry)}

  ${delivery === "bundle" ? `
  const dialKitStyle = document.createElement("style")
  dialKitStyle.dataset.critDialkit = ""
  dialKitStyle.textContent = dialKitStyles
  document.head.append(dialKitStyle)
  ` : ""}

  const canvasId = document.body.dataset.critCanvasId || "default"

  const liveRefreshEndpoint = (() => {
    try {
      return JSON.parse(document.body.dataset.critLiveRefresh || "{}")
    } catch {
      return { enabled: false }
    }
  })()
  let disposeLiveRefresh
  const attachLiveRefresh = (session) => {
    disposeLiveRefresh?.()
    disposeLiveRefresh = connectCanvasLiveRefresh({
      canvasId,
      session,
      endpoint: liveRefreshEndpoint
    })
  }

  function CritEditor() {
    const chrome = useDialKit("Frame chrome", {
      titleMinimumCharacters: [
        DEFAULT_FRAME_CHROME_SETTINGS.titleMinimumCharacters,
        0,
        80,
        1
      ],
      iconMinimumWidth: {
        snapshot: [DEFAULT_FRAME_CHROME_SETTINGS.snapshotMinimumWidth, 0, 1600, 1],
        open: [DEFAULT_FRAME_CHROME_SETTINGS.openMinimumWidth, 0, 1600, 1],
        fullscreen: [DEFAULT_FRAME_CHROME_SETTINGS.fullscreenMinimumWidth, 0, 1600, 1],
        delete: [DEFAULT_FRAME_CHROME_SETTINGS.deleteMinimumWidth, 0, 1600, 1]
      }
    }, {
      id: "crit-frame-chrome",
      persist: { key: "crit-frame-chrome", storage: "localStorage", presets: true }
    })
    const camera = useDialKit("Camera", {
      panSpeed: [DEFAULT_CANVAS_CAMERA_OPTIONS.panSpeed, 0.1, 3, 0.05],
      zoomSpeed: [DEFAULT_CANVAS_CAMERA_OPTIONS.zoomSpeed, 0.1, 3, 0.05]
    }, {
      id: "crit-camera",
      persist: { key: "crit-camera", storage: "localStorage", presets: true }
    })

    return createElement(Fragment, null,
      createElement(Crit, {
        canvasId,
        frameLoading: ${JSON.stringify(frameLoadingPolicy)},
        onSession: attachLiveRefresh,
        frameChrome: {
          titleMinimumCharacters: chrome.titleMinimumCharacters,
          snapshotMinimumWidth: chrome.iconMinimumWidth.snapshot,
          openMinimumWidth: chrome.iconMinimumWidth.open,
          fullscreenMinimumWidth: chrome.iconMinimumWidth.fullscreen,
          deleteMinimumWidth: chrome.iconMinimumWidth.delete
        },
        cameraOptions: {
          panSpeed: camera.panSpeed,
          zoomSpeed: camera.zoomSpeed
        }
      }),
      createElement(DialRoot, {
        defaultOpen: true,
        position: "bottom-right",
        productionEnabled: true,
        theme: "system"
      })
    )
  }

  createRoot(document.getElementById("crit-root")).render(
    createElement(CritEditor)
  )
`
}

const buildEditorBundle = async (
  frameLoading: "navigate" | "parent-fetch",
  publicOrigin?: string
) => {
  const reactEntry = resolveReactEntry()
  const result = await build({
    stdin: {
      contents: editorModuleSource(reactEntry, "bundle", frameLoading, publicOrigin),
      loader: "js",
      resolveDir: path.dirname(reactEntry),
      sourcefile: "crit-editor.js"
    },
    bundle: true,
    format: "esm",
    loader: { ".css": "text" },
    legalComments: "none",
    logLevel: "silent",
    minify: true,
    platform: "browser",
    target: ["es2020"],
    write: false
  })
  const output = result.outputFiles?.[0]
  if (output === undefined) throw new Error("Crit editor bundle is empty")
  return output.text
}

export const crit = (options: CritVitePluginOptions = {}): Plugin => {
  const apiPath = options.apiPath ?? DEFAULT_CRIT_API_PATH
  const manifestPath = options.manifestPath ?? CRIT_MANIFEST_PATH
  const editorPath = options.editorPath ?? "/crit"
  const enabled = options.enabled ?? true
  const frameLoading = options.frameLoading ?? "navigate"
  const publicOrigin = normalizePublicOrigin(options.publicOrigin)
  let resolvedRoot = options.root ?? process.cwd()
  let liveRefreshEndpoint: CanvasLiveRefreshEndpoint = { enabled: false }
  let isPreview = false

  const configure = (server: CritViteServer) => {
    if (!enabled) return
    // Preview servers have no file watcher or HMR socket, so the hint channel
    // does not exist there and the editor must not try to connect to it.
    const liveRefresh: CanvasLiveRefreshEndpoint =
      server.watcher === undefined || server.ws === undefined
        ? { enabled: false }
        : liveRefreshEndpoint
    const documentLayer = FileSystemCanvasRepository.layer({ root: resolvedRoot })
    const agentActivityLayer = FileSystemAgentActivity.layer({ root: resolvedRoot })
    const archiveLayer = FileSystemSnapshotArchive.layer({ root: resolvedRoot })
    const snapshotServiceLayer = SnapshotServiceLive.pipe(
      Layer.provide(Layer.mergeAll(documentLayer, archiveLayer))
    )
    const authorIdentity = GitAuthorIdentity.make()
    const editorBase =
      editorPath === false ? undefined : normalizedEditorPath(editorPath)
    const editorAssetPath =
      editorBase === undefined
        ? undefined
        : isPreview
          ? `${editorBase}/__assets/editor.js`
          : VIRTUAL_EDITOR_PATH
    const editorBundle =
      editorBase === undefined || !isPreview
        ? undefined
        : buildEditorBundle(frameLoading, publicOrigin)
    const runtime = ManagedRuntime.make(
      Layer.mergeAll(
        documentLayer,
        agentActivityLayer,
        archiveLayer,
        snapshotServiceLayer
      )
    )
    const services = runtime.runPromise(
      Effect.all({
        activity: AgentActivityStore,
        documents: CanvasRepository,
        snapshots: SnapshotService
      }).pipe(
        Effect.map(({ activity, documents, snapshots }) => ({
          snapshots,
          handler: makeCritHttpHandler(
            CanvasRepositoryCritClient.make(documents, {
              currentAuthor: () =>
                authorIdentity.resolve(resolvedRoot).pipe(
                  Effect.mapError(
                    (cause) =>
                      new CritClientUnavailable({
                        operation: "current-author",
                        id: "current-author",
                        detail: cause.detail
                      })
                  )
                ),
              loadAgentActivities: activity.read,
              snapshotFrame: snapshots.snapshotFrame
            }),
            { apiPath }
          )
        }))
      )
    )

    if (server.watcher !== undefined && server.ws !== undefined) {
      const watcher = server.watcher
      const ws = server.ws
      const canvasesDirectory = path.join(resolvedRoot, ".crit", "canvases")
      const activityDirectory = path.join(resolvedRoot, ".crit", "activity")
      watcher.add(canvasesDirectory)
      watcher.add(activityDirectory)
      const notify = (changedPath: string) => {
        if (path.dirname(changedPath) !== canvasesDirectory || !changedPath.endsWith(".json")) {
          return
        }
        try {
          ws.send({
            type: "custom",
            event: "crit:canvas-changed",
            data: {
              id: decodeURIComponent(path.basename(changedPath, ".json"))
            }
          })
        } catch {
          // A malformed filename is not a Canvas change.
        }
      }
      watcher.on("add", notify)
      watcher.on("change", notify)
      watcher.on("unlink", notify)
      const notifyActivity = (changedPath: string) => {
        const relative = path.relative(activityDirectory, changedPath)
        const segments = relative.split(path.sep)
        if (segments.length !== 2 || !segments[1]!.endsWith(".json")) return
        try {
          ws.send({
            type: "custom",
            event: "crit:agent-activity",
            data: {
              id: decodeURIComponent(segments[0]!)
            }
          })
        } catch {
          // A malformed filename is not an activity change.
        }
      }
      watcher.on("add", notifyActivity)
      watcher.on("change", notifyActivity)
      watcher.on("unlink", notifyActivity)
    }

    const loadManifest = async (
      request: IncomingMessage
    ): Promise<ResolvedCritManifest | undefined> => {
      if (options.manifest === false) return undefined
      const manifestFile = path.resolve(
        resolvedRoot,
        options.manifest ?? CRIT_MANIFEST_FILE
      )
      let source: string
      try {
        source = await readFile(manifestFile, "utf8")
      } catch (cause) {
        if (
          cause instanceof Error &&
          "code" in cause &&
          cause.code === "ENOENT"
        ) {
          return undefined
        }
        throw cause
      }
      const host = request.headers.host ?? "crit.local"
      const protocol =
        "encrypted" in request.socket && request.socket.encrypted
          ? "https:"
          : "http:"
      return Effect.runPromise(
        CritManifest.resolve(JSON.parse(source) as unknown, {
          baseUrl: publicOrigin === undefined
            ? `${protocol}//${host}/`
            : `${publicOrigin}/`,
          source: manifestFile
        })
      )
    }

    server.middlewares.use((request, response, next) => {
      if (
        editorBundle !== undefined &&
        editorAssetPath !== undefined &&
        requestPathname(request) === editorAssetPath
      ) {
        if (!requireGet(request, response)) return
        void editorBundle!
          .then((javascript) => {
            response.statusCode = 200
            response.setHeader("Cache-Control", "no-cache")
            response.setHeader("Content-Type", "text/javascript; charset=utf-8")
            response.setHeader("X-Content-Type-Options", "nosniff")
            response.end(javascript)
          })
          .catch((cause: unknown) => sendUnexpectedFailure(response, cause))
        return
      }
      const editorCanvasId = requestedEditorCanvasId(request, editorPath)
      if (editorCanvasId !== undefined) {
        if (!requireGet(request, response)) return
        if (editorCanvasId.length === 0) {
          sendJson(response, 400, {
            error: { code: "invalid-request", message: "Invalid Canvas ID" }
          })
          return
        }
        response.statusCode = 200
        response.setHeader("Cache-Control", "no-store")
        response.setHeader("Content-Type", "text/html; charset=utf-8")
        response.setHeader("X-Content-Type-Options", "nosniff")
        response.end(editorHtml(editorCanvasId, editorAssetPath!, liveRefresh))
        return
      }
      const snapshotId = requestedSnapshotId(request)
      if (snapshotId !== undefined) {
        if (!requireGet(request, response)) return
        if (snapshotId.length === 0) {
          sendJson(response, 400, {
            error: { code: "invalid-request", message: "Invalid snapshot artifact ID" }
          })
          return
        }
        void services
          .then(({ snapshots }) => runtime.runPromise(snapshots.readArtifact(snapshotId)))
          .then((artifact) => {
            response.statusCode = 200
            response.setHeader("Cache-Control", "public, max-age=31536000, immutable")
            response.setHeader("Content-Type", "text/html; charset=utf-8")
            response.setHeader("X-Content-Type-Options", "nosniff")
            response.end(Buffer.from(artifact))
          })
          .catch((cause: unknown) => {
            if (cause instanceof SnapshotNotFound) {
              sendJson(response, 404, {
                error: { code: "not-found", message: `Snapshot not found: ${snapshotId}` }
              })
              return
            }
            sendUnexpectedFailure(response, cause)
          })
        return
      }
      if (requestPathname(request) === manifestPath) {
        if (!requireGet(request, response)) return
        void loadManifest(request)
          .then((manifest) => {
            if (manifest === undefined) {
              sendJson(response, 404, {
                error: {
                  code: "not-found",
                  message: `${options.manifest ?? CRIT_MANIFEST_FILE} was not found`
                }
              })
              return
            }
            sendJson(response, 200, manifest)
          })
          .catch((cause: unknown) => sendUnexpectedFailure(response, cause))
        return
      }
      const route = parseCritHttpRoute(request.url, apiPath)
      if (route === undefined) {
        next()
        return
      }
      void services
        .then((resolved) =>
          Effect.runPromise(resolved.handler(webRequest(request), route))
        )
        .then((output) =>
          output === null ? next() : sendWebResponse(output, response)
        )
        .catch((cause: unknown) => sendUnexpectedFailure(response, cause))
    })

    server.httpServer?.once("close", () => {
      void runtime.dispose()
    })
  }

  return {
    name: "@riff-refine/crit",
    apply: "serve",
    configResolved(config) {
      resolvedRoot = options.root ?? config.root
      liveRefreshEndpoint = liveRefreshEndpointFromConfig(config)
    },
    resolveId(id) {
      if (
        enabled &&
        editorPath !== false &&
        id === VIRTUAL_EDITOR_ID
      ) {
        return resolvedVirtualEditorId()
      }
    },
    load(id) {
      if (id === resolvedVirtualEditorId()) {
        return editorModuleSource(
          resolveReactEntry(), "vite", frameLoading, publicOrigin
        )
      }
    },
    transformIndexHtml() {
      if (options.frameInputBridge === false) return []
      return [
        {
          tag: "script",
          attrs: { "data-crit-frame-input-bridge": "" },
          children: critFrameInputBridgeScript,
          injectTo: "head-prepend"
        },
        {
          tag: "script",
          attrs: { "data-crit-frame-comment-bridge": "" },
          children: critFrameCommentBridgeScript,
          injectTo: "head-prepend"
        }
      ]
    },
    configureServer(server) {
      isPreview = false
      return configure(server)
    },
    configurePreviewServer(server) {
      isPreview = true
      return configure(server)
    }
  }
}

export const critVitePlugin = crit
