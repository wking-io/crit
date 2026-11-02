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
  for (const child of children.splice(0)) {
    child.kill("SIGKILL")
    child.unref()
  }
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
    const browserMatch = /Open Crit in your browser: (http:\/\/127\.0\.0\.1:\d+\/browser\/[0-9a-f]{32}\/#[-_A-Za-z0-9]+)/.exec(output)
    if (browserMatch?.[1] === undefined) return
    const descriptorPath = join(dataRoot, "daemon.json")
    if (!existsSync(descriptorPath)) return
    const descriptor = Schema.decodeUnknownSync(Schema.Struct({
      baseUrl: Schema.String.check(Schema.isPattern(/^http:\/\/127\.0\.0\.1:[0-9]+$/))
    }))(JSON.parse(readFileSync(descriptorPath, "utf8")))
    clearTimeout(timeout)
    resolve({ child, baseUrl: descriptor.baseUrl, browserBootstrapUrl: browserMatch[1] })
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

const startWithProject = (
  dataRoot: string,
  root: string,
  applicationOrigin?: string
) => new Promise<{
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
    ...(applicationOrigin === undefined ? [] : ["--application-origin", applicationOrigin])
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

const startWithApplication = (dataRoot: string, root: string, applicationOrigin: string) =>
  startWithProject(dataRoot, root, applicationOrigin)

const InstallationDescriptor = Schema.Struct({
  bearerSecret: Schema.String
})
const DaemonDescriptor = Schema.Struct({
  instance: Schema.String,
  baseUrl: Schema.String
})

const resolveApplication = async (
  baseUrl: string,
  dataRoot: string,
  applicationId: string,
  route = "/products"
) => {
  const installation = Schema.decodeUnknownSync(InstallationDescriptor)(
    JSON.parse(readFileSync(join(dataRoot, "installation.json"), "utf8"))
  )
  const response = await fetch(`${baseUrl}/api/v1/representations/resolve`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${installation.bearerSecret}`,
      "content-type": "application/json",
      "x-crit-api-version": "1"
    },
    body: JSON.stringify({
      _tag: "resolveRepresentation",
      schemaVersion: 1,
      representation: { _tag: "applicationRoute", applicationId, route }
    })
  })
  return {
    status: response.status,
    body: await response.json()
  }
}

const announceApplication = async (
  dataRoot: string,
  applicationId: string,
  origin: string,
  instance?: string
) => {
  const descriptor = Schema.decodeUnknownSync(DaemonDescriptor)(
    JSON.parse(readFileSync(join(dataRoot, "daemon.json"), "utf8"))
  )
  return fetch(`${descriptor.baseUrl}/api/v1/applications/announce`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-crit-api-version": "1"
    },
    body: JSON.stringify({
      schemaVersion: 1,
      applicationId,
      origin,
      instance: instance ?? descriptor.instance
    })
  })
}

const initializeProject = (directory: string) => {
  const initialized = spawnSync(process.execPath, [
    join(import.meta.dirname, "..", "dist", "main.js"),
    "init",
    "--root",
    directory,
    "--json"
  ], { encoding: "utf8" })
  expect(initialized.status, initialized.stderr).toBe(0)
  return JSON.parse(initialized.stdout).manifest.applicationId as string
}

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

const startDefault = async(dataRoot: string) => {
  const port = await new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = Schema.decodeUnknownSync(TcpAddress)(server.address())
      server.close(() => resolve(address.port))
    })
  })
  return new Promise<{
  readonly child: ReturnType<typeof spawn>
  readonly output: string
  readonly listenOrigin: string
}>((resolve, reject) => {
  const child = spawn(process.execPath, [
    join(import.meta.dirname, "..", "dist", "main.js"),
    "dev",
    "--data-root",
    dataRoot
  ], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(port), PORTLESS_URL: "https://crit-test.localhost" }
  })
  children.push(child)
  let output = ""
  const timeout = setTimeout(() => {
    child.kill("SIGKILL")
    reject(new Error(`Timed out waiting for integrated host: ${output}`))
  }, 20_000)
  const settle = () => {
    if (!output.includes("Crit is at https://crit-test.localhost")) return
    clearTimeout(timeout)
    setImmediate(() => resolve({ child, output, listenOrigin: `http://127.0.0.1:${port}` }))
  }
  child.stdout.on("data", (chunk: Uint8Array) => {
    output += Buffer.from(chunk).toString("utf8")
    settle()
  })
  child.stderr.on("data", (chunk: Uint8Array) => {
    output += Buffer.from(chunk).toString("utf8")
  })
  child.once("error", (cause) => {
    clearTimeout(timeout)
    reject(cause)
  })
})

}

describe("built crit-target dev", () => {
  it("uses the assigned port and public origin, proxies HTTP and WebSockets, and restarts", async() => {
    const directory = mkdtempSync(join(tmpdir(), "crit-cli-loop-"))
    directories.push(directory)
    const dataRoot = join(directory, ".crit", "v1")
    const started = await startDefault(dataRoot)
    expect(started.output).toContain("Crit is at https://crit-test.localhost")
    expect(started.output).not.toMatch(/\/browser\/[0-9a-f]{32}\/#/)
    expect(started.output).not.toContain("Open Crit in your browser")
    const page = await fetch(`${started.listenOrigin}/`)
    expect(page.status).toBe(200)
    const pageText = await page.text()
    expect(pageText).toContain("id=\"root\"")
    expect(pageText).toContain("id=\"crit-host-runtime\"")
    expect(pageText).toContain("\"kind\":\"integrated\"")
    const connection = await fetch(`${started.listenOrigin}/__crit/connection`)
    expect(connection.status).toBe(200)
    expect(connection.headers.get("cache-control")).toBe("no-store")
    expect(await connection.json()).toEqual({ kind: "integrated", apiBase: "/__crit/" })
    const canvasPage = await fetch(`${started.listenOrigin}/canvas/canvas_shop`)
    expect(canvasPage.status).toBe(200)
    expect(await canvasPage.text()).toContain("id=\"root\"")
    const listed = await fetch(`${started.listenOrigin}/__crit/api/v1/canvas`, {
      headers: { "x-crit-api-version": "1" }
    })
    expect(listed.status).toBe(200)
    expect(Array.isArray(await listed.json())).toBe(true)
    const created = run(dataRoot, ["create", "canvas_integrated_socket", "--title", "Socket test"])
    expect(created.status, created.stderr).toBe(0)
    const socket = new WebSocket(
      `${started.listenOrigin.replace("http:", "ws:")}/__crit/api/v1/subscribe/canvas_integrated_socket`
    )
    const socketFrame = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.close()
        reject(new Error("Timed out waiting for integrated subscription readiness"))
      }, 5_000)
      socket.addEventListener("message", (event) => {
        clearTimeout(timeout)
        resolve(String(event.data))
      }, { once: true })
      socket.addEventListener("error", () => {
        clearTimeout(timeout)
        reject(new Error("Integrated subscription WebSocket failed"))
      }, { once: true })
    })
    expect(JSON.parse(socketFrame)).toMatchObject({
      kind: "subscription-ready",
      canvasId: "canvas_integrated_socket"
    })
    const shutdownStarted = Date.now()
    await stop(started.child)
    expect(Date.now() - shutdownStarted).toBeLessThan(3_000)
    socket.close()

    const restarted = await startDefault(dataRoot)
    expect(restarted.output).toContain("Crit is at https://crit-test.localhost")
    expect(restarted.output).not.toMatch(/\/browser\/[0-9a-f]{32}\/#/)
    const refreshed = await fetch(`${restarted.listenOrigin}/`)
    expect(refreshed.status).toBe(200)
    const relisted = await fetch(`${restarted.listenOrigin}/__crit/api/v1/canvas`, {
      headers: { "x-crit-api-version": "1" }
    })
    expect(relisted.status).toBe(200)
    await stop(restarted.child)
  }, 45_000)

  it("prints a browser bootstrap URL when --browser-origin is set", async() => {
    const directory = mkdtempSync(join(tmpdir(), "crit-cli-standalone-"))
    directories.push(directory)
    const dataRoot = join(directory, ".crit", "v1")
    const started = await start(dataRoot)
    expect(new URL(started.browserBootstrapUrl).origin).toBe("http://127.0.0.1:5173")
    expect(started.browserBootstrapUrl).not.toContain(started.baseUrl)
    const printed = new URL(started.browserBootstrapUrl)
    const capability = printed.hash.slice(1)
    const bootstrap = new URL(printed.pathname, started.baseUrl)
    const bootstrapPage = await fetch(bootstrap)
    expect(bootstrapPage.status).toBe(200)
    expect(await bootstrapPage.text()).toContain("bootstrap.js")
    const session = await fetch(new URL("session", bootstrap), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: printed.origin
      },
      body: JSON.stringify({ capability })
    })
    expect(session.status).toBe(200)
    const cookie = session.headers.get("set-cookie")?.split(";", 1)[0]
    expect(cookie).toBeDefined()
    const sessionBody = Schema.decodeUnknownSync(Schema.Struct({ redirectTo: Schema.String }))(
      await session.json()
    )
    expect(sessionBody.redirectTo).toContain("http://127.0.0.1:5173/#crit=")
    const listed = await fetch(new URL("api/v1/canvas", bootstrap), {
      headers: {
        cookie: cookie ?? "",
        origin: printed.origin,
        "x-crit-api-version": "1"
      }
    })
    expect(listed.status).toBe(200)
    expect(Array.isArray(await listed.json())).toBe(true)
    await stop(started.child)
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

  it("does not bind a project application to the Crit host without an origin", async() => {
    const directory = mkdtempSync(join(tmpdir(), "crit-cli-unbound-application-"))
    directories.push(directory)
    const dataRoot = join(directory, ".crit", "v1")
    const applicationId = initializeProject(directory)
    const started = await startWithProject(dataRoot, directory)
    const resolved = await resolveApplication(started.baseUrl, dataRoot, applicationId, "/")
    expect(resolved.status).toBe(200)
    expect(resolved.body).toMatchObject({
      _tag: "unavailable",
      reason: "application-unbound"
    })
    expect(JSON.stringify(resolved.body)).not.toContain("127.0.0.1:5173")
    await stop(started.child)
  })

  it("binds --application-origin http://127.0.0.1:5174/ through the real transport", async() => {
    const directory = mkdtempSync(join(tmpdir(), "crit-cli-flag-application-"))
    directories.push(directory)
    const dataRoot = join(directory, ".crit", "v1")
    const applicationId = initializeProject(directory)
    const started = await startWithApplication(dataRoot, directory, "http://127.0.0.1:5174/")
    const resolved = await resolveApplication(started.baseUrl, dataRoot, applicationId)
    expect(resolved.status).toBe(200)
    expect(resolved.body).toMatchObject({
      _tag: "iframe",
      url: "http://127.0.0.1:5174/products"
    })
    await stop(started.child)
  })

  it("binds an announced matching application without --application-origin", async() => {
    const directory = mkdtempSync(join(tmpdir(), "crit-cli-announce-application-"))
    directories.push(directory)
    const dataRoot = join(directory, ".crit", "v1")
    const applicationId = initializeProject(directory)
    const started = await startWithProject(dataRoot, directory)
    const announced = await announceApplication(
      dataRoot,
      applicationId,
      "http://127.0.0.1:5174/"
    )
    expect(announced.status).toBe(204)
    const resolved = await resolveApplication(started.baseUrl, dataRoot, applicationId, "/")
    expect(resolved.status).toBe(200)
    expect(resolved.body).toMatchObject({
      _tag: "iframe",
      url: "http://127.0.0.1:5174/"
    })
    const checkout = await resolveApplication(
      started.baseUrl,
      dataRoot,
      applicationId,
      "/checkout"
    )
    expect(checkout.body).toMatchObject({
      _tag: "iframe",
      url: "http://127.0.0.1:5174/checkout"
    })
    await stop(started.child)
  })

  it("stays unbound when a different applicationId announces", async() => {
    const directory = mkdtempSync(join(tmpdir(), "crit-cli-announce-foreign-"))
    directories.push(directory)
    const dataRoot = join(directory, ".crit", "v1")
    const applicationId = initializeProject(directory)
    const started = await startWithProject(dataRoot, directory)
    const announced = await announceApplication(
      dataRoot,
      "application_foreign",
      "http://127.0.0.1:5174/"
    )
    expect(announced.status).toBe(204)
    const resolved = await resolveApplication(started.baseUrl, dataRoot, applicationId)
    expect(resolved.body).toMatchObject({
      _tag: "unavailable",
      reason: "application-unbound"
    })
    await stop(started.child)
  })

  it("lets --application-origin win over an announce", async() => {
    const directory = mkdtempSync(join(tmpdir(), "crit-cli-flag-wins-"))
    directories.push(directory)
    const dataRoot = join(directory, ".crit", "v1")
    const applicationId = initializeProject(directory)
    const started = await startWithApplication(dataRoot, directory, "http://127.0.0.1:5174/")
    const announced = await announceApplication(
      dataRoot,
      applicationId,
      "http://127.0.0.1:4173/"
    )
    expect(announced.status).toBe(204)
    const resolved = await resolveApplication(started.baseUrl, dataRoot, applicationId)
    expect(resolved.body).toMatchObject({
      _tag: "iframe",
      url: "http://127.0.0.1:5174/products"
    })
    await stop(started.child)
  })

  it("rejects an announce that does not present this daemon instance", async() => {
    const directory = mkdtempSync(join(tmpdir(), "crit-cli-announce-instance-"))
    directories.push(directory)
    const dataRoot = join(directory, ".crit", "v1")
    const applicationId = initializeProject(directory)
    const started = await startWithProject(dataRoot, directory)
    const announced = await announceApplication(
      dataRoot,
      applicationId,
      "http://127.0.0.1:5174/",
      "ffffffffffffffffffffffffffffffff"
    )
    expect(announced.status).toBe(401)
    const resolved = await resolveApplication(started.baseUrl, dataRoot, applicationId)
    expect(resolved.body).toMatchObject({
      _tag: "unavailable",
      reason: "application-unbound"
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
    expect(started.output).toContain("Crit daemon listening at http://127.0.0.1:")
    expect(started.output).not.toContain("Open Crit in your browser")
    expect(started.output).not.toContain("Crit is at http://127.0.0.1:5173")
    expect(started.output).not.toMatch(/\/browser\/[0-9a-f]{32}\/#/)
    await stop(started.child)
  })

  it("rejects --browser-origin combined with --no-host", () => {
    const directory = mkdtempSync(join(tmpdir(), "crit-cli-dev-conflict-"))
    directories.push(directory)
    const result = run(join(directory, ".crit", "v1"), [
      "dev",
      "--no-host",
      "--browser-origin",
      "http://127.0.0.1:5173"
    ])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("--browser-origin and --no-host cannot be combined")
    expect(existsSync(join(directory, ".crit", "v1"))).toBe(false)
  })

  it("releases project ownership after a killed process and preserves saved canvases", async() => {
    const directory = mkdtempSync(join(tmpdir(), "crit-cli-crash-"))
    directories.push(directory)
    const dataRoot = join(directory, ".crit", "v1")
    const first = await startWithoutBrowser(dataRoot)
    const created = run(dataRoot, ["create", "canvas_after_crash", "--title", "Survives crash", "--json"])
    expect(created.status, created.stderr).toBe(0)
    await new Promise<void>((resolve) => {
      first.child.once("exit", () => resolve())
      first.child.kill("SIGKILL")
    })
    const restarted = await startWithoutBrowser(dataRoot)
    const reopened = run(dataRoot, ["open", "canvas_after_crash", "--json"])
    expect(reopened.status, reopened.stderr).toBe(0)
    expect(JSON.parse(reopened.stdout).projection.title).toBe("Survives crash")
    await stop(restarted.child)
  })

  it("releases its listener and descriptor on interrupt and rediscovers the restarted daemon", async () => {
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
    expect(JSON.parse(readFileSync(descriptorPath, "utf8")).baseUrl).toBe(restarted.baseUrl)
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
