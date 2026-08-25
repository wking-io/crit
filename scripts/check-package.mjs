import { execFile } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { Option, Schema } from "effect"

const execFileAsync = promisify(execFile)
const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)))
const temporary = await mkdtemp(path.join(tmpdir(), "crit-package-check-"))
const npm = process.platform === "win32" ? "npm.cmd" : "npm"
const commandTimeoutMs = 4 * 60 * 1000
const startedAt = Date.now()
const npmEnvironment = {
  ...process.env,
  npm_config_dry_run: "false",
  npm_config_fetch_retries: "2",
  npm_config_fetch_retry_mintimeout: "10000",
  npm_config_fetch_retry_maxtimeout: "30000",
  npm_config_fetch_timeout: "60000"
}

const log = (message) => {
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
  process.stdout.write(`[check-package +${elapsed}s] ${message}\n`)
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
      timeout: commandTimeoutMs,
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
    const timedOut = "killed" in cause && cause.killed === true
    throw new Error(
      timedOut
        ? `${command} ${args.join(" ")} timed out after ${commandTimeoutMs / 1000}s`
        : `${command} ${args.join(" ")} failed\n${detail}`
    )
  }
}

try {
  log(`working in ${temporary}`)
  const packed = await run(
    npm,
    ["pack", "--json", "--pack-destination", temporary],
    {
      cwd: root,
      env: npmEnvironment
    }
  )
  const reports = Schema.decodeUnknownSync(NpmPackReports)(
    JSON.parse(packed.stdout)
  )
  const report = reports[0]
  if (report === undefined) {
    throw new Error("npm pack did not return a package report")
  }

  const packagedFiles = new Set(
    report.files.map((file) => file.path)
  )
  const requiredFiles = [
    "LICENSE",
    "dist/cli.js",
    "dist/react/index.js",
    "dist/core/index.js",
    "dist/http/index.js",
    "dist/discovery/index.js",
    "dist/node/index.js",
    "dist/vite/index.js",
    "skills/crit/SKILL.md",
    "skills/crit-identity/SKILL.md",
    "skills/install-crit-frame-bridge/SKILL.md"
  ]
  const missing = requiredFiles.filter((file) => !packagedFiles.has(file))
  if (missing.length > 0) {
    throw new Error(`Package is missing required files: ${missing.join(", ")}`)
  }

  const leakedPlayground = [...packagedFiles].filter((file) =>
    file === "playground" || file.startsWith("playground/")
  )
  if (leakedPlayground.length > 0) {
    throw new Error(
      `Package must not include the playground: ${leakedPlayground.join(", ")}`
    )
  }

  const archive = path.join(temporary, report.filename)
  const consumer = path.join(temporary, "consumer")
  await mkdir(path.join(consumer, "src"), { recursive: true })
  await writeFile(
    path.join(consumer, "package.json"),
    `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`
  )
  await run(
    npm,
    [
      "install",
      "--package-lock=false",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      archive,
      "react",
      "react-dom",
      "vite"
    ],
    { cwd: consumer, env: npmEnvironment }
  )

  const installedManifest = JSON.parse(
    await readFile(
      path.join(
        consumer,
        "node_modules",
        "@riff-refine",
        "crit",
        "package.json"
      ),
      "utf8"
    )
  )
  if (installedManifest.bin?.crit !== "dist/cli.js") {
    throw new Error("Installed package does not expose the canonical crit bin")
  }
  if (installedManifest.license !== "MIT") {
    throw new Error("Installed package does not declare the MIT license")
  }
  if (installedManifest.version !== "0.1.0-alpha.0") {
    throw new Error("Installed package is not the alpha version")
  }

  const installedSkill = await readFile(
    path.join(
      consumer,
      "node_modules",
      "@riff-refine",
      "crit",
      "skills",
      "crit",
      "SKILL.md"
    ),
    "utf8"
  )
  if (installedSkill.includes("AddCommentThread")) {
    throw new Error("Installed agent skill advertises Comment commands")
  }

  await writeFile(
    path.join(consumer, "vite.config.ts"),
    `import { defineConfig } from "vite"
import { crit } from "@riff-refine/crit/vite"

export default defineConfig({
  plugins: [crit()]
})
`
  )
  await writeFile(
    path.join(consumer, "index.html"),
    '<div id="root"></div><script type="module" src="/src/main.tsx"></script>\n'
  )
  await writeFile(
    path.join(consumer, "src", "main.tsx"),
    `import { createRoot } from "react-dom/client"
import { Crit } from "@riff-refine/crit"

createRoot(document.getElementById("root")!).render(<Crit canvasId="package-smoke" />)
`
  )
  await run(
    path.join(
      consumer,
      "node_modules",
      ".bin",
      `vite${process.platform === "win32" ? ".cmd" : ""}`
    ),
    ["build", "--logLevel", "error"],
    {
      cwd: consumer,
      env: npmEnvironment
    }
  )

  await writeFile(
    path.join(consumer, "check-server.mjs"),
    `const checks = [
  ["@riff-refine/crit/core", "Canvas"],
  ["@riff-refine/crit/http", "makeCritHttpHandler"],
  ["@riff-refine/crit/discovery", "CritManifest"],
  ["@riff-refine/crit/node", "FileSystemCanvasRepository"],
  ["@riff-refine/crit/node", "FileSystemAgentActivity"],
  ["@riff-refine/crit/node", "FileSystemSnapshotArchive"],
  ["@riff-refine/crit/vite", "crit"]
]

for (const [specifier, name] of checks) {
  const entry = await import(specifier)
  if (!(name in entry)) throw new Error("Missing " + name + " from " + specifier)
}

const reactEntry = await import("@riff-refine/crit")
if (reactEntry.ALPHA_FEATURES?.comments !== false) {
  throw new Error("Alpha profile must disable comments by default")
}
if (reactEntry.DEVELOPMENT_FEATURES?.comments !== true) {
  throw new Error("Development profile must retain comments")
}
`
  )
  await run(process.execPath, ["check-server.mjs"], { cwd: consumer })

  const help = await run(
    path.join(
      consumer,
      "node_modules",
      ".bin",
      `crit${process.platform === "win32" ? ".cmd" : ""}`
    ),
    ["--help"],
    { cwd: consumer }
  )
  for (const command of ["init", "identity", "sync", "apply", "create", "add", "snapshot", "activity", "list", "open"]) {
    if (!new RegExp(`^  ${command}\\s`, "m").test(help.stdout)) {
      throw new Error(`Installed CLI help is missing the ${command} command`)
    }
  }
  if (/Comment commands/i.test(help.stdout)) {
    throw new Error("Installed CLI help advertises Comment commands")
  }

  const applyHelp = await run(
    path.join(
      consumer,
      "node_modules",
      ".bin",
      `crit${process.platform === "win32" ? ".cmd" : ""}`
    ),
    ["apply", "--help"],
    { cwd: consumer }
  )
  if (/comment/i.test(applyHelp.stdout)) {
    throw new Error("Installed apply help advertises Comments")
  }

  await run("git", ["init"], { cwd: consumer, env: npmEnvironment })
  await run(
    "git",
    ["config", "user.name", "Package Smoke"],
    { cwd: consumer, env: npmEnvironment }
  )
  await run(
    "git",
    ["config", "user.email", "smoke@example.com"],
    { cwd: consumer, env: npmEnvironment }
  )
  const critBin = path.join(
    consumer,
    "node_modules",
    ".bin",
    `crit${process.platform === "win32" ? ".cmd" : ""}`
  )
  await run(
    critBin,
    ["create", "smoke", "--title", "Smoke"],
    { cwd: consumer, env: npmEnvironment }
  )
  try {
    await run(
      critBin,
      [
        "apply",
        "smoke",
        JSON.stringify([{
          _tag: "AddCommentThread",
          id: "thread-1",
          frameId: "candidate",
          anchor: { kind: "frame", xRatio: 0.5, yRatio: 0.5 },
          opening: {
            id: "comment-1",
            body: "hidden",
            author: { id: "git:smoke", name: "Smoke" },
            createdAt: "2026-08-09T12:00:00.000Z",
            editedAt: null
          }
        }])
      ],
      { cwd: consumer, env: npmEnvironment }
    )
    throw new Error("Packed CLI accepted a Comment command by default")
  } catch (cause) {
    if (
      !(cause instanceof Error) ||
      !/unavailable/i.test(cause.message)
    ) {
      throw cause
    }
  }

  process.stdout.write(
    `Package smoke check passed (${report.files.length} files, ${report.size} bytes).\n`
  )
} finally {
  await rm(temporary, { recursive: true, force: true })
}
