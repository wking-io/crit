import { readFile, rm, mkdtemp } from "node:fs/promises"
import { createServer as createHttpServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"

import { Effect } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createServer, type ViteDevServer } from "vite"

import { HttpCritClient } from "../../src/http/client.js"
import { CritClientConflict, CritClientNotFound } from "../../src/session/crit-client.js"
import { crit } from "../../src/vite/index.js"

describe("crit Vite plugin", () => {
  let root = ""
  let server: ViteDevServer | undefined
  let httpServer: Server | undefined

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "crit-vite-"))
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

  const start = async (options: Parameters<typeof crit>[0] = {}) => {
    server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [crit(options)],
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

  it("creates, loads, and conditionally saves a real Canvas over HTTP", async () => {
    const origin = await start()
    const client = HttpCritClient.make({ apiPath: `${origin}/__crit/api` })

    const initialLoads = await Promise.all(
      Array.from({ length: 8 }, () =>
        Effect.runPromise(client.load("homepage"))
      )
    )
    const initial = initialLoads[0]!
    const saved = await Effect.runPromise(client.save(initial, 0))
    const stale = await Effect.runPromise(
      Effect.flip(client.save(initial, 0))
    )
    const loaded = await Effect.runPromise(client.load("homepage"))
    const persisted = JSON.parse(
      await readFile(path.join(root, ".crit/canvases/homepage.json"), "utf8")
    ) as { revision: number }
    const methodResponse = await fetch(
      `${origin}/__crit/api/canvases/homepage`,
      { method: "POST" }
    )
    const invalidResponse = await fetch(
      `${origin}/__crit/api/canvases/homepage`,
      {
        method: "PUT",
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
    expect(initialLoads).toHaveLength(8)
    expect(initialLoads.every((document) => document.revision === 0)).toBe(true)
    expect(saved.revision).toBe(1)
    expect(stale).toBeInstanceOf(CritClientConflict)
    expect(stale).toMatchObject({
      id: "homepage",
      expectedRevision: 0,
      currentRevision: 1
    })
    expect(loaded.revision).toBe(1)
    expect(persisted.revision).toBe(1)
    expect(methodResponse.status).toBe(405)
    expect(methodResponse.headers.get("allow")).toBe("GET, PUT")
    expect(invalidResponse.status).toBe(400)
    expect(invalidBody.error.code).toBe("invalid-request")
  })

  it("can require explicit Canvas creation", async () => {
    const origin = await start({ createIfMissing: false })
    const client = HttpCritClient.make({ apiPath: `${origin}/__crit/api` })

    const failure = await Effect.runPromise(
      Effect.flip(client.load("missing"))
    )

    expect(failure).toBeInstanceOf(CritClientNotFound)
    expect(failure).toMatchObject({ id: "missing" })
  })
})
