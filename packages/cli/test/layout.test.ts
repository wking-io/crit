import { spawn, spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  CanvasEngine,
  CanvasTitle,
  decodeCanvasChange,
  emptyCanvasProjection,
  Id
} from "@crit/domain"
import { Schema } from "effect"
import { afterEach, describe, expect, it } from "vitest"

import { canvasLayout, formatCanvasLayout } from "../src/layout.js"

const canvasId = Id.canvas("canvas_layout")
const title = Schema.decodeUnknownSync(CanvasTitle)("Board")

const populated = () => {
  const result = CanvasEngine.apply(
    emptyCanvasProjection(canvasId, title),
    decodeCanvasChange({
      canvasId,
      changeId: "change_layout",
      commands: [
        {
          _tag: "addFrame",
          frameId: "frame_checkout",
          title: "Checkout",
          representation: {
            _tag: "applicationRoute",
            applicationId: "application_storefront",
            route: "/checkout"
          },
          status: "in-progress",
          geometry: { x: 0, y: 0, width: 1200, height: 800 }
        },
      ]
    })
  )
  if (result._tag !== "applied") {
    throw new Error(`expected applied projection, received ${result._tag}`)
  }
  return result.projection
}

describe("canvasLayout", () => {
  it("lists Frame geometry", () => {
    const layout = canvasLayout(populated())
    expect(layout).toEqual({
      canvasId,
      title,
      items: [
        {
          _tag: "frame",
          frameId: "frame_checkout",
          title: "Checkout",
          geometry: { x: 0, y: 0, width: 1200, height: 800 },
          representation: "applicationRoute"
        }
      ]
    })
    expect(formatCanvasLayout(layout)).toBe([
      "canvas_layout  Board",
      "frame  frame_checkout  Checkout  0 0 1200 800"
    ].join("\n"))
  })

  it("prints only the canvas line when empty", () => {
    expect(formatCanvasLayout(canvasLayout(emptyCanvasProjection(canvasId, title)))).toBe(
      "canvas_layout  Board"
    )
  })
})

const directories: Array<string> = []
const children: Array<ReturnType<typeof spawn>> = []

afterEach(() => {
  for (const child of children.splice(0)) child.kill("SIGKILL")
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

const matchReady = (output: string) => output.includes("Crit daemon listening at http://127.0.0.1:")

const startWithoutBrowser = (dataRoot: string) => new Promise<{
  readonly child: ReturnType<typeof spawn>
}>((resolve, reject) => {
  const child = spawn(process.execPath, [
    join(import.meta.dirname, "..", "dist", "main.js"),
    "dev",
    "--no-host",
    "--data-root",
    dataRoot
  ], { stdio: ["ignore", "pipe", "pipe"] })
  children.push(child)
  let output = ""
  const timeout = setTimeout(() => reject(new Error(`Timed out waiting for daemon: ${output}`)), 5_000)
  child.stdout.on("data", (chunk: Uint8Array) => {
    output += Buffer.from(chunk).toString("utf8")
    if (!matchReady(output)) return
    clearTimeout(timeout)
    setImmediate(() => resolve({ child }))
  })
  child.stderr.on("data", (chunk: Uint8Array) => {
    output += Buffer.from(chunk).toString("utf8")
  })
  child.once("error", (cause) => {
    clearTimeout(timeout)
    reject(cause)
  })
})

const stop = (child: ReturnType<typeof spawn>) => new Promise<void>((resolve, reject) => {
  child.once("error", reject)
  child.once("exit", (code, signal) => {
    const index = children.indexOf(child)
    if (index >= 0) children.splice(index, 1)
    return signal === "SIGINT" || code === 130
      ? resolve()
      : reject(new Error(`Expected SIGINT exit, received code=${code} signal=${signal}`))
  })
  child.kill("SIGINT")
})

const run = (dataRoot: string, args: ReadonlyArray<string>) => spawnSync(process.execPath, [
  join(import.meta.dirname, "..", "dist", "main.js"),
  ...args,
  "--data-root",
  dataRoot
], { encoding: "utf8" })

describe("built crit-target layout", () => {
  it("prints current Frame geometry", async() => {
    const directory = mkdtempSync(join(tmpdir(), "crit-cli-layout-"))
    directories.push(directory)
    const dataRoot = join(directory, ".crit", "v1")
    expect(spawnSync(process.execPath, [
      join(import.meta.dirname, "..", "dist", "main.js"),
      "init",
      "--root",
      directory
    ], { encoding: "utf8" }).status).toBe(0)
    const started = await startWithoutBrowser(dataRoot)
    expect(run(dataRoot, ["create", "canvas_cli_layout", "--title", "Board"]).status).toBe(0)
    expect(run(dataRoot, [
      "add-frame",
      "canvas_cli_layout",
      "--type",
      "webUrl",
      "--url",
      "https://example.com/pricing",
      "--title",
      "Pricing",
      "--x",
      "80",
      "--y",
      "40"
    ]).status).toBe(0)

    const human = run(dataRoot, ["layout", "canvas_cli_layout"])
    expect(human.status, human.stderr).toBe(0)
    expect(human.stdout).toMatch(
      /^canvas_cli_layout  Board\nframe  frame_[a-f0-9]{32}  Pricing  80 40 1200 800\n$/
    )

    const encoded = run(dataRoot, ["layout", "canvas_cli_layout", "--json"])
    expect(encoded.status, encoded.stderr).toBe(0)
    const layout = JSON.parse(encoded.stdout)
    expect(layout.canvasId).toBe("canvas_cli_layout")
    expect(layout.title).toBe("Board")
    expect(layout.items).toHaveLength(1)
    expect(layout.items[0]._tag).toBe("frame")
    expect(layout.items[0].title).toBe("Pricing")
    expect(layout.items[0].representation).toBe("webUrl")
    expect(layout.items[0].geometry).toEqual({ x: 80, y: 40, width: 1200, height: 800 })
    await stop(started.child)
  })
})
