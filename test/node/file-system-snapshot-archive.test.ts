import { mkdtemp, rm } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { parse } from "node-html-parser"

import { FileSystemSnapshotArchive } from "../../src/node/file-system-snapshot-archive.js"
import {
  SnapshotArchive,
  SnapshotNotFound
} from "../../src/runtime/snapshot-archive.js"
import { serverPort } from "../support/server-address.js"

describe("FileSystemSnapshotArchive", () => {
  let root = ""
  let server: Server | undefined

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "crit-snapshot-archive-"))
  })

  afterEach(async () => {
    if (server !== undefined) {
      await new Promise<void>((resolve, reject) =>
        server?.close((cause) => (cause ? reject(cause) : resolve()))
      )
      server = undefined
    }
    await rm(root, { recursive: true, force: true })
  })

  it.effect("stores one self-contained minified HTML artifact", () =>
    Effect.gen(function*() {
      const archive = yield* SnapshotArchive
      const origin = yield* Effect.promise(startFixtureServer)
      const artifact = yield* archive.capture(`${origin}/`)
      const html = new TextDecoder().decode(yield* archive.read(artifact.artifactId))
      const duplicate = yield* Effect.flip(archive.capture(`${origin}/`))

      expect(artifact).toMatchObject({
        artifactId: "20260808120000-deadbeef",
        sourceUrl: `${origin}/`,
        capturedAt: "2026-08-08T12:00:00.000Z"
      })
      expect(artifact.sizeBytes).toBe(Buffer.byteLength(html))
      expect(html).toContain("<!doctype html>")
      expect(html).toContain("data:image/svg+xml")
      const moduleSource = parse(html)
        .querySelector('script[type="module"]')
        ?.getAttribute("src")
        ?.split("base64,")[1]
      expect(Buffer.from(moduleSource ?? "", "base64").toString("utf8")).toContain(
        "frozen"
      )
      expect(html).not.toContain('src="/app.js"')
      expect(html).not.toContain('href="/styles.css"')
      expect(html).not.toContain("/* source comment */")
      expect(html).not.toContain("import ")
      expect(html).not.toMatch(/>\s{2,}</)
      expect(html).toContain("<h1>Frozen page</h1>")
      expect(html).toContain("<pre>  preserve\n  spacing  </pre>")
      expect(html).toContain("<textarea>  preserve\n  spacing  </textarea>")
      expect(duplicate).toMatchObject({
        _tag: "SnapshotStorageFailed",
        operation: "capture",
        artifactId: artifact.artifactId
      })
      expect(
        new TextDecoder().decode(yield* archive.read(artifact.artifactId))
      ).toBe(html)
    }).pipe(
      Effect.provide(
        FileSystemSnapshotArchive.layer({
          root,
          createId: () => "20260808120000-deadbeef",
          now: () => new Date("2026-08-08T12:00:00.000Z")
        })
      )
    ))

  it.effect("removes stored artifacts idempotently", () =>
    Effect.gen(function*() {
      const archive = yield* SnapshotArchive
      const origin = yield* Effect.promise(startFixtureServer)
      const artifact = yield* archive.capture(`${origin}/`)

      yield* archive.remove(artifact.artifactId)
      const missing = yield* Effect.flip(archive.read(artifact.artifactId))
      yield* archive.remove(artifact.artifactId)

      expect(missing).toBeInstanceOf(SnapshotNotFound)
    }).pipe(
      Effect.provide(FileSystemSnapshotArchive.layer({ root }))
    ))

  it.effect("inlines CSS imported from JavaScript into the frozen page", () =>
    Effect.gen(function*() {
      const archive = yield* SnapshotArchive
      const origin = yield* Effect.promise(startCssImportServer)
      const artifact = yield* archive.capture(`${origin}/`)
      const html = new TextDecoder().decode(yield* archive.read(artifact.artifactId))

      expect(html).toContain("Imported measure")
      expect(decodeModuleScripts(html)).toContain("text-wrap:pretty")
      expect(html).not.toContain('from "./app.css"')
    }).pipe(
      Effect.provide(FileSystemSnapshotArchive.layer({
        root,
        createId: () => "20260808120000-cssimport"
      }))
    ))

  it.effect("recovers from Vite outdated optimize-dep responses", () =>
    Effect.gen(function*() {
      const archive = yield* SnapshotArchive
      const origin = yield* Effect.promise(startOutdatedDepServer)
      const artifact = yield* archive.capture(`${origin}/`)
      const html = new TextDecoder().decode(yield* archive.read(artifact.artifactId))

      expect(html).toContain("stale-dep")
      expect(decodeModuleScripts(html)).toContain("fallback-widget")
    }).pipe(
      Effect.provide(FileSystemSnapshotArchive.layer({
        root,
        createId: () => "20260808120000-outdated"
      }))
    ))

  const decodeModuleScripts = (html: string) =>
    parse(html)
      .querySelectorAll('script[type="module"]')
      .map((script) => script.getAttribute("src")?.split("base64,")[1])
      .filter((encoded): encoded is string => encoded !== undefined)
      .map((encoded) => Buffer.from(encoded, "base64").toString("utf8"))
      .join("\n")

  const startCssImportServer = () =>
    new Promise<string>((resolve, reject) => {
      server = createServer((request, response) => {
        switch (request.url) {
          case "/":
            response.setHeader("Content-Type", "text/html")
            response.end(`<!doctype html><html><head></head><body>
              <main>Imported measure</main>
              <script type="module" src="/app.js"></script></body></html>`)
            return
          case "/app.js":
            response.setHeader("Content-Type", "text/javascript")
            response.end('import "./app.css"; document.body.dataset.ready = "true";')
            return
          case "/app.css":
            response.setHeader("Content-Type", "text/css")
            response.end("main { text-wrap: pretty; }")
            return
          default:
            response.statusCode = 404
            response.end("not found")
        }
      })
      listenFixture(server, resolve, reject)
    })

  const startOutdatedDepServer = () =>
    new Promise<string>((resolve, reject) => {
      server = createServer((request, response) => {
        const url = request.url ?? "/"
        if (url === "/") {
          response.setHeader("Content-Type", "text/html")
          response.end(`<!doctype html><html><head></head><body>
            <main>stale-dep</main>
            <script type="module" src="/app.js"></script></body></html>`)
          return
        }
        if (url === "/app.js") {
          response.setHeader("Content-Type", "text/javascript")
          response.end(
            `import "/@fs/repo/node_modules/.vite/playground/deps/widget.js?v=stale";`
          )
          return
        }
        if (url.startsWith("/@fs/repo/node_modules/.vite/playground/deps/widget.js")) {
          response.statusCode = 504
          response.setHeader("Content-Type", "text/plain")
          response.end("")
          return
        }
        if (url === "/@fs/repo/node_modules/widget/package.json") {
          response.setHeader("Content-Type", "application/json")
          response.end(JSON.stringify({
            name: "widget",
            module: "./dist/index.js",
            exports: { ".": { import: { default: "./dist/index.js" } } }
          }))
          return
        }
        if (url === "/@fs/repo/node_modules/widget/dist/index.js") {
          response.setHeader("Content-Type", "text/javascript")
          response.end('document.documentElement.dataset.widget = "fallback-widget"; export {}')
          return
        }
        response.statusCode = 404
        response.end("not found")
      })
      listenFixture(server, resolve, reject)
    })

  const listenFixture = (
    fixture: Server,
    resolve: (origin: string) => void,
    reject: (cause: unknown) => void
  ) => {
    fixture.once("error", reject)
    fixture.listen(0, "127.0.0.1", () => {
      try {
        resolve(`http://127.0.0.1:${serverPort(fixture)}`)
      } catch (cause) {
        reject(cause)
      }
    })
  }
  it.live("fails once a capture exceeds its overall deadline", () => {
    const pendingSignals: Array<AbortSignal> = []
    const hangingFetch: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal
        if (signal == null) return
        pendingSignals.push(signal)
        signal.addEventListener("abort", () =>
          reject(signal.reason ?? new Error("aborted"))
        )
      })

    return Effect.gen(function*() {
      const archive = yield* SnapshotArchive
      const failure = yield* Effect.flip(
        archive.capture("http://127.0.0.1:9/hangs-forever")
      )

      expect(failure).toMatchObject({
        _tag: "SnapshotCaptureFailed",
        sourceUrl: "http://127.0.0.1:9/hangs-forever"
      })
      expect(failure.detail).toContain("Capture deadline exceeded")
      expect(pendingSignals).toHaveLength(1)
      expect(pendingSignals[0]?.aborted).toBe(true)
    }).pipe(
      Effect.provide(
        FileSystemSnapshotArchive.layer({
          root,
          fetch: hangingFetch,
          captureTimeoutMillis: 100
        })
      )
    )
  })

  const startFixtureServer = () =>
    new Promise<string>((resolve, reject) => {
      server = createServer((request, response) => {
        switch (request.url) {
          case "/":
            response.setHeader("Content-Type", "text/html")
            response.end(`<!doctype html><html><head>
              <link rel="stylesheet" href="/styles.css">
              <style>.inline { padding: 0  4px; }</style>
              </head><body><h1>Frozen   page</h1>
              <pre>  preserve\n  spacing  </pre>
              <textarea>  preserve\n  spacing  </textarea>
              <img src="/pixel.svg" alt="">
              <script>window.fixture = true;</script>
              <script type="module" src="/app.js"></script></body></html>`)
            return
          case "/styles.css":
            response.setHeader("Content-Type", "text/css")
            response.end(
              '/* source comment */ body { color: red; background: url("/pixel.svg"); }'
            )
            return
          case "/app.js":
            response.setHeader("Content-Type", "text/javascript")
            response.end(
              'import { message } from "./dep.js"; document.documentElement.dataset.message = message;'
            )
            return
          case "/dep.js":
            response.setHeader("Content-Type", "text/javascript")
            response.end('export const message = "frozen";')
            return
          case "/pixel.svg":
            response.setHeader("Content-Type", "image/svg+xml")
            response.end(
              '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><path fill="red" d="M0 0h1v1H0z"/></svg>'
            )
            return
          default:
            response.statusCode = 404
            response.end("not found")
        }
      })
      server.once("error", reject)
      server.listen(0, "127.0.0.1", () => {
        if (server === undefined) {
          reject(new Error("Fixture server did not bind"))
          return
        }
        try {
          resolve(`http://127.0.0.1:${serverPort(server)}`)
        } catch (cause) {
          reject(cause)
        }
      })
    })
})
