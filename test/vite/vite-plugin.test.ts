import { execFile } from "node:child_process"
import { readFile, rm, mkdtemp, writeFile } from "node:fs/promises"
import { createServer as createHttpServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import { Effect } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createServer, type ViteDevServer } from "vite"

import { canvasLiveRefreshSocketUrl } from "../../src/browser/canvas-live-refresh.js"
import { HttpCritClient } from "../../src/http/client.js"
import { Canvas, CanvasCommand } from "../../src/core/index.js"
import { FileSystemAgentActivity } from "../../src/node/file-system-agent-activity.js"
import { FileSystemCanvasRepository } from "../../src/node/file-system-canvas-repository.js"
import { CanvasRepository } from "../../src/runtime/canvas-repository.js"
import {
  CritClientCommandFailed,
  CritClientNotFound
} from "../../src/session/crit-client.js"
import { crit } from "../../src/vite/index.js"
import { TEST_AUTHOR } from "../support/author-identity.js"

const execFileAsync = promisify(execFile)

describe("crit Vite plugin", () => {
  let root = ""
  let server: ViteDevServer | undefined
  let httpServer: Server | undefined

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "crit-vite-"))
    await execFileAsync("git", ["init"], { cwd: root })
    await execFileAsync("git", ["config", "user.name", TEST_AUTHOR.name], {
      cwd: root
    })
    await execFileAsync("git", ["config", "user.email", "test@example.com"], {
      cwd: root
    })
  })

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      if (httpServer === undefined) return resolve()
      httpServer.close((cause) => (cause ? reject(cause) : resolve()))
    })
    httpServer = undefined
    await server?.close()
    server = undefined
    await rm(root, { recursive: true, force: true })
  })

  const start = async (
    options: Parameters<typeof crit>[0] = {},
    viteRoot = root
  ) => {
    server = await createServer({
      root: viteRoot,
      configFile: false,
      logLevel: "silent",
      plugins: [crit(options)],
      optimizeDeps: { noDiscovery: true, include: [] },
      server: { middlewareMode: true }
    })
    httpServer = createHttpServer(server.middlewares)
    await new Promise<void>((resolve, reject) => {
      httpServer?.once("error", reject)
      httpServer?.listen(0, "127.0.0.1", resolve)
    })
    const address = httpServer.address() as AddressInfo
    return `http://127.0.0.1:${address.port}`
  }

  const createCanvas = (id: string, title = id) =>
    Effect.runPromise(
      Effect.flatMap(CanvasRepository, (documents) =>
        documents.create(
          Canvas.export(Canvas.create({ id, title, owner: TEST_AUTHOR }))
        )
      ).pipe(Effect.provide(FileSystemCanvasRepository.layer({ root })))
    )

  it("loads and applies commands to an explicitly created Canvas over HTTP", async () => {
    await createCanvas("homepage")
    const origin = await start()
    const client = HttpCritClient.make({ apiPath: `${origin}/__crit/api` })
    const currentAuthor = await Effect.runPromise(client.currentAuthor())
    const editorResponse = await fetch(`${origin}/crit/homepage`)
    const editorHtml = await editorResponse.text()
    const activityStore = FileSystemAgentActivity.make({ root })
    await Effect.runPromise(activityStore.signal({
      canvasId: "homepage",
      activityId: "codex-1",
      harness: "Codex",
      detail: "Agent is arranging Frames"
    }))
    const activity = await Effect.runPromise(client.activities!("homepage"))

    const initialLoads = await Promise.all(
      Array.from({ length: 8 }, () =>
        Effect.runPromise(client.load("homepage"))
      )
    )
    const initial = initialLoads[0]!
    const saved = await Effect.runPromise(client.apply("homepage", [
      CanvasCommand.addNote({
        id: "note",
        text: "Review this",
        author: { id: "author", name: "Test Author" },
        x: 10,
        y: 20
      })
    ]))
    const second = await Effect.runPromise(client.apply("homepage", [
      CanvasCommand.moveNote({ id: "note", x: 30, y: 40 })
    ]))
    const updated = await Effect.runPromise(client.apply("homepage", [
      CanvasCommand.editNote({
        id: "note",
        actorId: "author",
        expectedText: "Review this",
        text: "Agent updated this"
      })
    ]))
    const stale = await Effect.runPromise(Effect.flip(client.apply("homepage", [
      CanvasCommand.editNote({
        id: "note",
        actorId: "author",
        expectedText: "Review this",
        text: "Browser updated this"
      })
    ])))
    const loaded = await Effect.runPromise(client.load("homepage"))
    const persisted = JSON.parse(
      await readFile(path.join(root, ".crit/canvases/homepage.json"), "utf8")
    ) as { revision: number }
    const methodResponse = await fetch(
      `${origin}/__crit/api/canvases/homepage`,
      { method: "PUT" }
    )
    const invalidResponse = await fetch(
      `${origin}/__crit/api/canvases/homepage`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      }
    )
    const invalidBody = (await invalidResponse.json()) as {
      error: { code: string }
    }

    expect(initial).toMatchObject({
      format: "crit-canvas",
      id: "homepage",
      title: "homepage",
      revision: 0
    })
    expect(currentAuthor.name).toBe(TEST_AUTHOR.name)
    expect(editorResponse.status).toBe(200)
    expect(editorResponse.headers.get("content-type")).toContain("text/html")
    expect(editorHtml).toContain("<title>Crit · homepage</title>")
    expect(editorHtml).toContain('src="/@id/virtual:crit-editor.js"')
    expect(editorHtml).toContain("overflow:hidden;overscroll-behavior:none")
    expect(editorHtml).toContain("overscroll-behavior-x:none")
    expect(editorHtml).toContain("data-crit-live-refresh=")
    expect(activity).toMatchObject({
      canvasId: "homepage",
      activities: [{
        activityId: "codex-1",
        harness: "Codex",
        detail: "Agent is arranging Frames"
      }]
    })
    expect(initialLoads).toHaveLength(8)
    expect(initialLoads.every((document) => document.revision === 0)).toBe(true)
    expect(saved.revision).toBe(1)
    expect(second.revision).toBe(2)
    expect(updated.revision).toBe(3)
    expect(stale).toBeInstanceOf(CritClientCommandFailed)
    expect(stale).toMatchObject({ reason: "note-conflict" })
    expect(loaded.revision).toBe(3)
    expect(persisted.revision).toBe(3)
    expect(methodResponse.status).toBe(405)
    expect(methodResponse.headers.get("allow")).toBe("GET, PATCH")
    expect(invalidResponse.status).toBe(400)
    expect(invalidBody.error.code).toBe("invalid-request")
  })

  it("loads the development editor through Vite's watched module graph", async () => {
    const origin = await start({ root }, process.cwd())
    const editorHtml = await (await fetch(`${origin}/crit/homepage`, {
      headers: { Connection: "close" }
    })).text()

    expect(editorHtml).toContain('src="/@id/virtual:crit-editor.js"')

    const editorModuleResponse = await fetch(
      `${origin}/@id/virtual:crit-editor.js`
    )
    const editorModule = await editorModuleResponse.text()
    expect(editorModuleResponse.status).toBe(200)
    expect(editorModule).toContain("/@vite/client")
    expect(editorModule).toContain("Frame chrome")
    expect(editorModule).toContain("titleMinimumCharacters")
    expect(editorModule).toContain("Camera")
    expect(editorModule).toContain("panSpeed")
    expect(editorModule).toContain("zoomSpeed")
    expect(editorModule).toContain("bottom-right")
    expect(editorModule).toContain('frameLoading: {"strategy":"navigate"}')
  })

  it("serializes the configured Frame loading policy into the editor", async () => {
    const origin = await start({
      root,
      frameLoading: "parent-fetch",
      publicOrigin: "https://portal.example/some/path?ignored=true#fragment"
    }, process.cwd())
    const editorModule = await (await fetch(
      `${origin}/@id/virtual:crit-editor.js`
    )).text()

    expect(editorModule).toContain('frameLoading: {"strategy":"parent-fetch","aliasOrigin":"https://portal.example"}')
  })

  it("pushes Canvas change hints to the served editor over the HMR WebSocket", async () => {
    // Mirror the served editor: attach Vite's HMR socket to the page origin,
    // read the endpoint the plugin injects into the editor HTML, and connect
    // the way the editor bundle does.
    await createCanvas("homepage")
    httpServer = createHttpServer()
    server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [crit()],
      server: { middlewareMode: true, hmr: { server: httpServer } }
    })
    httpServer.on("request", server.middlewares)
    await new Promise<void>((resolve, reject) => {
      httpServer?.once("error", reject)
      httpServer?.listen(0, "127.0.0.1", resolve)
    })
    const port = (httpServer.address() as AddressInfo).port
    const origin = `http://127.0.0.1:${port}`
    const client = HttpCritClient.make({ apiPath: `${origin}/__crit/api` })
    await Effect.runPromise(client.load("homepage"))

    const editorPage = await (await fetch(`${origin}/crit/homepage`)).text()
    const encodedEndpoint = editorPage.match(
      /data-crit-live-refresh="([^"]*)"/
    )?.[1]
    expect(encodedEndpoint).toBeDefined()
    const endpoint = JSON.parse(
      encodedEndpoint!
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
    ) as { enabled?: boolean; token?: string }

    const socket = new WebSocket(
      canvasLiveRefreshSocketUrl(endpoint, {
        protocol: "http:",
        hostname: "127.0.0.1",
        port: String(port)
      }),
      "vite-hmr"
    )
    const hint = new Promise<{ data?: { id?: string } }>((resolve, reject) => {
      socket.addEventListener("message", (message) => {
        const payload = JSON.parse(String(message.data)) as {
          type?: string
          event?: string
          data?: { id?: string }
        }
        if (payload.type === "custom" && payload.event === "crit:canvas-changed") {
          resolve(payload)
        }
      })
      socket.addEventListener("error", () =>
        reject(new Error("The live refresh socket failed to connect"))
      )
    })
    await new Promise<void>((resolve) =>
      socket.addEventListener("open", () => resolve())
    )
    await Effect.runPromise(client.apply("homepage", [
      CanvasCommand.addNote({
        id: "note",
        text: "Ping",
        author: { id: "author", name: "Test Author" },
        x: 0,
        y: 0
      })
    ]))
    const payload = await hint
    socket.close()

    expect(endpoint.enabled).toBe(true)
    expect(typeof endpoint.token).toBe("string")
    expect(payload.data?.id).toBe("homepage")
  })

  it("requires explicit Canvas creation", async () => {
    const origin = await start()
    const client = HttpCritClient.make({ apiPath: `${origin}/__crit/api` })

    const failure = await Effect.runPromise(
      Effect.flip(client.load("missing"))
    )

    expect(failure).toBeInstanceOf(CritClientNotFound)
    expect(failure).toMatchObject({ id: "missing" })
  })

  it("injects a cross-origin Frame input bridge into served apps", async () => {
    await writeFile(
      path.join(root, "index.html"),
      "<!doctype html><html><head></head><body>Frame app</body></html>"
    )
    const origin = await start()

    const response = await fetch(origin)
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain("@riff-refine/crit/frame-input")
    expect(html).toContain('addEventListener("keydown"')
    expect(html).toContain("relay.hotkey")
    expect(html).toContain('type: "tool"')
    expect(html).toContain('type: "zoom-step"')
    expect(html).toContain('addEventListener("pointerdown"')
    expect(html).toContain('addEventListener("wheel"')
    expect(html).toContain("relay.wheel(event)")
    expect(html).toContain("decision.handled")
    expect(html).toContain('addEventListener("gesturechange"')
    expect(html).toContain('addEventListener("touchmove"')
    expect(html).toContain("relay.touchMove")
    expect(html).toContain('type: "pinch"')
    expect(html).toContain("event.preventDefault()")
    expect(html).toContain("window.parent.postMessage")
  })

  it("publishes the project manifest without trusting forwarded headers or creating on load", async () => {
    await writeFile(
      path.join(root, "crit.manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        id: "storefront",
        canvases: [
          {
            id: "default",
            title: "Storefront review",
            frames: [
              {
                id: "app",
                url: "/checkout",
                title: "Checkout",
                status: "changes-requested"
              }
            ]
          }
        ]
      })
    )
    const origin = await start()
    const forwardedHeaders = {
      "x-forwarded-host": "crit.example",
      "x-forwarded-proto": "https"
    }
    const manifestResponse = await fetch(`${origin}/.well-known/crit.json`, {
      headers: forwardedHeaders
    })
    const manifest = await manifestResponse.json() as {
      canvases: Array<{ frames: Array<{ url: string }> }>
    }
    const client = HttpCritClient.make({ apiPath: `${origin}/__crit/api` })
    const failure = await Effect.runPromise(Effect.flip(client.load("default")))

    expect(manifestResponse.status).toBe(200)
    expect(manifest.canvases[0]?.frames[0]?.url).toBe(`${origin}/checkout`)
    expect(failure).toBeInstanceOf(CritClientNotFound)
  })

  it("uses publicOrigin for the published manifest without forwarded headers", async () => {
    await writeFile(
      path.join(root, "crit.manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        id: "orb",
        canvases: [{
          id: "default",
          title: "Orb review",
          frames: [{
            id: "app",
            url: "/frames/ready",
            title: "Ready",
            status: "changes-requested"
          }]
        }]
      })
    )
    const origin = await start({ publicOrigin: "https://portal.example" })
    const headers = { Host: "32043-sandbox.e2b.app" }
    const manifestResponse = await fetch(`${origin}/.well-known/crit.json`, { headers })
    const manifest = await manifestResponse.json() as {
      canvases: Array<{ frames: Array<{ url: string }> }>
    }
    expect(manifest.canvases[0]?.frames[0]?.url).toBe(
      "https://portal.example/frames/ready"
    )
  })

  it("captures and serves an immutable self-contained Frame snapshot", async () => {
    await writeFile(
      path.join(root, "index.html"),
      '<!doctype html><html><head><link rel="stylesheet" href="/app.css"></head><body><main id="app">Snapshot fixture</main><script type="module" src="/app.js"></script></body></html>'
    )
    await writeFile(
      path.join(root, "app.css"),
      "#app { color: rgb(12, 34, 56); }"
    )
    await writeFile(
      path.join(root, "app.js"),
      'document.querySelector("#app").dataset.ready = "true"'
    )
    await createCanvas("review")
    const origin = await start()
    const client = HttpCritClient.make({ apiPath: `${origin}/__crit/api` })
    await Effect.runPromise(client.load("review"))
    await Effect.runPromise(
      client.apply("review", [
        CanvasCommand.addFrame({
          id: "candidate",
          url: `${origin}/`,
          title: "Candidate",
          provenance: { kind: "manual", sourceId: "test" }
        })
      ])
    )

    const saved = await Effect.runPromise(client.snapshot!("review", "candidate"))
    const archived = saved.frames.at(-1)!
    const response = await fetch(`${origin}${archived.url}`)
    const html = await response.text()
    const missingResponse = await fetch(`${origin}/__crit/snapshots/missing`)
    const persisted = await readFile(
      path.join(root, ".crit/snapshots", `${archived.snapshot!.artifactId}.html`),
      "utf8"
    )
    const encodedCss = html.match(
      /href="data:text\/css;charset=utf-8;base64,([^"]+)"/
    )?.[1]

    expect(archived).toMatchObject({
      status: "archived",
      provenance: { kind: "snapshot", sourceId: "candidate" },
      snapshot: { sourceUrl: `${origin}/` }
    })
    expect(response.status).toBe(200)
    expect(missingResponse.status).toBe(404)
    expect(response.headers.get("cache-control")).toContain("immutable")
    expect(html).toBe(persisted)
    expect(html).toContain("Snapshot fixture")
    expect(encodedCss).toBeDefined()
    expect(Buffer.from(encodedCss!, "base64").toString("utf8")).toContain(
      "#0c2238"
    )
    expect(html).not.toContain('href="/app.css"')
    expect(html).not.toContain('src="/app.js"')
  })
})
