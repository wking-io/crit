import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import { Effect, Layer, Path, Sink, Stdio, Terminal } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { runCrit } from "../../src/cli/command.js"
import { FileSystemDocumentStore } from "../../src/node/file-system-document-store.js"
import { CritRuntimeLive } from "../../src/runtime/crit-runtime.js"

describe("crit init", () => {
  let root = ""
  let stdout: Array<string> = []

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "crit-cli-init-"))
    stdout = []
    await writeFile(
      path.join(root, "package.json"),
      `${JSON.stringify(
        {
          name: "fixture",
          dependencies: { react: "19.2.0", vite: "7.3.6" }
        },
        null,
        2
      )}\n`
    )
    await writeFile(
      path.join(root, "vite.config.ts"),
      `import { defineConfig } from "vite"

export default defineConfig({})
`
    )
    await mkdir(path.join(root, "src"), { recursive: true })
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it("exposes the initializer through the CLI with machine-readable output", async () => {
    const storeLayer = FileSystemDocumentStore.layer({ root })
    const runtimeLayer = CritRuntimeLive.pipe(Layer.provide(storeLayer))
    const cliLayer = Layer.mergeAll(
      NodeFileSystem.layer,
      Path.layer,
      Stdio.layerTest({
        stdout: () =>
          Sink.forEach((chunk: string | Uint8Array) =>
            Effect.sync(() => {
              stdout.push(
                typeof chunk === "string"
                  ? chunk
                  : new TextDecoder().decode(chunk)
              )
            })
          )
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
        ChildProcessSpawner.make(() => Effect.die("install must be skipped"))
      ),
      storeLayer,
      runtimeLayer
    )

    await Effect.runPromise(
      runCrit([
        "init",
        "--root",
        root,
        "--skip-install",
        "--json"
      ]).pipe(Effect.provide(cliLayer))
    )

    const output = JSON.parse(stdout.join("")) as {
      schemaVersion: number
      installed: boolean
      project: string
      install: { command: string; args: string[] }
    }
    const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"))

    expect(output).toMatchObject({
      schemaVersion: 1,
      installed: false,
      project: "vite-react",
      install: { command: "npm", args: ["install"] }
    })
    expect(packageJson.dependencies["@riff-refine/crit"]).toBe("^0.0.0")
  })
})
