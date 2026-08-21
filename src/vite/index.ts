import { AsyncLocalStorage } from "node:async_hooks"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http"
import path from "node:path"
import { Readable } from "node:stream"
import { fileURLToPath } from "node:url"

import { build } from "esbuild"
import { Effect, Layer, ManagedRuntime, Match, Predicate, Schema } from "effect"
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite"

import type { CanvasLiveRefreshEndpoint } from "../browser/canvas-live-refresh.js"
import { causeMessage } from "../internal/cause-message.js"
import {
  DEFAULT_CRIT_FEATURES,
  resolveCritFeatures,
  type CritFeatures
} from "../core/features.js"
import {
  CRIT_MANIFEST_FILE,
  CRIT_MANIFEST_PATH,
  CritManifest,
  type CritManifestDocument,
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
import {
  CanvasRepositoryCritActivityClient,
  CanvasRepositoryCritClient,
  CanvasRepositoryCritSnapshotClient
} from "../runtime/canvas-repository-crit-client.js"
import { CanvasRepository } from "../runtime/canvas-repository.js"
import { AgentActivityStore } from "../runtime/agent-activity.js"
import {
  CritClientNotFound,
  CritClientUnavailable
} from "../runtime/canvas-failure.js"
import {
  CRIT_FRAME_RELAY_PATH,
  parseFrameRelayPath
} from "../runtime/frame-relay.js"
import { critFrameInputBridgeScript } from "../frame-bridge/index.js"
import { critFrameCommentBridgeScript } from "../frame-bridge/comment-bridge.js"
import {
  CRIT_SNAPSHOT_PATH,
  SnapshotNotFound
} from "../runtime/snapshot-archive.js"
import { SnapshotService, SnapshotServiceLive } from "../runtime/snapshot-service.js"
import { prepareFrameRelayHtml } from "./frame-relay.js"

export interface CritVitePluginOptions {
  readonly enabled?: boolean
  readonly root?: string
  readonly apiPath?: string
  readonly manifest?: string | false
  readonly manifestPath?: string
  readonly editorPath?: string | false
  readonly frameInputBridge?: boolean
  readonly frameCommentBridge?: boolean
  readonly features?: Partial<CritFeatures>
  readonly featuresForRequest?: (request: Request) => Partial<CritFeatures>
  /** `parent-fetch` is retained as a deprecated alias for `relay`. */
  readonly frameLoading?: "navigate" | "relay" | "parent-fetch"
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
  // SAFETY: Node's Readable.toWeb stream implements the Fetch body contract,
  // but the Node and DOM declarations use incompatible Uint8Array generics.
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
        message: causeMessage(cause, "Crit middleware failed")
      }
    })
  )
}

type CritViteJsonResponse =
  | CritManifestDocument
  | {
      readonly error: {
        readonly code: string
        readonly message: string
      }
    }

const sendJson = (
  response: ServerResponse,
  status: number,
  body: CritViteJsonResponse
) => {
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

const requestOrigin = (request: IncomingMessage) => {
  const forwardedProtocol = request.headers["x-forwarded-proto"]
  const forwarded = (Array.isArray(forwardedProtocol)
    ? forwardedProtocol[0]
    : forwardedProtocol)?.split(",")[0]?.trim()
  const protocol = forwarded === "http" || forwarded === "https"
    ? `${forwarded}:`
    : "encrypted" in request.socket && request.socket.encrypted
      ? "https:"
      : "http:"
  return new URL(`${protocol}//${request.headers.host ?? "crit.local"}`).origin
}

const internalRequestOrigin = (request: IncomingMessage) => {
  const address = request.socket.localAddress ?? "127.0.0.1"
  const hostname = address.includes(":") ? `[${address}]` : address
  const protocol = "encrypted" in request.socket && request.socket.encrypted
    ? "https:"
    : "http:"
  return `${protocol}//${hostname}:${request.socket.localPort ?? 80}`
}

type SnapshotFetchContext = {
  readonly internalOrigin: string
  readonly requestOrigin: string
  readonly publicOrigin: string | undefined
}

const snapshotFetchContext = new AsyncLocalStorage<SnapshotFetchContext>()

const fetchUrl = (input: Parameters<typeof fetch>[0]) =>
  Predicate.isString(input) ? input : input instanceof URL ? input.href : input.url

const snapshotFetch: typeof fetch = (input, init) => {
  const context = snapshotFetchContext.getStore()
  if (context === undefined) return fetch(input, init)
  const url = new URL(fetchUrl(input), context.internalOrigin)
  const published = context.publicOrigin !== undefined &&
    url.origin === context.publicOrigin
  if (
    url.origin !== context.internalOrigin &&
    (published || url.origin === context.requestOrigin)
  ) {
    const target = new URL(`${url.pathname}${url.search}`, context.internalOrigin)
    return input instanceof Request
      ? fetch(new Request(target, input), init)
      : fetch(target, init)
  }
  return fetch(input, init)
}

const FrameRelayRequestHeaders = Schema.Struct({
  accept: Schema.optionalKey(Schema.String),
  "accept-language": Schema.optionalKey(Schema.String),
  authorization: Schema.optionalKey(Schema.String),
  cookie: Schema.optionalKey(Schema.String),
  host: Schema.optionalKey(Schema.String),
  "user-agent": Schema.optionalKey(Schema.String)
})

const decodeFrameRelayRequestHeaders = Schema.decodeUnknownSync(
  FrameRelayRequestHeaders
)

const relayRequestHeaders = (request: IncomingMessage) => {
  const source = decodeFrameRelayRequestHeaders(request.headers)
  const headers = new Headers()
  const forwarded = [
    ["accept", source.accept],
    ["accept-language", source["accept-language"]],
    ["authorization", source.authorization],
    ["cookie", source.cookie],
    ["user-agent", source["user-agent"]]
  ] as const
  for (const [name, value] of forwarded) {
    if (value !== undefined) headers.set(name, value)
  }
  if (source.host !== undefined) headers.set("host", source.host)
  headers.set("accept", "text/html,application/xhtml+xml")
  return headers
}

class FrameRelayFailure extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

const fetchFrameDocument = async (
  request: IncomingMessage,
  canonicalUrl: URL,
  publicOrigin: string | undefined
) => {
  const browserOrigin = requestOrigin(request)
  const allowedOrigins = new Set([
    browserOrigin,
    ...(publicOrigin === undefined ? [] : [publicOrigin])
  ])
  if (!allowedOrigins.has(canonicalUrl.origin)) {
    throw new FrameRelayFailure(403, "Frame URL is outside the trusted application origin")
  }
  if (canonicalUrl.pathname.startsWith(CRIT_FRAME_RELAY_PATH)) {
    throw new FrameRelayFailure(400, "A Frame cannot relay another Frame relay URL")
  }

  const internalOrigin = internalRequestOrigin(request)
  let logicalUrl = new URL(
    `${canonicalUrl.pathname}${canonicalUrl.search}`,
    browserOrigin
  )
  let target = new URL(`${logicalUrl.pathname}${logicalUrl.search}`, internalOrigin)
  const headers = relayRequestHeaders(request)
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const output = await fetch(target, {
      headers,
      redirect: "manual"
    })
    if (output.status < 300 || output.status >= 400) {
      return { output, documentUrl: logicalUrl.href }
    }
    if (redirects === 5) {
      throw new FrameRelayFailure(502, "Frame request redirected too many times")
    }
    const location = output.headers.get("location")
    if (location === null) {
      throw new FrameRelayFailure(502, "Frame redirect did not include a location")
    }
    const nextLogicalUrl = new URL(location, logicalUrl)
    if (!allowedOrigins.has(nextLogicalUrl.origin)) {
      throw new FrameRelayFailure(403, "Frame request redirected outside the trusted application origin")
    }
    logicalUrl = new URL(
      `${nextLogicalUrl.pathname}${nextLogicalUrl.search}`,
      browserOrigin
    )
    target = new URL(`${logicalUrl.pathname}${logicalUrl.search}`, internalOrigin)
  }
  throw new FrameRelayFailure(502, "Frame request failed")
}

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
  liveRefresh: CanvasLiveRefreshEndpoint,
  editorPath: string,
  canvasChoices: ReadonlyArray<{
    readonly id: string
    readonly title: string
  }>
) => {
  const escapedCanvasId = escapeHtml(canvasId)
  const escapedLiveRefresh = escapeHtml(JSON.stringify(liveRefresh))
  const escapedEditorPath = escapeHtml(editorPath)
  const escapedCanvasChoices = escapeHtml(JSON.stringify(canvasChoices))
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Crit · ${escapedCanvasId}</title>
    <style>html,body,#crit-root{height:100%;margin:0;overflow:hidden;overscroll-behavior:none;overscroll-behavior-x:none}</style>
  </head>
  <body data-crit-canvas-id="${escapedCanvasId}" data-crit-canvas-choices="${escapedCanvasChoices}" data-crit-editor-path="${escapedEditorPath}" data-crit-live-refresh="${escapedLiveRefresh}">
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
  if (config.server.ws === false || config.server.hmr === false) {
    return { enabled: false }
  }
  const hmr = config.server.hmr === true ? undefined : config.server.hmr
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
    protocol: hmr?.protocol ?? null,
    host: hmr?.host ?? null,
    port: port ?? null,
    path: base
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
  frameLoading: "navigate" | "relay" | "parent-fetch" = "navigate",
  features: CritFeatures = DEFAULT_CRIT_FEATURES
) => {
  const frameLoadingPolicy = frameLoading === "navigate"
    ? { strategy: "navigate" }
    : { strategy: "relay" }
  return `
  import { createElement } from "react"
  import { createRoot } from "react-dom/client"
  ${delivery === "vite"
    ? `import "/@vite/client"`
    : ""}
  import {
    connectCanvasLiveRefresh,
    Crit,
    DEFAULT_CANVAS_CAMERA_OPTIONS,
    DEFAULT_FRAME_CHROME_SETTINGS
  } from ${JSON.stringify(reactEntry)}

  const canvasId = document.body.dataset.critCanvasId || "default"
  const canvasChoices = (() => {
    try {
      const parsed = JSON.parse(document.body.dataset.critCanvasChoices || "[]")
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })()
  const editorPath = document.body.dataset.critEditorPath || "/crit"
  const selectCanvas = (nextCanvasId) => {
    if (nextCanvasId === canvasId) return
    window.location.assign(
      editorPath + "/" + encodeURIComponent(nextCanvasId)
    )
  }

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
    return createElement(Crit, {
      canvasId,
      canvasChoices,
      developerTools: ${delivery === "vite"},
      features: ${JSON.stringify(features)},
      frameLoading: ${JSON.stringify(frameLoadingPolicy)},
      onCanvasSelect: selectCanvas,
      onSession: attachLiveRefresh,
      frameChrome: DEFAULT_FRAME_CHROME_SETTINGS,
      cameraOptions: DEFAULT_CANVAS_CAMERA_OPTIONS
    })
  }

  createRoot(document.getElementById("crit-root")).render(
    createElement(CritEditor)
  )
`
}

const buildEditorBundle = async (
  frameLoading: "navigate" | "relay" | "parent-fetch",
  features: CritFeatures
) => {
  const reactEntry = resolveReactEntry()
  const result = await build({
    stdin: {
      contents: editorModuleSource(reactEntry, "bundle", frameLoading, features),
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
  const features = resolveCritFeatures(options.features)
  const featuresForRequest = options.featuresForRequest
  const frameInputBridge = options.frameInputBridge ?? true
  const frameCommentBridge = options.frameCommentBridge ?? features.comments
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
    const archiveLayer = FileSystemSnapshotArchive.layer({
      root: resolvedRoot,
      fetch: snapshotFetch
    })
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
        : buildEditorBundle(frameLoading, features)
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
          documents,
          snapshots,
          handler: makeCritHttpHandler({
            client: CanvasRepositoryCritClient.make(documents, {
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
                )
            }),
            snapshots: CanvasRepositoryCritSnapshotClient.make(
              snapshots.snapshotFrame
            ),
            activity: CanvasRepositoryCritActivityClient.make(activity.read)
          }, featuresForRequest === undefined
            ? { apiPath, features }
            : {
              apiPath,
              featuresForRequest: (request) =>
                resolveCritFeatures(featuresForRequest(request))
            })
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
        CritManifest.resolve(
          Schema.decodeUnknownSync(Schema.Json)(JSON.parse(source)),
          {
            baseUrl: publicOrigin === undefined
              ? `${protocol}//${host}/`
              : `${publicOrigin}/`,
            source: manifestFile
          }
        )
      )
    }

    server.middlewares.use((request, response, next) => {
      const frameRoute = frameLoading === "navigate"
        ? undefined
        : parseFrameRelayPath(requestPathname(request))
      if (frameRoute !== undefined) {
        if (!requireGet(request, response)) return
        if (frameRoute === null) {
          sendJson(response, 400, {
            error: { code: "invalid-request", message: "Invalid Frame relay URL" }
          })
          return
        }
        void services
          .then(({ documents }) => runtime.runPromise(documents.load(frameRoute.canvasId)))
          .then(async (document) => {
            const frame = document.frames.find(({ id }) => id === frameRoute.frameId)
            if (frame === undefined || frame.snapshot !== undefined) {
              throw new CritClientNotFound({ id: frameRoute.frameId })
            }
            let canonicalUrl: URL
            try {
              canonicalUrl = new URL(frame.url, publicOrigin ?? requestOrigin(request))
            } catch {
              throw new FrameRelayFailure(400, "Frame URL is invalid")
            }
            if (canonicalUrl.protocol !== "http:" && canonicalUrl.protocol !== "https:") {
              throw new FrameRelayFailure(403, "Frame URL must use HTTP(S)")
            }
            const { output, documentUrl } = await fetchFrameDocument(
              request,
              canonicalUrl,
              publicOrigin
            )
            if (!output.ok) {
              throw new FrameRelayFailure(502, `Frame request failed (${output.status})`)
            }
            if (!output.headers.get("content-type")?.toLowerCase().includes("text/html")) {
              throw new FrameRelayFailure(502, "Frame response is not HTML")
            }
            return prepareFrameRelayHtml(
              await output.text(),
              documentUrl,
              canonicalUrl.href
            )
          })
          .then((html) => {
            response.statusCode = 200
            response.setHeader("Cache-Control", "no-store")
            response.setHeader("Content-Type", "text/html; charset=utf-8")
            response.setHeader("X-Content-Type-Options", "nosniff")
            response.end(html)
          })
          .catch((cause: unknown) => {
            Match.value(cause).pipe(
              Match.when(Match.instanceOf(CritClientNotFound), () =>
                sendJson(response, 404, {
                  error: { code: "not-found", message: "Frame not found" }
                })),
              Match.when(Match.instanceOf(FrameRelayFailure), (failure) =>
                sendJson(response, failure.status, {
                  error: {
                    code: "frame-relay-failed",
                    message: failure.message
                  }
                })),
              Match.orElse((failure) =>
                sendUnexpectedFailure(response, failure))
            )
          })
        return
      }
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
        void services
          .then(({ documents }) => runtime.runPromise(documents.list()))
          .then((documents) => {
            response.statusCode = 200
            response.setHeader("Cache-Control", "no-store")
            response.setHeader("Content-Type", "text/html; charset=utf-8")
            response.setHeader("X-Content-Type-Options", "nosniff")
            response.end(editorHtml(
              editorCanvasId,
              editorAssetPath!,
              liveRefresh,
              editorBase!,
              documents.map(({ id, title }) => ({ id, title }))
            ))
          })
          .catch((cause: unknown) => sendUnexpectedFailure(response, cause))
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
            sendJson(response, 200, CritManifest.toDocument(manifest))
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
          snapshotFetchContext.run(
            {
              internalOrigin: internalRequestOrigin(request),
              requestOrigin: requestOrigin(request),
              publicOrigin
            },
            () => Effect.runPromise(resolved.handler(webRequest(request), route))
          )
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
          resolveReactEntry(), "vite", frameLoading, features
        )
      }
    },
    transformIndexHtml() {
      const tags = []
      if (frameInputBridge) {
        tags.push({
          tag: "script",
          attrs: { "data-crit-frame-input-bridge": "" },
          children: critFrameInputBridgeScript,
          injectTo: "head-prepend" as const
        })
      }
      if (frameCommentBridge) {
        tags.push({
          tag: "script",
          attrs: { "data-crit-frame-comment-bridge": "" },
          children: critFrameCommentBridgeScript,
          injectTo: "head-prepend" as const
        })
      }
      return tags
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

export {
  ALPHA_FEATURES,
  DEFAULT_CRIT_FEATURES,
  DEVELOPMENT_FEATURES,
  type CritFeatures
} from "../core/features.js"
