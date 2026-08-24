import { spawn, spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  ApplicationRouteRepresentation,
  ArtifactRepresentation,
  AuthoredText,
  Id,
  RootedRoute,
  Sha256Digest,
  WebUrlRepresentation
} from "@crit/domain"
import { Option, Result, Schema } from "effect"
import { afterEach, describe, expect, it } from "vitest"

import {
  DEFAULT_FRAME_HEIGHT,
  DEFAULT_FRAME_WIDTH,
  frameCommand,
  frameSourceLabel,
  inferredFrameTitle,
  inferredTitle,
  inferredWebUrlTitle,
  nextFrameGeometry,
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

const applicationId = Id.application("application_storefront")
const frameId = Id.frame("frame_checkout")
const checkout = Schema.decodeUnknownSync(RootedRoute)("/checkout")
const home = Schema.decodeUnknownSync(RootedRoute)("/")
const checkoutTitle = Schema.decodeUnknownSync(AuthoredText)("Checkout")
const pricingUrl = Schema.decodeUnknownSync(WebUrlRepresentation)({
  _tag: "web-url",
  url: "https://example.com/pricing"
}).url
const digest = Schema.decodeUnknownSync(Sha256Digest)(
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
)
const none = Option.none<number>()

describe("inferredFrameTitle", () => {
  it("uses the last route segment", () => {
    expect(inferredFrameTitle(checkout)).toBe("checkout")
  })

  it("titles a root route Untitled frame", () => {
    expect(inferredFrameTitle(home)).toBe("Untitled frame")
  })
})

describe("inferredTitle", () => {
  it("uses the last web-url path segment", () => {
    expect(inferredWebUrlTitle(pricingUrl)).toBe("pricing")
    expect(inferredTitle(WebUrlRepresentation.make({ url: pricingUrl }))).toBe("pricing")
  })

  it("titles an artifact Untitled frame", () => {
    expect(inferredTitle(ArtifactRepresentation.make({
      artifactId: Id.artifact("artifact_capture"),
      digest
    }))).toBe("Untitled frame")
  })
})

describe("frameCommand", () => {
  it("stores the given representation", () => {
    const representation = ApplicationRouteRepresentation.make({
      applicationId,
      route: checkout
    })
    const command = frameCommand({
      frameId,
      title: inferredTitle(representation),
      representation,
      geometry: nextFrameGeometry({
        frameCount: 0,
        width: DEFAULT_FRAME_WIDTH,
        height: DEFAULT_FRAME_HEIGHT
      })
    })
    expect(command.title).toBe("checkout")
    expect(command.representation).toEqual(representation)
    expect(frameSourceLabel(representation)).toBe("/checkout")
  })

  it("keeps an explicit title", () => {
    const representation = ApplicationRouteRepresentation.make({
      applicationId,
      route: checkout
    })
    const command = frameCommand({
      frameId,
      title: checkoutTitle,
      representation,
      geometry: nextFrameGeometry({
        frameCount: 0,
        width: DEFAULT_FRAME_WIDTH,
        height: DEFAULT_FRAME_HEIGHT
      })
    })
    expect(command.title).toBe("Checkout")
  })
})

describe("nextFrameGeometry", () => {
  it("tiles the first three Frames", () => {
    expect(nextFrameGeometry({
      frameCount: 0,
      width: DEFAULT_FRAME_WIDTH,
      height: DEFAULT_FRAME_HEIGHT
    })).toEqual({ x: 0, y: 0, width: 1200, height: 800 })
    expect(nextFrameGeometry({
      frameCount: 1,
      width: DEFAULT_FRAME_WIDTH,
      height: DEFAULT_FRAME_HEIGHT
    })).toEqual({ x: 1240, y: 0, width: 1200, height: 800 })
    expect(nextFrameGeometry({
      frameCount: 3,
      width: DEFAULT_FRAME_WIDTH,
      height: DEFAULT_FRAME_HEIGHT
    })).toEqual({ x: 0, y: 840, width: 1200, height: 800 })
  })
})

describe("resolveFrameGeometry", () => {
  it("uses an explicit position", () => {
    const geometry = resolveFrameGeometry({
      frameCount: 4,
      x: Option.some(80),
      y: Option.some(120),
      width: Option.some(640),
      height: Option.some(480)
    })
    expect(Result.getOrThrow(geometry)).toEqual({ x: 80, y: 120, width: 640, height: 480 })
  })

  it("rejects a partial position", () => {
    expect(Option.getOrUndefined(Result.getFailure(resolveFrameGeometry({
      frameCount: 0,
      x: Option.some(80),
      y: none,
      width: none,
      height: none
    })))).toBe("x and y must be set together")
  })

  it("rejects a non-positive size", () => {
    expect(Option.getOrUndefined(Result.getFailure(resolveFrameGeometry({
      frameCount: 0,
      x: Option.some(0),
      y: Option.some(0),
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
    expect(frame.title).toBe("checkout")
    expect(frame.geometry).toEqual({ x: 0, y: 0, width: 1200, height: 800 })
    expect(frame.frameId).toMatch(/^frame_[a-f0-9]{32}$/)

    const second = run(dataRoot, [
      "add-frame",
      "canvas_cli_frames",
      "--type",
      "application-route",
      "--route",
      "/about",
      "--title",
      "About",
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
      "--title",
      "Pricing",
      "--x",
      "80",
      "--y",
      "40",
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
      "--json"
    ])
    expect(added.status, added.stderr).toBe(0)
    const frame = JSON.parse(added.stdout).projection.frames[0]
    expect(frame.representation).toEqual({
      _tag: "artifact",
      artifactId: "artifact_capture",
      digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    })
    expect(frame.title).toBe("Untitled frame")
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
      "products"
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
      "http://localhost:3000/app"
    ])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("Invalid url: http://localhost:3000/app")
  })

  it("rejects x without y before talking to the daemon", () => {
    const result = run(join(tmpdir(), "crit-cli-add-frame-partial-xy"), [
      "add-frame",
      "canvas_cli_frames",
      "--type",
      "web-url",
      "--url",
      "https://example.com/pricing",
      "--x",
      "80"
    ])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("x and y must be set together")
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
      "--root",
      directory
    ])
    expect(stopped.status).not.toBe(0)
    expect(stopped.stderr).toBe("Crit daemon is stopped\n")
  })
})
