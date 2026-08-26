import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Schema } from "effect"
import { afterEach, describe, expect, it, onTestFinished } from "vitest"

const directories: Array<string> = []
const children: Array<ReturnType<typeof spawn>> = []
const TcpAddress = Schema.Struct({ port: Schema.Number })
const InstallationSecret = Schema.Struct({ bearerSecret: Schema.String })

afterEach(() => {
  for (const child of children.splice(0)) child.kill("SIGKILL")
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

const start = (dataRoot: string) => new Promise<{
  readonly child: ReturnType<typeof spawn>
  readonly baseUrl: string
  readonly browserBootstrapUrl: string
}>((resolve, reject) => {
  const child = spawn(process.execPath, [
    join(import.meta.dirname, "..", "dist", "main.js"),
    "dev",
    "--data-root",
    dataRoot,
    "--browser-origin",
    "http://127.0.0.1:5173"
  ], { stdio: ["ignore", "pipe", "pipe"] })
  children.push(child)
  let output = ""
  const timeout = setTimeout(() => {
    child.kill("SIGKILL")
    reject(new Error(`Timed out waiting for daemon readiness: ${output}`))
  }, 5_000)
  child.stdout.on("data", (chunk: Uint8Array) => {
    output += Buffer.from(chunk).toString("utf8")
    const daemonMatch = /Crit daemon listening at (http:\/\/127\.0\.0\.1:\d+)/.exec(output)
    const browserMatch = /Open Crit in your browser: (http:\/\/127\.0\.0\.1:\d+\/browser\/[0-9a-f]{32}\/#[-_A-Za-z0-9]+)/.exec(output)
    if (daemonMatch?.[1] === undefined || browserMatch?.[1] === undefined) return
    clearTimeout(timeout)
    resolve({ child, baseUrl: daemonMatch[1], browserBootstrapUrl: browserMatch[1] })
  })
  child.stderr.on("data", (chunk: Uint8Array) => {
    output += Buffer.from(chunk).toString("utf8")
  })
  child.once("error", (cause) => {
    clearTimeout(timeout)
    reject(cause)
  })
  child.once("exit", (code, signal) => {
    if (matchReady(output)) return
    clearTimeout(timeout)
    reject(new Error(`Daemon exited before readiness with code=${code} signal=${signal}: ${output}`))
  })
})

const matchReady = (output: string) => output.includes("Crit daemon listening at http://127.0.0.1:")

const startWithoutBrowser = (dataRoot: string, environment?: NodeJS.ProcessEnv) => new Promise<{
  readonly child: ReturnType<typeof spawn>
  readonly baseUrl: string
  readonly output: string
}>((resolve, reject) => {
  const child = spawn(process.execPath, [
    join(import.meta.dirname, "..", "dist", "main.js"),
    "dev",
    "--no-host",
    "--data-root",
    dataRoot
  ], { stdio: ["ignore", "pipe", "pipe"], env: environment })
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

const startWithApplication = (dataRoot: string, root: string, applicationOrigin: string) => new Promise<{
  readonly child: ReturnType<typeof spawn>
  readonly baseUrl: string
}>((resolve, reject) => {
  const child = spawn(process.execPath, [
    join(import.meta.dirname, "..", "dist", "main.js"),
    "dev",
    "--no-host",
    "--data-root",
    dataRoot,
    "--root",
    root,
    "--application-origin",
    applicationOrigin
  ], { stdio: ["ignore", "pipe", "pipe"] })
  children.push(child)
  let output = ""
  const timeout = setTimeout(() => reject(new Error(`Timed out waiting for daemon: ${output}`)), 5_000)
  child.stdout.on("data", (chunk: Uint8Array) => {
    output += Buffer.from(chunk).toString("utf8")
    const match = /Crit daemon listening at (http:\/\/127\.0\.0\.1:\d+)/.exec(output)
    if (match?.[1] === undefined) return
    clearTimeout(timeout)
    resolve({ child, baseUrl: match[1] })
  })
  child.stderr.on("data", (chunk: Uint8Array) => {
    output += Buffer.from(chunk).toString("utf8")
  })
  child.once("error", reject)
  child.once("exit", (code, signal) => reject(
    new Error(`Daemon exited before readiness with code=${code} signal=${signal}: ${output}`)
  ))
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

const runAsync = (dataRoot: string, args: ReadonlyArray<string>, environment: NodeJS.ProcessEnv) =>
  new Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [
      join(import.meta.dirname, "..", "dist", "main.js"),
      ...args,
      "--data-root",
      dataRoot
    ], { stdio: ["ignore", "pipe", "pipe"], env: environment })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk: Uint8Array) => {
      stdout += Buffer.from(chunk).toString("utf8")
    })
    child.stderr.on("data", (chunk: Uint8Array) => {
      stderr += Buffer.from(chunk).toString("utf8")
    })
    child.once("error", reject)
    child.once("exit", (code) => resolve({ code, stdout, stderr }))
  })

describe("built crit-target dev", () => {
  it("starts the host and prints a browser bootstrap URL", async() => {
    const directory = mkdtempSync(join(tmpdir(), "crit-cli-loop-"))
    directories.push(directory)
    const dataRoot = join(directory, ".crit", "v1")
    const child = spawn(process.execPath, [
      join(import.meta.dirname, "..", "dist", "main.js"),
      "dev",
      "--data-root",
      dataRoot
    ], { stdio: ["ignore", "pipe", "pipe"] })
    children.push(child)
    let output = ""
    const started = await new Promise<{
      readonly baseUrl: string
      readonly browserBootstrapUrl: string
    }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill("SIGKILL")
        reject(new Error(`Timed out waiting for local loop: ${output}`))
      }, 12_000)
      child.stdout.on("data", (chunk: Uint8Array) => {
        output += Buffer.from(chunk).toString("utf8")
        const daemonMatch = /Crit daemon listening at (http:\/\/127\.0\.0\.1:\d+)/.exec(output)
        const browserMatch = /Open Crit in your browser: (http:\/\/127\.0\.0\.1:\d+\/browser\/[0-9a-f]{32}\/#[-_A-Za-z0-9]+)/.exec(output)
        if (daemonMatch?.[1] === undefined || browserMatch?.[1] === undefined) return
        clearTimeout(timeout)
        resolve({ baseUrl: daemonMatch[1], browserBootstrapUrl: browserMatch[1] })
      })
      child.stderr.on("data", (chunk: Uint8Array) => {
        output += Buffer.from(chunk).toString("utf8")
      })
      child.once("error", (cause) => {
        clearTimeout(timeout)
        reject(cause)
      })
    })
    const page = await fetch("http://127.0.0.1:5173/")
    expect(page.status).toBe(200)
    expect(await page.text()).toContain("id=\"root\"")
    const canvasPage = await fetch("http://127.0.0.1:5173/canvas/canvas_shop")
    expect(canvasPage.status).toBe(200)
    expect(await canvasPage.text()).toContain("id=\"root\"")
    expect(started.browserBootstrapUrl).toContain(started.baseUrl)
    await stop(child)
  })

  it("binds the initialized project application through the real transport", async () => {
    const directory = mkdtempSync(join(tmpdir(), "crit-cli-application-"))
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
    const started = await startWithApplication(dataRoot, directory, "http://127.0.0.1:5173/")
    const installation = Schema.decodeUnknownSync(InstallationSecret)(
      JSON.parse(readFileSync(join(dataRoot, "installation.json"), "utf8"))
    )
    const response = await fetch(`${started.baseUrl}/api/v1/representations/resolve`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${installation.bearerSecret}`,
        "content-type": "application/json",
        "x-crit-api-version": "1"
      },
      body: JSON.stringify({
        _tag: "resolveRepresentation",
        schemaVersion: 1,
        representation: { _tag: "applicationRoute", applicationId, route: "/products" }
      })
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      _tag: "iframe",
      url: "http://127.0.0.1:5173/products"
    })
    await stop(started.child)
  })

  it("rejects an invalid application origin before creating daemon state", () => {
    const directory = mkdtempSync(join(tmpdir(), "crit-cli-invalid-application-"))
    directories.push(directory)
    const dataRoot = join(directory, ".crit", "v1")
    const result = run(dataRoot, [
      "dev",
      "--root",
      directory,
      "--application-origin",
      "http://127.0.0.1:5173"
    ])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("Invalid application origin")
    expect(existsSync(dataRoot)).toBe(false)
  })

  it("rejects a missing project manifest before creating daemon state", () => {
    const directory = mkdtempSync(join(tmpdir(), "crit-cli-missing-manifest-"))
    directories.push(directory)
    const dataRoot = join(directory, ".crit", "v1")
    const result = run(dataRoot, [
      "dev",
      "--no-host",
      "--root",
      directory,
      "--application-origin",
      "http://127.0.0.1:5173/"
    ])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("LocalDevelopmentFailure")
    expect(existsSync(dataRoot)).toBe(false)
  })

  it("exports Effect traces and flushes on exit", async () => {
    const payloads: Array<{ readonly path: string; readonly body: string }> = []
    const collector = createServer((request, response) => {
      let body = ""
      request.setEncoding("utf8")
      request.on("data", (chunk: string) => {
        body += chunk
      })
      request.on("end", () => {
        payloads.push({ path: request.url ?? "", body })
        response.writeHead(200).end()
      })
    })
    await new Promise<void>((resolve, reject) => {
      collector.once("error", reject)
      collector.listen(0, "127.0.0.1", resolve)
    })
    const closeCollector = () => new Promise<void>((resolve, reject) => {
      if (!collector.listening) return resolve()
      collector.close((cause) => cause === undefined ? resolve() : reject(cause))
    })
    onTestFinished(closeCollector)
    const address = Schema.decodeUnknownSync(TcpAddress)(collector.address())
    const directory = mkdtempSync(join(tmpdir(), "crit-cli-otlp-private-canary-"))
    directories.push(directory)
    const dataRoot = join(directory, ".crit", "v1")
    const environment = {
      ...process.env,
      OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${address.port}`,
      OTEL_TRACES_EXPORTER: "otlp",
      OTEL_SERVICE_VERSION: "test-version"
    }
    const started = await startWithoutBrowser(dataRoot, environment)
    const status = await runAsync(dataRoot, ["status"], environment)
    expect(status.code, status.stderr).toBe(0)
    const missing = await runAsync(dataRoot, ["open", "canvas_private_canary"], environment)
    expect(missing.code).not.toBe(0)
    await stop(started.child)
    await closeCollector()

    expect(payloads.some(({ path }) => path === "/v1/traces")).toBe(true)
    expect(payloads.every(({ path }) => path === "/v1/traces")).toBe(true)
    const serialized = JSON.stringify(payloads)
    expect(serialized).toContain("http.client GET")
    expect(serialized).toContain("http.server GET")
    expect(serialized).toContain("crit.replica.open")
    expect(serialized).toContain("sql.execute")
    expect(serialized).toContain("test-version")
    expect(payloads.some(({ body }) => body.includes('"code":2'))).toBe(true)
    const installation = Schema.decodeUnknownSync(InstallationSecret)(
      JSON.parse(readFileSync(join(dataRoot, "installation.json"), "utf8"))
    )
    expect(serialized).not.toContain(installation.bearerSecret)
  })

  it("does not mint or print browser bootstrap access without configuration", async () => {
    const directory = mkdtempSync(join(tmpdir(), "crit-cli-dev-no-browser-"))
    directories.push(directory)
    const started = await startWithoutBrowser(join(directory, ".crit", "v1"))
    expect(started.output).not.toContain("Open Crit in your browser")
    await stop(started.child)
  })

  it("releases its stable port and descriptor on interrupt", async () => {
    const directory = mkdtempSync(join(tmpdir(), "crit-cli-dev-"))
    directories.push(directory)
    const dataRoot = join(directory, ".crit", "v1")
    const first = await start(dataRoot)
    const descriptorPath = join(dataRoot, "daemon.json")
    expect(existsSync(descriptorPath)).toBe(true)
    const firstDescriptor = readFileSync(descriptorPath, "utf8")
    expect(readFileSync(descriptorPath, "utf8")).not.toContain("bearerSecret")
    expect(readFileSync(descriptorPath, "utf8")).not.toContain(
      new URL(first.browserBootstrapUrl).hash.slice(1)
    )
    const status = run(dataRoot, ["status", "--json"])
    expect(status.status).toBe(0)
    expect(JSON.parse(status.stdout)).toMatchObject({ kind: "Running" })
    const created = run(dataRoot, ["create", "canvas_cli_flow", "--title", "CLI Flow", "--json"])
    expect(created.status, created.stderr).toBe(0)
    expect(JSON.parse(created.stdout).projection.title).toBe("CLI Flow")
    const duplicate = run(dataRoot, ["create", "canvas_cli_flow", "--title", "Duplicate"])
    expect(duplicate.status).not.toBe(0)
    expect(duplicate.stderr).toBe("Canvas already exists: canvas_cli_flow\n")
    const missing = run(dataRoot, ["open", "canvas_cli_missing"])
    expect(missing.status).not.toBe(0)
    expect(missing.stderr).toBe("Canvas not found: canvas_cli_missing\n")
    const opened = run(dataRoot, ["open", "canvas_cli_flow", "--json"])
    expect(opened.status, opened.stderr).toBe(0)
    expect(JSON.parse(opened.stdout).projection.canvasId).toBe("canvas_cli_flow")
    await stop(first.child)
    expect(existsSync(descriptorPath)).toBe(false)
    const stopped = run(dataRoot, ["status"])
    expect(stopped.status).not.toBe(0)
    expect(stopped.stdout).toBe("")
    expect(stopped.stderr).toBe("Crit daemon is stopped\n")

    writeFileSync(descriptorPath, firstDescriptor)
    const stale = run(dataRoot, ["status"])
    expect(stale.status).not.toBe(0)
    expect(stale.stdout).toBe("")
    expect(stale.stderr).toBe("Crit daemon is unavailable (connection-failed)\n")
    expect(readFileSync(descriptorPath, "utf8")).toBe(firstDescriptor)

    const restarted = await start(dataRoot)
    expect(restarted.baseUrl).toBe(first.baseUrl)
    expect(restarted.browserBootstrapUrl).not.toBe(first.browserBootstrapUrl)
    const reopened = run(dataRoot, ["open", "canvas_cli_flow", "--json"])
    expect(reopened.status, reopened.stderr).toBe(0)
    expect(JSON.parse(reopened.stdout).projection.title).toBe("CLI Flow")
    await stop(restarted.child)
    expect(existsSync(descriptorPath)).toBe(false)
  })

  it("reports malformed discovery state once without exposing stored secrets", () => {
    const directory = mkdtempSync(join(tmpdir(), "crit-cli-malformed-"))
    directories.push(directory)
    const dataRoot = join(directory, ".crit", "v1")
    mkdirSync(dataRoot, { recursive: true })
    writeFileSync(join(dataRoot, "installation.json"), '{"bearerSecret":"do-not-report"}')
    const status = run(dataRoot, ["status"])
    expect(status.status).not.toBe(0)
    expect(status.stdout).toBe("")
    expect(status.stderr).toBe("Crit daemon state is malformed\n")
    expect(status.stderr).not.toContain("do-not-report")
  })
})
