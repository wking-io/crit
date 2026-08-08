import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http"
import { Readable } from "node:stream"

import { Effect, ManagedRuntime } from "effect"
import type { Plugin, PreviewServer, ViteDevServer } from "vite"

import {
  DEFAULT_CRIT_API_PATH,
  isCritHttpRequest,
  makeCritHttpHandler
} from "../http/contract.js"
import { FileSystemDocumentStore } from "../node/file-system-document-store.js"
import { DocumentStoreCritClient } from "../runtime/document-store-crit-client.js"
import { DocumentStore } from "../runtime/document-store.js"

export interface CritVitePluginOptions {
  readonly enabled?: boolean
  readonly root?: string
  readonly apiPath?: string
  readonly createIfMissing?: boolean
  readonly title?: (canvasId: string) => string
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

export const crit = (options: CritVitePluginOptions = {}): Plugin => {
  const apiPath = options.apiPath ?? DEFAULT_CRIT_API_PATH
  const enabled = options.enabled ?? true
  let resolvedRoot = options.root ?? process.cwd()

  const configure = (server: CritViteServer) => {
    if (!enabled) return
    const runtime = ManagedRuntime.make(
      FileSystemDocumentStore.layer({ root: resolvedRoot })
    )
    const handler = runtime.runPromise(
      DocumentStore.pipe(
        Effect.map((documents) =>
          makeCritHttpHandler(
            DocumentStoreCritClient.make(documents, {
              createIfMissing: options.createIfMissing ?? true,
              ...(options.title === undefined ? {} : { title: options.title })
            }),
            { apiPath }
          )
        )
      )
    )

    server.middlewares.use((request, response, next) => {
      if (!isCritHttpRequest(request.url, apiPath)) {
        next()
        return
      }
      void handler
        .then((handle) => Effect.runPromise(handle(webRequest(request))))
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
