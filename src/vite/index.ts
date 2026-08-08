import { readFile } from "node:fs/promises"
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http"
import path from "node:path"
import { Readable } from "node:stream"

import { Effect, Layer, ManagedRuntime } from "effect"
import type { Plugin, PreviewServer, ViteDevServer } from "vite"

import {
  CRIT_MANIFEST_FILE,
  CRIT_MANIFEST_PATH,
  CritManifest,
  type ResolvedCritManifest
} from "../discovery/index.js"
import {
  DEFAULT_CRIT_API_PATH,
  isCritHttpRequest,
  makeCritHttpHandler
} from "../http/contract.js"
import { FileSystemDocumentStore } from "../node/file-system-document-store.js"
import { DocumentStoreCritClient } from "../runtime/document-store-crit-client.js"
import { DocumentStore } from "../runtime/document-store.js"
import { CritRuntimeLive } from "../runtime/crit-runtime.js"

export interface CritVitePluginOptions {
  readonly enabled?: boolean
  readonly root?: string
  readonly apiPath?: string
  readonly createIfMissing?: boolean
  readonly title?: (canvasId: string) => string
  readonly manifest?: string | false
  readonly manifestPath?: string
}

type CritViteServer = Pick<ViteDevServer, "middlewares" | "httpServer"> | PreviewServer

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

const requestPathname = (request: IncomingMessage) =>
  new URL(request.url ?? "/", "http://crit.local").pathname

const requestedCanvasId = (
  request: IncomingMessage,
  apiPath: string
) => {
  if (request.method !== "GET") return undefined
  const prefix = `${apiPath.replace(/\/+$/, "")}/canvases/`
  const pathname = requestPathname(request)
  if (!pathname.startsWith(prefix)) return undefined
  const encoded = pathname.slice(prefix.length)
  if (encoded.length === 0 || encoded.includes("/")) return undefined
  try {
    return decodeURIComponent(encoded)
  } catch {
    return undefined
  }
}

export const crit = (options: CritVitePluginOptions = {}): Plugin => {
  const apiPath = options.apiPath ?? DEFAULT_CRIT_API_PATH
  const manifestPath = options.manifestPath ?? CRIT_MANIFEST_PATH
  const enabled = options.enabled ?? true
  let resolvedRoot = options.root ?? process.cwd()

  const configure = (server: CritViteServer) => {
    if (!enabled) return
    const documentLayer = FileSystemDocumentStore.layer({ root: resolvedRoot })
    const critRuntimeLayer = CritRuntimeLive.pipe(Layer.provide(documentLayer))
    const runtime = ManagedRuntime.make(
      Layer.mergeAll(documentLayer, critRuntimeLayer)
    )
    const services = runtime.runPromise(
      Effect.all({ documents: DocumentStore }).pipe(
        Effect.map(({ documents }) => ({
          handler: makeCritHttpHandler(
            DocumentStoreCritClient.make(documents, {
              createIfMissing: options.createIfMissing ?? true,
              ...(options.title === undefined ? {} : { title: options.title })
            }),
            { apiPath }
          )
        }))
      )
    )

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
      const forwardedProtocol = request.headers["x-forwarded-proto"]
      const protocol =
        forwardedProtocol === "https" ||
        ("encrypted" in request.socket && request.socket.encrypted)
          ? "https:"
          : "http:"
      return Effect.runPromise(
        CritManifest.resolve(JSON.parse(source) as unknown, {
          baseUrl: `${protocol}//${host}/`,
          source: manifestFile
        })
      )
    }

    server.middlewares.use((request, response, next) => {
      if (requestPathname(request) === manifestPath) {
        if (request.method !== "GET") {
          response.setHeader("Allow", "GET")
          sendJson(response, 405, {
            error: { code: "method-not-allowed", message: "Use GET" }
          })
          return
        }
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
      if (!isCritHttpRequest(request.url, apiPath)) {
        next()
        return
      }
      const canvasId = requestedCanvasId(request, apiPath)
      void services
        .then(async (resolved) => {
          if (canvasId !== undefined) {
            const manifest = await loadManifest(request)
            if (manifest?.canvases.some((canvas) => canvas.id === canvasId)) {
              await runtime.runPromise(
                CritManifest.sync(manifest, { canvasId })
              )
            }
          }
          return Effect.runPromise(resolved.handler(webRequest(request)))
        })
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
    },
    configureServer: configure,
    configurePreviewServer: configure
  }
}

export const critVitePlugin = crit
