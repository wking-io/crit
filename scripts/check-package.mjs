import { execFile } from "node:child_process"
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { Option, Schema } from "effect"

const execFileAsync = promisify(execFile)
const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)))
const temporary = await mkdtemp(path.join(tmpdir(), "crit-package-check-"))
const npm = process.platform === "win32" ? "npm.cmd" : "npm"
const startedAt = Date.now()
const npmEnvironment = { ...process.env, npm_config_dry_run: "false" }
const alphaReleasePrefixes = ["src/", "dist/", "playground/", "www/"]

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

const posixPath = (file) => file.replaceAll("\\", "/")

const isAlphaReleasePath = (file) => {
  const normalized = posixPath(file)
  return alphaReleasePrefixes.some((prefix) =>
    normalized === prefix.slice(0, -1) || normalized.startsWith(prefix)
  )
}

const describeAlphaLeak = (files) => {
  const preview = files.slice(0, 20).join(", ")
  if (files.length <= 20) return preview
  return `${preview} (${files.length - 20} more)`
}

const listFiles = async (directory) => {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true })
  return entries.flatMap((entry) => {
    if (!entry.isFile()) return []
    const parent = entry.parentPath ?? entry.path
    return [posixPath(path.relative(directory, path.join(parent, entry.name)))]
  })
}

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
    report.files.map((file) => posixPath(file.path))
  )
  const requiredFiles = [
    "LICENSE",
    "skills/crit/SKILL.md",
    "skills/crit-identity/SKILL.md",
    "skills/install-crit-frame-bridge/SKILL.md"
  ]
  const missing = requiredFiles.filter((file) => !packagedFiles.has(file))
  if (missing.length > 0) {
    throw new Error(`Package is missing required files: ${missing.join(", ")}`)
  }

  const leakedAlpha = [...packagedFiles].filter(isAlphaReleasePath).sort()
  if (leakedAlpha.length > 0) {
    throw new Error(
      `Package must not include alpha source or its compiled output: ${describeAlphaLeak(leakedAlpha)}`
    )
  }

  const archive = path.join(temporary, report.filename)
  const consumer = path.join(temporary, "consumer")
  await mkdir(consumer, { recursive: true })
  await writeFile(
    path.join(consumer, "package.json"),
    `${JSON.stringify({
      private: true,
      type: "module"
    }, null, 2)}\n`
  )
  await run(
    npm,
    [
      "install",
      "--package-lock=false",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      archive
    ],
    { cwd: consumer, env: npmEnvironment }
  )

  const installedRoot = path.join(
    consumer,
    "node_modules",
    "@riff-refine",
    "crit"
  )
  const installedManifest = JSON.parse(
    await readFile(path.join(installedRoot, "package.json"), "utf8")
  )
  if (installedManifest.license !== "MIT") {
    throw new Error("Installed package does not declare the MIT license")
  }
  if (installedManifest.bin?.crit === "dist/cli.js") {
    throw new Error("Installed package still exposes the alpha CLI bin")
  }

  const installedFiles = await listFiles(installedRoot)
  const installedAlpha = installedFiles.filter(isAlphaReleasePath).sort()
  if (installedAlpha.length > 0) {
    throw new Error(
      `Installed package must not include alpha source or its compiled output: ${describeAlphaLeak(installedAlpha)}`
    )
  }

  const installedSkill = await readFile(
    path.join(installedRoot, "skills", "crit", "SKILL.md"),
    "utf8"
  )
  if (installedSkill.includes("AddCommentThread")) {
    throw new Error("Installed agent skill advertises Comment commands")
  }

  process.stdout.write(
    `Package smoke check passed (${report.files.length} files, ${report.size} bytes). Alpha omitted.\n${
      [...packagedFiles].sort().map((file) => `- ${file}`).join("\n")
    }\n`
  )
} finally {
  await rm(temporary, { recursive: true, force: true })
}
