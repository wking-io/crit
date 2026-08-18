import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import { Effect, Layer, Path, Schema, Stdio, Terminal } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { runCrit } from "../../src/cli/command.js"
import { FileSystemCanvasRepository } from "../../src/node/file-system-canvas-repository.js"
import { TEST_AUTHOR, TestAuthorIdentityLayer } from "../support/author-identity.js"
import { collectStdout } from "../support/stdout.js"

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
        ChildProcessSpawner.make(() => Effect.die("install must be skipped"))
      ),
      storeLayer
    )

    await Effect.runPromise(
      runCrit(["identity", "--root", root, "--json"]).pipe(
        Effect.provide(cliLayer)
      )
    )
    expect(JSON.parse(stdout.join(""))).toEqual({
      schemaVersion: 1,
      command: "identity",
      author: TEST_AUTHOR
    })
    stdout = []

    await Effect.runPromise(
      runCrit([
        "init",
        "--root",
        root,
        "--skip-install",
        "--json"
      ]).pipe(Effect.provide(cliLayer))
    )

    const output = Schema.decodeUnknownSync(Schema.Struct({
      schemaVersion: Schema.Number,
      installed: Schema.Boolean,
      project: Schema.String,
      author: Schema.Struct({
        id: Schema.String,
        name: Schema.String
      }),
      install: Schema.Struct({
        command: Schema.String,
        args: Schema.Array(Schema.String)
      })
    }))(JSON.parse(stdout.join("")))
    const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"))

    expect(output).toMatchObject({
      schemaVersion: 1,
      installed: false,
      project: "vite-react",
      install: { command: "npm", args: ["install"] }
    })
    expect(output).toMatchObject({ author: TEST_AUTHOR })
    expect(packageJson.dependencies["@riff-refine/crit"]).toBe("^0.1.0-alpha.0")
  })
})
