import { mkdtemp, rm } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"

import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import { Effect, Layer, Path, Stdio, Terminal } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { runCrit } from "../../src/cli/command.js"
import { FileSystemCanvasRepository } from "../../src/node/file-system-canvas-repository.js"
import { TEST_AUTHOR, TestAuthorIdentityLayer } from "../support/author-identity.js"
import { serverPort } from "../support/server-address.js"
import { collectStdout } from "../support/stdout.js"

describe("crit sync", () => {
  let root = ""
  let server: Server | undefined
  let origin = ""
  let stdout: Array<string> = []

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "crit-cli-manifest-"))
    stdout = []
    server = createServer((request, response) => {
      if (request.url !== "/.well-known/crit.json") {
        response.statusCode = 404
        response.end()
        return
      }
      response.setHeader("Content-Type", "application/json")
      response.end(
        JSON.stringify({
          schemaVersion: 1,
          id: "checkout-iterations",
          canvases: [
            {
              id: "checkout-review",
              title: "Checkout review",
              frames: [
                {
                  id: "candidate",
                  url: "/candidate",
                  title: "Candidate",
                  status: "approved"
                }
              ]
            }
          ]
        })
      )
    })
    await new Promise<void>((resolve, reject) => {
      server?.once("error", reject)
      server?.listen(0, "127.0.0.1", resolve)
    })
    origin = `http://127.0.0.1:${serverPort(server)}`
  })

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      if (server === undefined) return resolve()
      server.close((cause) => (cause ? reject(cause) : resolve()))
    })
    server = undefined
    await rm(root, { recursive: true, force: true })
  })

  it("discovers an app origin and creates its complete Canvas", async () => {
    const storeLayer = FileSystemCanvasRepository.layer({ root })
    const cliLayer = Layer.mergeAll(
      TestAuthorIdentityLayer,
      NodeFileSystem.layer,
      Path.layer,
      Stdio.layerTest({
        stdout: () =>
          collectStdout((value) => stdout.push(value))
      }),
      Layer.succeed(
        Terminal.Terminal,
        Terminal.make({
          columns: Effect.succeed(80),
          rows: Effect.succeed(24),
          readInput: Effect.die("unused"),
          readLine: Effect.die("unused"),
          display: () => Effect.void
        })
      ),
      Layer.succeed(
        ChildProcessSpawner.ChildProcessSpawner,
        ChildProcessSpawner.make(() => Effect.die("unused"))
      ),
      storeLayer
    )

    await Effect.runPromise(
      runCrit(["sync", "--from", origin, "--json"]).pipe(
        Effect.provide(cliLayer)
      )
    )
    const synced = JSON.parse(stdout.join(""))
    stdout = []
    await Effect.runPromise(
      runCrit(["open", "checkout-review", "--json"]).pipe(
        Effect.provide(cliLayer)
      )
    )
    const opened = JSON.parse(stdout.join(""))

    expect(synced).toMatchObject({
      schemaVersion: 1,
      command: "sync",
      manifestId: "checkout-iterations",
      canvases: [
        {
          id: "checkout-review",
          action: "created",
          addedFrameIds: ["candidate"]
        }
      ]
    })
    expect(opened.frames).toMatchObject([
      {
        id: "candidate",
        url: `${origin}/candidate`,
        status: "approved"
      }
    ])
    expect(opened.owner).toEqual(TEST_AUTHOR)
  })
})
