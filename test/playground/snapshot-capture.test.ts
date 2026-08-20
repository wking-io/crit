import { rm } from "node:fs/promises"
import { createServer as createHttpServer } from "node:http"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"
import { Effect } from "effect"
import { createServer, type ViteDevServer } from "vite"

import { Canvas, CanvasCommand } from "../../src/core/index.js"
import { HttpCritClient } from "../../src/http/client.js"
import { FileSystemCanvasRepository } from "../../src/node/file-system-canvas-repository.js"
import { CanvasRepository } from "../../src/runtime/canvas-repository.js"
import { TEST_AUTHOR } from "../support/author-identity.js"
import { serverPort } from "../support/server-address.js"

const playgroundRoot = path.resolve("playground")
const canvasId = "snapshot-capture-lab"
const frameId = "prototype-eyes-randomized"

const canvasPath = path.join(
  playgroundRoot,
  ".crit/canvases",
  `${canvasId}.json`
)

describe("playground snapshot capture", () => {
  let vite: ViteDevServer | undefined
  let http: ReturnType<typeof createHttpServer> | undefined

  afterEach(async () => {
    if (http?.listening) {
      await new Promise<void>((resolve, reject) => {
        http?.close((cause) => (cause ? reject(cause) : resolve()))
      })
    }
    http = undefined
    await vite?.close()
    vite = undefined
    await rm(canvasPath, { force: true })
    await rm(`${canvasPath}.lock`, { force: true })
  })

  it("archives the randomized-eyes prototype as a snapshot Frame", async () => {
    await rm(canvasPath, { force: true })
    await rm(`${canvasPath}.lock`, { force: true })
    await Effect.runPromise(
      Effect.flatMap(CanvasRepository, (documents) =>
        documents.create(
          Canvas.export(Canvas.create({
            id: canvasId,
            title: "Snapshot capture lab",
            owner: TEST_AUTHOR
          }))
        )
      ).pipe(Effect.provide(FileSystemCanvasRepository.layer({ root: playgroundRoot })))
    )

    vite = await createServer({
      configFile: path.resolve("playground/vite.config.ts"),
      logLevel: "silent",
      server: { middlewareMode: true, hmr: false }
    })
    http = createHttpServer(vite.middlewares)
    await new Promise<void>((resolve, reject) => {
      http?.once("error", reject)
      http?.listen(0, "127.0.0.1", resolve)
    })
    const origin = `http://127.0.0.1:${serverPort(http)}`
    const { client, snapshots } = HttpCritClient.make({
      apiPath: `${origin}/__crit/api`
    })
    await Effect.runPromise(client.load(canvasId))
    await Effect.runPromise(
      client.apply(canvasId, [
        CanvasCommand.addFrame({
          id: frameId,
          url: `${origin}/ui/prototypes/eyes-randomized`,
          title: "Randomized Eye Systems",
          provenance: { kind: "manual", sourceId: "snapshot-capture" }
        })
      ])
    )

    const page = await fetch(`${origin}/ui/prototypes/eyes-randomized`)
    expect(page.status).toBe(200)

    const saved = await Effect.runPromise(
      snapshots.snapshot(canvasId, frameId)
    )
    const archived = saved.frames.find((frame) =>
      frame.provenance.kind === "snapshot" &&
      frame.provenance.sourceId === frameId
    )
    const html = archived === undefined
      ? ""
      : await (await fetch(`${origin}${archived.url}`)).text()
    const bundled = [...html.matchAll(
      /src="data:text\/javascript;charset=utf-8;base64,([^"]+)"/g
    )].map((match) => Buffer.from(match[1]!, "base64").toString("utf8")).join("\n")

    expect(saved.frames).toHaveLength(2)
    expect(archived).toMatchObject({
      status: "archived",
      provenance: { kind: "snapshot", sourceId: frameId }
    })
    expect(html).toContain("id=\"root\"")
    expect(bundled).toContain("Randomized eye systems")
    if (archived?.snapshot !== undefined) {
      await rm(
        path.join(
          playgroundRoot,
          ".crit/snapshots",
          `${archived.snapshot.artifactId}.html`
        ),
        { force: true }
      )
    }
  }, 120_000)
})
