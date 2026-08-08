import { execFile } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)))
const temporary = await mkdtemp(path.join(tmpdir(), "crit-package-check-"))
const npm = process.platform === "win32" ? "npm.cmd" : "npm"
const npmEnvironment = { ...process.env, npm_config_dry_run: "false" }
const executable = (name) =>
  path.join(root, "node_modules", ".bin", `${name}${process.platform === "win32" ? ".cmd" : ""}`)

const run = async (command, args, options = {}) => {
  try {
    return await execFileAsync(command, args, {
      maxBuffer: 20 * 1024 * 1024,
      ...options
    })
  } catch (cause) {
    const detail = [
      cause instanceof Error ? cause.message : String(cause),
      typeof cause === "object" && cause !== null && "stdout" in cause
        ? String(cause.stdout)
        : "",
      typeof cause === "object" && cause !== null && "stderr" in cause
        ? String(cause.stderr)
        : ""
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
  const reports = JSON.parse(packed.stdout)
  const report = Array.isArray(reports) ? reports[0] : undefined
  if (
    typeof report !== "object" ||
    report === null ||
    typeof report.filename !== "string" ||
    !Array.isArray(report.files)
  ) {
    throw new Error("npm pack did not return a package report")
  }

  const packagedFiles = new Set(
    report.files.flatMap((file) =>
      typeof file === "object" &&
      file !== null &&
      "path" in file &&
      typeof file.path === "string"
        ? [file.path]
        : []
    )
  )
  const requiredFiles = [
    "dist/cli.js",
    "dist/react/index.js",
    "dist/core/index.js",
    "dist/http/index.js",
    "dist/discovery/index.js",
    "dist/cloudflare/index.js",
    "dist/vite/index.js",
    "migrations/0001_crit_canvases.sql",
    "skills/crit/SKILL.md"
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
  ["@riff-refine/crit/cloudflare", "makeCritCloudflareHandler"],
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
  for (const command of ["init", "sync", "apply", "create", "add", "list", "open"]) {
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
