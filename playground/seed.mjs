import { execFileSync } from "node:child_process"
import { readFileSync, renameSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { gitAuthor } from "../dist/node/index.js"
import { migrateLegacyPlaygroundCanvas } from "./migrate-state.mjs"

const playground = path.dirname(fileURLToPath(import.meta.url))
const repository = path.dirname(playground)
const cli = path.join(repository, "dist", "cli.js")
const port = process.env.PORT ?? process.env.CRIT_PLAYGROUND_PORT ?? "5173"
const origin =
  process.env.PUBLIC_URL ??
  process.env.PORTLESS_URL ??
  `http://127.0.0.1:${port}`
const seedCommands = JSON.parse(
  readFileSync(path.join(playground, "feature-lab.commands.json"), "utf8")
)
const canvasFile = path.join(playground, ".crit", "canvases", "feature-lab.json")

const migratePersistedCanvas = (author) => {
  let source
  try {
    source = readFileSync(canvasFile, "utf8")
  } catch (cause) {
    if (cause?.code === "ENOENT") return
    throw cause
  }
  const current = JSON.parse(source)
  const migrated = migrateLegacyPlaygroundCanvas(current, author)
  if (migrated === current) return
  const temporary = `${canvasFile}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(migrated, null, 2)}\n`)
  renameSync(temporary, canvasFile)
}

const run = (args) => {
  const output = execFileSync(process.execPath, [cli, ...args, "--json"], {
    cwd: playground,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"]
  })
  return JSON.parse(output)
}

const author = await gitAuthor(playground)
migratePersistedCanvas(author)

run([
  "sync",
  "--from",
  "crit.manifest.json",
  "--base-url",
  origin
])

let canvas = run(["open", "feature-lab"])
const author = await gitAuthor(playground)
const legacyFrameIds = new Set([
  "checkout-draft",
  "checkout-ready",
  "checkout-approved",
  "checkout-changes"
])
const legacyFrameCommands = canvas.frames
  .filter((frame) => legacyFrameIds.has(frame.id))
  .map((frame) => ({ _tag: "RemoveFrame", id: frame.id }))
if (legacyFrameCommands.length > 0) {
  run(["apply", "feature-lab", JSON.stringify(legacyFrameCommands)])
  canvas = run(["open", "feature-lab"])
}
const legacyNoteIds = new Set([
  "attached-feedback",
  "ordering-note-back",
  "ordering-note-front"
])
const checklistSeed = seedCommands.find((command) =>
  command._tag === "AddNote" && command.id === "feature-checklist"
)
const legacyNoteCommands = canvas.notes
  .filter((note) =>
    legacyNoteIds.has(note.id) ||
    (note.id === "feature-checklist" && note.text !== checklistSeed?.text)
  )
  .map((note) => ({ _tag: "RemoveNote", id: note.id, actorId: note.author.id }))
if (legacyNoteCommands.length > 0) {
  run(["apply", "feature-lab", JSON.stringify(legacyNoteCommands)])
  canvas = run(["open", "feature-lab"])
}
const hasSeed = canvas.notes.some((note) => note.id === "feature-checklist")

if (!hasSeed) {
  const authoredSeedCommands = seedCommands.map((command) =>
    command._tag === "AddNote" ? { ...command, author } : command
  )
  run([
    "apply",
    "feature-lab",
    JSON.stringify(authoredSeedCommands)
  ])
}

process.stdout.write(
  `Crit playground ready: ${origin}\n` +
    `Agent CLI: npm run dev:agent -- open feature-lab --json\n`
)
