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
const npmEnvironment = { ...process.env, npm_config_dry_run: "false" }
const executable = (name) =>
  path.join(root, "node_modules", ".bin", `${name}${process.platform === "win32" ? ".cmd" : ""}`)

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
    "dist/cli.js",
    "dist/react/index.js",
    "dist/core/index.js",
    "dist/http/index.js",
    "dist/discovery/index.js",
    "dist/node/index.js",
    "dist/vite/index.js",
    "skills/crit/SKILL.md",
    "skills/crit-identity/SKILL.md"
  ]
  const missing = requiredFiles.filter((file) => !packagedFiles.has(file))
  if (missing.length > 0) {
    throw new Error(`Package is missing required files: ${missing.join(", ")}`)
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
      archive
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
  await run(executable("vite"), ["build", "--logLevel", "error"], {
    cwd: consumer
  })

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

  process.stdout.write(
    `Package smoke check passed (${report.files.length} files, ${report.size} bytes).\n`
  )
} finally {
  await rm(temporary, { recursive: true, force: true })
}
