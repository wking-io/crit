import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const playground = path.dirname(fileURLToPath(import.meta.url))
const repository = path.dirname(playground)
const cli = path.join(repository, "dist", "cli.js")
const port = process.env.CRIT_PLAYGROUND_PORT ?? "5173"
const origin = process.env.PORTLESS_URL ?? `http://127.0.0.1:${port}`
const seedCommands = JSON.parse(
  readFileSync(path.join(playground, "feature-lab.commands.json"), "utf8")
)

const run = (args) => {
  const output = execFileSync(process.execPath, [cli, ...args, "--json"], {
    cwd: playground,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"]
  })
  return JSON.parse(output)
}

run([
  "sync",
  "--from",
  "crit.manifest.json",
  "--base-url",
  origin
])

const canvas = run(["open", "feature-lab"])
const hasSeed = canvas.notes.some((note) => note.id === "feature-checklist")

if (!hasSeed) {
  run([
    "apply",
    "feature-lab",
    JSON.stringify(seedCommands)
  ])
}

process.stdout.write(
  `Crit playground ready: ${origin}/crit/feature-lab\n` +
    `Agent CLI: npm run dev:agent -- open feature-lab --json\n`
)
