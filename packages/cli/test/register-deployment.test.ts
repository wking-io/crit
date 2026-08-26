import { spawn, spawnSync } from "node:child_process"
import {
  mkdtempSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Schema } from "effect"
import { afterEach, describe, expect, it } from "vitest"

const executable = join(import.meta.dirname, "..", "dist", "main.js")
const TcpAddress = Schema.Struct({ port: Schema.Number })
const MockRegistration = Schema.Struct({
  kind: Schema.Literal("register-deployment"),
  schemaVersion: Schema.Literal(1),
  applicationId: Schema.String,
  channel: Schema.String,
  url: Schema.String,
  sourceRevision: Schema.optionalKey(Schema.String),
  expiresAt: Schema.optionalKey(Schema.String)
})
const directories: Array<string> = []
const servers: Array<ReturnType<typeof createServer>> = []

afterEach(async() => {
  await Promise.all(servers.splice(0).map((server) =>
    new Promise<void>((resolve) => server.close(() => resolve()))
  ))
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

const makeProject = () => {
  const root = mkdtempSync(join(tmpdir(), "crit-cli-register-deployment-"))
  directories.push(root)
  writeFileSync(
    join(root, "crit.manifest.json"),
    `${JSON.stringify({
      schemaVersion: 2,
      applicationId: "application_cli_registration"
    })}\n`
  )
  return root
}

interface MockInstallation {
  readonly origin: string
  readonly requests: Array<{
    readonly authorization: string | undefined
    readonly body: typeof MockRegistration.Type
    readonly method: string | undefined
    readonly path: string | undefined
  }>
}

interface MockDeploymentDetails {
  sourceRevision?: string
  expiresAt?: string
}

const startMockInstallation = (
  status = 200
) => new Promise<MockInstallation>((resolve, reject) => {
  const requests: MockInstallation["requests"] = []
  const server = createServer((request, response) => {
    let source = ""
    request.on("data", (chunk: Uint8Array) => {
      source += Buffer.from(chunk).toString("utf8")
    })
    request.once("end", () => {
      const body = Schema.decodeUnknownSync(MockRegistration)(
        JSON.parse(source)
      )
      requests.push({
        authorization: request.headers.authorization,
        body,
        method: request.method,
        path: request.url
      })
      if (status !== 200) {
        response.writeHead(status).end()
        return
      }
      const details: MockDeploymentDetails = {}
      if (body.sourceRevision !== undefined) {
        details.sourceRevision = body.sourceRevision
      }
      if (body.expiresAt !== undefined) {
        details.expiresAt = body.expiresAt
      }
      response.writeHead(200, {
        "content-type": "application/json"
      }).end(JSON.stringify({
        kind: "deployment-registered",
        schemaVersion: 1,
        deploymentId: "deployment_cli",
        applicationId: body.applicationId,
        channel: body.channel,
        url: body.url,
        ...details
      }))
    })
  })
  servers.push(server)
  server.once("error", reject)
  server.listen(0, "127.0.0.1", () => {
    const address = Schema.decodeUnknownSync(TcpAddress)(server.address())
    resolve({
      origin: `http://127.0.0.1:${address.port}`,
      requests
    })
  })
})

const runRegisterDeployment = (
  root: string,
  arguments_: ReadonlyArray<string>,
  environment: {
    readonly installationUrl?: string
    readonly token?: string
  }
) => new Promise<{
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
}>((resolve, reject) => {
  const env = { ...process.env }
  delete env.CRIT_DEPLOY_TOKEN
  delete env.CRIT_INSTALLATION_URL
  if (environment.token !== undefined) {
    env.CRIT_DEPLOY_TOKEN = environment.token
  }
  if (environment.installationUrl !== undefined) {
    env.CRIT_INSTALLATION_URL = environment.installationUrl
  }
  const child = spawn(process.execPath, [
    executable,
    "register-deployment",
    "--root",
    root,
    ...arguments_
  ], {
    env,
    stdio: ["ignore", "pipe", "pipe"]
  })
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

describe("built crit register-deployment", () => {
  it("uses environment credentials and defaults to the review channel", async() => {
    const root = makeProject()
    const installation = await startMockInstallation()

    const result = await runRegisterDeployment(
      root,
      ["--url", "https://review.example.com/"],
      {
        installationUrl: installation.origin,
        token: "test-deploy-token"
      }
    )

    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toBe(
      "Deployment  deployment_cli\n"
      + "Application  application_cli_registration\n"
      + "Channel  review\n"
      + "Origin  https://review.example.com/\n"
    )
    expect(installation.requests).toEqual([{
      authorization: "Bearer test-deploy-token",
      method: "POST",
      path: "/deployments",
      body: {
        kind: "register-deployment",
        schemaVersion: 1,
        applicationId: "application_cli_registration",
        channel: "review",
        url: "https://review.example.com/"
      }
    }])
  })

  it("accepts registration flags and prints the encoded receipt as JSON", async() => {
    const root = makeProject()
    const installation = await startMockInstallation()

    const result = await runRegisterDeployment(root, [
      "--url",
      "https://production.example.com/",
      "--channel",
      "production",
      "--revision",
      "commit_abc123",
      "--expires-at",
      "2026-08-27T12:00:00.000Z",
      "--installation-url",
      installation.origin,
      "--json"
    ], { token: "test-deploy-token" })

    expect(result.code, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      kind: "deployment-registered",
      schemaVersion: 1,
      deploymentId: "deployment_cli",
      applicationId: "application_cli_registration",
      channel: "production",
      url: "https://production.example.com/",
      sourceRevision: "commit_abc123",
      expiresAt: "2026-08-27T12:00:00.000Z"
    })
  })

  it("requires the environment token and never reports its value", async() => {
    const root = makeProject()
    const installation = await startMockInstallation(401)
    const missing = await runRegisterDeployment(
      root,
      ["--url", "https://review.example.com/"],
      { installationUrl: installation.origin }
    )
    const secret = "do-not-report-deploy-token"
    const rejected = await runRegisterDeployment(
      root,
      ["--url", "https://review.example.com/"],
      { installationUrl: installation.origin, token: secret }
    )

    expect(missing.code).not.toBe(0)
    expect(missing.stderr).toBe("CRIT_DEPLOY_TOKEN is required\n")
    expect(rejected.code).not.toBe(0)
    expect(rejected.stderr).toBe(
      "Installation rejected deployment credentials\n"
    )
    expect(rejected.stderr).not.toContain(secret)
  })

  it("lists register-deployment in help", () => {
    const result = spawnSync(process.execPath, [executable, "--help"], {
      encoding: "utf8"
    })

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain("register-deployment")
  })
})
