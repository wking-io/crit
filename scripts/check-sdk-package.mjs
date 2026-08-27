import { execFile } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { Option, Schema } from "effect"

const execFileAsync = promisify(execFile)
const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)))
const temporary = await mkdtemp(path.join(tmpdir(), "crit-sdk-package-check-"))
const npm = process.platform === "win32" ? "npm.cmd" : "npm"
const startedAt = Date.now()
const npmEnvironment = { ...process.env, npm_config_dry_run: "false" }

const sdkPackages = [
  "domain",
  "protocol",
  "authority",
  "replica",
  "representations",
  "frame-bridge",
  "client",
  "react"
]

const sdkSurfaces = ["domain", "client", "react", "frame-bridge"]

const requiredFiles = {
  domain: ["dist/index.js", "dist/index.d.ts", "dist/testing.js", "dist/testing.d.ts"],
  protocol: ["dist/index.js", "dist/index.d.ts"],
  authority: ["dist/index.js", "dist/index.d.ts", "dist/testing.js", "dist/testing.d.ts"],
  replica: [
    "dist/index.js",
    "dist/index.d.ts",
    "dist/http.js",
    "dist/testing.js",
    "dist/testing.d.ts"
  ],
  representations: ["dist/index.js", "dist/index.d.ts", "dist/testing.js", "dist/testing.d.ts"],
  "frame-bridge": [
    "dist/index.js",
    "dist/index.d.ts",
    "dist/html.js",
    "dist/html.d.ts",
    "dist/vite.js",
    "dist/vite.d.ts",
    "dist/headers.js",
    "dist/headers.d.ts"
  ],
  client: ["dist/index.js", "dist/index.d.ts"],
  react: ["dist/index.js", "dist/index.d.ts"]
}

const log = (message) => {
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
  process.stdout.write(`[check-sdk-package +${elapsed}s] ${message}\n`)
}

const ExecFileFailure = Schema.Struct({
  message: Schema.String,
  stdout: Schema.optionalKey(Schema.String),
  stderr: Schema.optionalKey(Schema.String)
})

const NpmPackReport = Schema.Struct({
  filename: Schema.String,
  files: Schema.Array(Schema.Struct({ path: Schema.String })),
  size: Schema.Number
})

const NpmPackReports = Schema.Array(NpmPackReport)

const run = async (command, args, options = {}) => {
  log(`${command} ${args.join(" ")}`)
  try {
    return await execFileAsync(command, args, {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      ...options
    })
  } catch (cause) {
    const failure = Option.getOrElse(
      Schema.decodeUnknownOption(ExecFileFailure)(cause),
      () => ({ message: String(cause) })
    )
    const detail = [
      failure.message,
      failure.stdout ?? "",
      failure.stderr ?? ""
    ]
      .filter((value) => value.length > 0)
      .join("\n")
    throw new Error(`${command} ${args.join(" ")} failed\n${detail}`)
  }
}

const workspaceRange = (value) => value === "*" || value === "workspace:*"

const assertPublishableManifest = (name, manifest) => {
  if (manifest.private === true) {
    throw new Error(`Packed @crit/${name} is still private`)
  }
  if (manifest.license !== "MIT") {
    throw new Error(`Packed @crit/${name} does not declare the MIT license`)
  }
  if (manifest.publishConfig?.access !== "public") {
    throw new Error(`Packed @crit/${name} is not public`)
  }
  for (const section of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    const deps = manifest[section]
    if (deps === undefined) continue
    for (const [dependency, range] of Object.entries(deps)) {
      if (dependency.startsWith("@crit/") && workspaceRange(range)) {
        throw new Error(`Packed @crit/${name} still depends on ${dependency}@${range}`)
      }
    }
  }
}

try {
  log(`working in ${temporary}`)
  await run(npm, ["run", "build:sdk"], { cwd: root, env: npmEnvironment })

  const archives = []
  for (const name of sdkPackages) {
    const packed = await run(
      npm,
      [
        "pack",
        "--json",
        "--ignore-scripts",
        "--pack-destination",
        temporary,
        "--workspace",
        `@crit/${name}`
      ],
      { cwd: root, env: npmEnvironment }
    )
    const reports = Schema.decodeUnknownSync(NpmPackReports)(
      JSON.parse(packed.stdout)
    )
    const report = reports[0]
    if (report === undefined) {
      throw new Error(`npm pack did not return a package report for @crit/${name}`)
    }

    const packagedFiles = new Set(report.files.map((file) => file.path))
    const missing = [
      "LICENSE",
      "README.md",
      ...requiredFiles[name]
    ].filter((file) => !packagedFiles.has(file))
    if (missing.length > 0) {
      throw new Error(`@crit/${name} is missing ${missing.join(", ")}`)
    }

    const leaked = [...packagedFiles].filter((file) =>
      file === "src" ||
      file.startsWith("src/") ||
      file === "test" ||
      file.startsWith("test/") ||
      file === "playground" ||
      file.startsWith("playground/")
    )
    if (leaked.length > 0) {
      throw new Error(`@crit/${name} leaked ${leaked.join(", ")}`)
    }

    const archive = path.join(temporary, report.filename)
    const packedManifest = JSON.parse(
      await run("tar", ["-xOf", archive, "package/package.json"]).then((result) => result.stdout)
    )
    assertPublishableManifest(name, packedManifest)
    archives.push({ name, archive, report })
  }

  const consumer = path.join(temporary, "consumer")
  const rootManifest = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8")
  )
  await mkdir(consumer, { recursive: true })
  await writeFile(
    path.join(consumer, "package.json"),
    `${JSON.stringify({
      private: true,
      type: "module",
      overrides: {
        effect: rootManifest.dependencies.effect
      }
    }, null, 2)}\n`
  )
  await writeFile(
    path.join(consumer, ".npmrc"),
    "install-strategy=nested\n"
  )
  await run(
    npm,
    [
      "install",
      "--package-lock=false",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      ...archives.map((item) => item.archive)
    ],
    { cwd: consumer, env: npmEnvironment }
  )
  await run(
    npm,
    [
      "install",
      "--package-lock=false",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      `react@${rootManifest.devDependencies.react}`,
      `effect@${rootManifest.dependencies.effect}`
    ],
    { cwd: consumer, env: npmEnvironment }
  )

  for (const name of sdkSurfaces) {
    const installed = JSON.parse(
      await readFile(
        path.join(consumer, "node_modules", "@crit", name, "package.json"),
        "utf8"
      )
    )
    if (installed.private === true) {
      throw new Error(`Installed @crit/${name} is still private`)
    }
  }

  await writeFile(
    path.join(consumer, "check-sdk.mjs"),
    `import { Effect } from "effect"
import {
  CanvasEngine,
  decodeCanvasProjection
} from "@crit/domain"
import { DomainReplayConformance } from "@crit/domain/testing"
import { HostedReviewClient, LocalCanvasClient } from "@crit/client"
import { ReplicaBoard, ReviewChrome } from "@crit/react"
import {
  assignLiveFrameRoute,
  connectBridgedFrameInput
} from "@crit/frame-bridge"
import { renderFrameRouteBridgeTag } from "@crit/frame-bridge/html"
import { frameAncestorsPreviewVitePlugin, frameRouteBridgeVitePlugin } from "@crit/frame-bridge/vite"
import { renderFrameAncestorsResponseHeaders } from "@crit/frame-bridge/headers"
import { authorityConformanceScenarios } from "@crit/authority/testing"
import { ReplicaConformance } from "@crit/replica/testing"
import { runRepresentationRuntimeConformance } from "@crit/representations/testing"

const missing = [
  ["CanvasEngine.replay", typeof CanvasEngine.replay === "function"],
  ["LocalCanvasClient", typeof LocalCanvasClient === "function"],
  ["HostedReviewClient", typeof HostedReviewClient === "function"],
  ["ReplicaBoard", typeof ReplicaBoard === "function"],
  ["ReviewChrome", typeof ReviewChrome === "function"],
  ["connectBridgedFrameInput", typeof connectBridgedFrameInput === "function"],
  ["assignLiveFrameRoute", typeof assignLiveFrameRoute === "function"],
  ["renderFrameRouteBridgeTag", typeof renderFrameRouteBridgeTag === "function"],
  ["frameRouteBridgeVitePlugin", typeof frameRouteBridgeVitePlugin === "function"],
  ["frameAncestorsPreviewVitePlugin", typeof frameAncestorsPreviewVitePlugin === "function"],
  ["renderFrameAncestorsResponseHeaders", typeof renderFrameAncestorsResponseHeaders === "function"],
  ["authorityConformanceScenarios", typeof authorityConformanceScenarios === "function"],
  ["ReplicaConformance.basic", ReplicaConformance?.basic !== undefined],
  ["runRepresentationRuntimeConformance", typeof runRepresentationRuntimeConformance === "function"]
].filter(([, present]) => !present).map(([name]) => name)
if (missing.length > 0) throw new Error("Missing SDK export: " + missing.join(", "))

const initial = decodeCanvasProjection({
  schemaVersion: 3,
  canvasId: "canvas_sdk_pack",
  title: "SDK",
  frames: [],
  stack: [],
  stackChangedByChangeId: null,
  issuedIds: { frameIds: [] }
})
await Effect.runPromise(DomainReplayConformance.identicalProjection({
  initial,
  changes: [],
  expected: initial
}))
`
  )
  await run(process.execPath, ["check-sdk.mjs"], { cwd: consumer })

  const packedSummary = archives
    .map((item) => `${item.name}:${item.report.files.length}`)
    .join(", ")
  process.stdout.write(
    `SDK package smoke check passed (${packedSummary}).\n`
  )
} finally {
  await rm(temporary, { recursive: true, force: true })
}
