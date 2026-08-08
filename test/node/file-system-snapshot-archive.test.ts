import { mkdtemp, rm } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { parse } from "node-html-parser"

import { FileSystemSnapshotArchive } from "../../src/node/file-system-snapshot-archive.js"
import { SnapshotArchive } from "../../src/runtime/snapshot-archive.js"

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

  const startFixtureServer = () =>
    new Promise<string>((resolve, reject) => {
      server = createServer((request, response) => {
        switch (request.url) {
          case "/":
            response.setHeader("Content-Type", "text/html")
            response.end(`<!doctype html><html><head>
              <link rel="stylesheet" href="/styles.css">
              <style>.inline { padding: 0  4px; }</style>
              </head><body><h1>Frozen page</h1><img src="/pixel.svg" alt="">
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
        const address = server?.address()
        if (address === null || address === undefined || typeof address === "string") {
          reject(new Error("Fixture server did not bind"))
          return
        }
        resolve(`http://127.0.0.1:${address.port}`)
      })
    })
})
