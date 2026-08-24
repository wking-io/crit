import { spawn, spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  ApplicationRouteRepresentation,
  AuthoredText,
  Geometry,
  Id,
  RootedRoute
} from "@crit/domain"
import { Option, Result, Schema } from "effect"
import { afterEach, describe, expect, it } from "vitest"

import {
  frameCommand,
  frameSourceLabel,
  resolveFrameGeometry
} from "../src/add-frame.js"

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
  readonly baseUrl: string
  readonly output: string
}>((resolve, reject) => {
  const child = spawn(process.execPath, [
    join(import.meta.dirname, "..", "dist", "main.js"),
    "dev",
    "--data-root",
    dataRoot
  ], { stdio: ["ignore", "pipe", "pipe"] })
  children.push(child)
  let output = ""
  const timeout = setTimeout(() => reject(new Error(`Timed out waiting for daemon: ${output}`)), 5_000)
  child.stdout.on("data", (chunk: Uint8Array) => {
    output += Buffer.from(chunk).toString("utf8")
    if (!matchReady(output)) return
    const match = /Crit daemon listening at (http:\/\/127\.0\.0\.1:\d+)/.exec(output)
    if (match?.[1] === undefined) return
    clearTimeout(timeout)
    setImmediate(() => resolve({ child, baseUrl: match[1], output }))
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

const placed = (title: string, x: string, y: string): Array<string> => [
  "--title",
  title,
  "--x",
  x,
  "--y",
  y
]

const applicationId = Id.application("application_storefront")
const frameId = Id.frame("frame_checkout")
const checkout = Schema.decodeUnknownSync(RootedRoute)("/checkout")
const checkoutTitle = Schema.decodeUnknownSync(AuthoredText)("Checkout")
const origin = Geometry.make({ x: 0, y: 0, width: 1200, height: 800 })
const none = Option.none<number>()

describe("frameCommand", () => {
  it("stores the given representation and title", () => {
    const representation = ApplicationRouteRepresentation.make({
      applicationId,
      route: checkout
    })
    const command = frameCommand({
      frameId,
      title: checkoutTitle,
      representation,
      geometry: origin
    })
    expect(command.title).toBe("Checkout")
    expect(command.representation).toEqual(representation)
    expect(frameSourceLabel(representation)).toBe("/checkout")
  })
})

describe("resolveFrameGeometry", () => {
  it("uses an explicit position and size", () => {
    expect(Result.getOrThrow(resolveFrameGeometry({
      x: 80,
      y: 120,
      width: Option.some(640),
      height: Option.some(480)
    }))).toEqual({ x: 80, y: 120, width: 640, height: 480 })
  })

  it("defaults width and height", () => {
    expect(Result.getOrThrow(resolveFrameGeometry({
      x: 80,
      y: 40,
      width: none,
      height: none
    }))).toEqual({ x: 80, y: 40, width: 1200, height: 800 })
  })

  it("rejects a non-positive size", () => {
    expect(Option.getOrUndefined(Result.getFailure(resolveFrameGeometry({
      x: 0,
      y: 0,
      width: Option.some(0),
      height: none
    })))).toBe("Invalid geometry")
  })
})

describe("built crit-target add-frame", () => {
  it("adds an application-route Frame from the project manifest", async() => {
    const directory = mkdtempSync(join(tmpdir(), "crit-cli-add-frame-"))
    directories.push(directory)
    const dataRoot = join(directory, ".crit", "v1")
    const initialized = spawnSync(process.execPath, [
      join(import.meta.dirname, "..", "dist", "main.js"),
      "init",
      "--root",
      directory,
      "--json"
    ], { encoding: "utf8" })
    expect(initialized.status, initialized.stderr).toBe(0)
    const applicationId = JSON.parse(initialized.stdout).manifest.applicationId
    const started = await startWithoutBrowser(dataRoot)
    const created = run(dataRoot, ["create", "canvas_cli_frames", "--title", "Frames"])
    expect(created.status, created.stderr).toBe(0)
    const added = run(dataRoot, [
      "add-frame",
      "canvas_cli_frames",
      "--type",
      "application-route",
      "--route",
      "/checkout",
      ...placed("Checkout", "0", "0"),
      "--root",
      directory,
      "--json"
    ])
    expect(added.status, added.stderr).toBe(0)
    const view = JSON.parse(added.stdout)
    expect(view.projection.frames).toHaveLength(1)
    const frame = view.projection.frames[0]
    expect(frame.representation._tag).toBe("application-route")
    expect(frame.representation.applicationId).toBe(applicationId)
    expect(frame.representation.route).toBe("/checkout")
    expect(frame.title).toBe("Checkout")
    expect(frame.geometry).toEqual({ x: 0, y: 0, width: 1200, height: 800 })
    expect(frame.frameId).toMatch(/^frame_[a-f0-9]{32}$/)

    const second = run(dataRoot, [
      "add-frame",
      "canvas_cli_frames",
      "--type",
      "application-route",
      "--route",
      "/about",
      ...placed("About", "1240", "0"),
      "--root",
      directory,
      "--json"
    ])
    expect(second.status, second.stderr).toBe(0)
    const about = JSON.parse(second.stdout).projection.frames.find(
      (candidate: { representation: { route: string } }) => candidate.representation.route === "/about"
    )
    expect(about.title).toBe("About")
    expect(about.geometry).toEqual({ x: 1240, y: 0, width: 1200, height: 800 })
    await stop(started.child)
  })

  it("adds a web-url Frame at an explicit position", async() => {
    const directory = mkdtempSync(join(tmpdir(), "crit-cli-add-frame-url-"))
    directories.push(directory)
    const dataRoot = join(directory, ".crit", "v1")
    expect(spawnSync(process.execPath, [
      join(import.meta.dirname, "..", "dist", "main.js"),
      "init",
      "--root",
      directory
    ], { encoding: "utf8" }).status).toBe(0)
    const started = await startWithoutBrowser(dataRoot)
    expect(run(dataRoot, ["create", "canvas_cli_frames", "--title", "Frames"]).status).toBe(0)
    const added = run(dataRoot, [
      "add-frame",
      "canvas_cli_frames",
      "--type",
      "web-url",
      "--url",
      "https://example.com/pricing",
      ...placed("Pricing", "80", "40"),
      "--width",
      "640",
      "--height",
      "480",
      "--json"
    ])
    expect(added.status, added.stderr).toBe(0)
    const frame = JSON.parse(added.stdout).projection.frames[0]
    expect(frame.representation).toEqual({
      _tag: "web-url",
      url: "https://example.com/pricing"
    })
    expect(frame.title).toBe("Pricing")
    expect(frame.geometry).toEqual({ x: 80, y: 40, width: 640, height: 480 })
    await stop(started.child)
  })

  it("adds an artifact Frame", async() => {
    const directory = mkdtempSync(join(tmpdir(), "crit-cli-add-frame-artifact-"))
    directories.push(directory)
    const dataRoot = join(directory, ".crit", "v1")
    expect(spawnSync(process.execPath, [
      join(import.meta.dirname, "..", "dist", "main.js"),
      "init",
      "--root",
      directory
    ], { encoding: "utf8" }).status).toBe(0)
    const started = await startWithoutBrowser(dataRoot)
    expect(run(dataRoot, ["create", "canvas_cli_frames", "--title", "Frames"]).status).toBe(0)
    const added = run(dataRoot, [
      "add-frame",
      "canvas_cli_frames",
      "--type",
      "artifact",
      "--artifact-id",
      "artifact_capture",
      "--digest",
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ...placed("Capture", "0", "0"),
      "--json"
    ])
    expect(added.status, added.stderr).toBe(0)
    const frame = JSON.parse(added.stdout).projection.frames[0]
    expect(frame.representation).toEqual({
      _tag: "artifact",
      artifactId: "artifact_capture",
      digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    })
    expect(frame.title).toBe("Capture")
    await stop(started.child)
  })

  it("prints the minted Frame id and source", async() => {
    const directory = mkdtempSync(join(tmpdir(), "crit-cli-add-frame-human-"))
    directories.push(directory)
    const dataRoot = join(directory, ".crit", "v1")
    const initialized = spawnSync(process.execPath, [
      join(import.meta.dirname, "..", "dist", "main.js"),
      "init",
      "--root",
      directory
    ], { encoding: "utf8" })
    expect(initialized.status, initialized.stderr).toBe(0)
    const started = await startWithoutBrowser(dataRoot)
    expect(run(dataRoot, ["create", "canvas_cli_frames", "--title", "Frames"]).status).toBe(0)
    const added = run(dataRoot, [
      "add-frame",
      "canvas_cli_frames",
      "--type",
      "application-route",
      "--route",
      "/checkout",
      ...placed("Checkout", "0", "0"),
      "--root",
      directory
    ])
    expect(added.status, added.stderr).toBe(0)
    expect(added.stdout).toMatch(/^frame_[a-f0-9]{32}  \/checkout\n$/)
    await stop(started.child)
  })

  it("reports a missing Canvas", async() => {
    const directory = mkdtempSync(join(tmpdir(), "crit-cli-add-frame-missing-"))
    directories.push(directory)
    const dataRoot = join(directory, ".crit", "v1")
    const initialized = spawnSync(process.execPath, [
      join(import.meta.dirname, "..", "dist", "main.js"),
      "init",
      "--root",
      directory
    ], { encoding: "utf8" })
    expect(initialized.status, initialized.stderr).toBe(0)
    const started = await startWithoutBrowser(dataRoot)
    const missing = run(dataRoot, [
      "add-frame",
      "canvas_cli_missing",
      "--type",
      "application-route",
      "--route",
      "/checkout",
      ...placed("Checkout", "0", "0"),
      "--root",
      directory
    ])
    expect(missing.status).not.toBe(0)
    expect(missing.stderr).toBe("Canvas not found: canvas_cli_missing\n")
    await stop(started.child)
  })

  it("rejects an unrooted route before talking to the daemon", () => {
    const result = run(join(tmpdir(), "crit-cli-add-frame-unused"), [
      "add-frame",
      "canvas_cli_frames",
      "--type",
      "application-route",
      "--route",
      "products",
      ...placed("Products", "0", "0")
    ])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("Invalid route: products")
  })

  it("rejects a localhost web-url", () => {
    const result = run(join(tmpdir(), "crit-cli-add-frame-localhost"), [
      "add-frame",
      "canvas_cli_frames",
      "--type",
      "web-url",
      "--url",
      "http://localhost:3000/app",
      ...placed("App", "0", "0")
    ])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("Invalid url: http://localhost:3000/app")
  })

  it("rejects a missing title before talking to the daemon", () => {
    const result = run(join(tmpdir(), "crit-cli-add-frame-no-title"), [
      "add-frame",
      "canvas_cli_frames",
      "--type",
      "web-url",
      "--url",
      "https://example.com/pricing",
      "--x",
      "80",
      "--y",
      "40"
    ])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("--title")
  })

  it("rejects a missing position before talking to the daemon", () => {
    const result = run(join(tmpdir(), "crit-cli-add-frame-no-xy"), [
      "add-frame",
      "canvas_cli_frames",
      "--type",
      "web-url",
      "--url",
      "https://example.com/pricing",
      "--title",
      "Pricing"
    ])
    expect(result.status).not.toBe(0)
    expect(result.stderr.toLowerCase()).toMatch(/--x|--y/)
  })

  it("rejects invalid geometry before talking to the daemon", () => {
    const result = run(join(tmpdir(), "crit-cli-add-frame-bad-size"), [
      "add-frame",
      "canvas_cli_frames",
      "--type",
      "web-url",
      "--url",
      "https://example.com/pricing",
      ...placed("Pricing", "0", "0"),
      "--width",
      "0"
    ])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toBe("Invalid geometry\n")
  })

  it("reports a stopped daemon", async() => {
    const directory = mkdtempSync(join(tmpdir(), "crit-cli-add-frame-stopped-"))
    directories.push(directory)
    const dataRoot = join(directory, ".crit", "v1")
    const initialized = spawnSync(process.execPath, [
      join(import.meta.dirname, "..", "dist", "main.js"),
      "init",
      "--root",
      directory
    ], { encoding: "utf8" })
    expect(initialized.status, initialized.stderr).toBe(0)
    const started = await startWithoutBrowser(dataRoot)
    await stop(started.child)
    const stopped = run(dataRoot, [
      "add-frame",
      "canvas_cli_frames",
      "--type",
      "application-route",
      "--route",
      "/checkout",
      ...placed("Checkout", "0", "0"),
      "--root",
      directory
    ])
    expect(stopped.status).not.toBe(0)
    expect(stopped.stderr).toBe("Crit daemon is stopped\n")
  })
})
