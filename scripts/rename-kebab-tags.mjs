import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs"
import { join } from "node:path"

const root = new URL("..", import.meta.url).pathname

const tags = {
  "access-person-bound": "accessPersonBound",
  "accepted-unconfirmed": "acceptedUnconfirmed",
  "application-route": "applicationRoute",
  "artifact-bytes": "artifactBytes",
  "authority-view": "authorityView",
  "browser-session": "browserSession",
  "canvas-already-exists": "canvasAlreadyExists",
  "canvas-mismatch": "canvasMismatch",
  "canvas-not-found": "canvasNotFound",
  "canvas-shared": "canvasShared",
  "canvas-title-mismatch": "canvasTitleMismatch",
  "capture-representation": "captureRepresentation",
  "change-id-reused": "changeIdReused",
  "change-rejected": "changeRejected",
  "changes-after": "changesAfter",
  "connected-person": "connectedPerson",
  "create-canvas": "createCanvas",
  "cursor-not-found": "cursorNotFound",
  "delete-canvas": "deleteCanvas",
  "duplicate-change": "duplicateChange",
  "durable-sql-row-limit-exceeded": "durableSqlRowLimitExceeded",
  "entity-not-found": "entityNotFound",
  "id-already-issued": "idAlreadyIssued",
  "invalid-reference": "invalidReference",
  "local-browser-connection": "localBrowserConnection",
  "malformed-message": "malformedMessage",
  "message-kind-mismatch": "messageKindMismatch",
  "precondition-failed": "preconditionFailed",
  "presence-roster": "presenceRoster",
  "replay-failed": "replayFailed",
  "replica-change": "replicaChange",
  "replica-view": "replicaView",
  "reported-runtime": "reportedRuntime",
  "resolve-representation": "resolveRepresentation",
  "shared-canvas": "sharedCanvas",
  "trusted-field": "trustedField",
  "unsupported-version": "unsupportedVersion",
  "web-url": "webUrl"
}

const skipDir = new Set([
  ".git",
  "node_modules",
  "dist",
  ".turbo",
  "coverage"
])

const extensions = new Set([".ts", ".tsx", ".md", ".mjs"])

const walk = (directory, files = []) => {
  for (const entry of readdirSync(directory)) {
    if (skipDir.has(entry)) continue
    const path = join(directory, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      walk(path, files)
      continue
    }
    const dot = entry.lastIndexOf(".")
    if (dot === -1) continue
    if (!extensions.has(entry.slice(dot))) continue
    files.push(path)
  }
  return files
}

const replacements = Object.entries(tags).sort((left, right) => right[0].length - left[0].length)
let changed = 0
for (const file of walk(root)) {
  if (file.endsWith("scripts/rename-kebab-tags.mjs")) continue
  const before = readFileSync(file, "utf8")
  let after = before
  for (const [from, to] of replacements) {
    after = after.replaceAll(new RegExp(`(?<![A-Za-z0-9])${from}(?![A-Za-z0-9])`, "g"), to)
  }
  if (after === before) continue
  writeFileSync(file, after)
  changed += 1
}

console.log(`rewrote ${changed} files`)
