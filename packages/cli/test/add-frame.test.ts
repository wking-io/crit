import { spawn, spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Id } from "@crit/domain"
import { Result } from "effect"
import { afterEach, describe, expect, it } from "vitest"

import { applicationFrameCommand, nextFrameGeometry } from "../src/add-frame.js"

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

describe("applicationFrameCommand", () => {
  it("derives the last route segment when title is empty", () => {
    const command = applicationFrameCommand({
      applicationId,
      route: "/checkout",
      title: "",
      frameId,
      geometry: nextFrameGeometry(0)
    })
    expect(Result.isSuccess(command)).toBe(true)
    if (Result.isFailure(command)) return
    expect(command.success.title).toBe("checkout")
    expect(command.success.representation).toEqual({
      _tag: "application-route",
      applicationId,
      route: "/checkout"
    })
  })

  it("keeps an explicit title", () => {
    const command = applicationFrameCommand({
      applicationId,
      route: "/checkout",
      title: "Checkout",
      frameId,
      geometry: nextFrameGeometry(0)
    })
    expect(Result.isSuccess(command)).toBe(true)
    if (Result.isFailure(command)) return
    expect(command.success.title).toBe("Checkout")
  })

  it("titles a root route Untitled frame", () => {
    const command = applicationFrameCommand({
      applicationId,
      route: "/",
      title: "",
      frameId,
      geometry: nextFrameGeometry(0)
    })
    expect(Result.isSuccess(command)).toBe(true)
    if (Result.isFailure(command)) return
    expect(command.success.title).toBe("Untitled frame")
  })

  it("rejects a route that is not rooted", () => {
    const command = applicationFrameCommand({
      applicationId,
      route: "products",
      title: "",
      frameId,
      geometry: nextFrameGeometry(0)
    })
    expect(Result.isFailure(command)).toBe(true)
    if (Result.isSuccess(command)) return
    expect(command.failure.reason.length).toBeGreaterThan(0)
  })
})

describe("nextFrameGeometry", () => {
  it("tiles the first three Frames", () => {
    expect(nextFrameGeometry(0)).toEqual({ x: 0, y: 0, width: 1200, height: 800 })
    expect(nextFrameGeometry(1)).toEqual({ x: 1240, y: 0, width: 1200, height: 800 })
    expect(nextFrameGeometry(3)).toEqual({ x: 0, y: 840, width: 1200, height: 800 })
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

  it("prints the minted Frame id and route", async() => {
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
      "--route",
      "products"
    ])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("Invalid route: products")
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
      "--route",
      "/checkout",
      "--root",
      directory
    ])
    expect(stopped.status).not.toBe(0)
    expect(stopped.stderr).toBe("Crit daemon is stopped\n")
  })
})
