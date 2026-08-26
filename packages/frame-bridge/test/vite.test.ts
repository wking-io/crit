// @vitest-environment node

import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { build, createServer, preview } from "vite"

import {
  FRAME_INPUT_BRIDGE_HTML_MARKER,
  parseFrameBridgeParentOrigin
} from "../src/html.js"
import { frameInputBridgeVitePlugin } from "../src/vite.js"

const sourceHtml = "<!doctype html><html><head></head><body>Fixture</body></html>"

const readFiles = (directory: string): ReadonlyArray<string> =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    return entry.isDirectory()
      ? readFiles(entryPath)
      : [readFileSync(entryPath, "utf8")]
  })

let root = ""

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "crit-frame-bridge-vite-"))
  writeFileSync(path.join(root, "index.html"), sourceHtml)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe("Frame Bridge Vite plugin", () => {
  it("leaves an ordinary build and its preview unmarked", async() => {
    await build({ root, logLevel: "silent" })

    expect(readFiles(path.join(root, "dist")).join("\n"))
      .not.toContain(FRAME_INPUT_BRIDGE_HTML_MARKER)

    const server = await preview({
      root,
      logLevel: "silent",
      preview: { host: "127.0.0.1", port: 0 }
    })
    try {
      const previewUrl = server.resolvedUrls?.local[0]
      if (previewUrl === undefined) throw new Error("Expected a local preview URL")
      const response = await fetch(previewUrl)
      expect(response.status).toBe(200)
      expect(await response.text()).not.toContain(
        FRAME_INPUT_BRIDGE_HTML_MARKER
      )
    } finally {
      await server.close()
    }
  })

  it("injects one bridge into development HTML", async() => {
    const parentOrigin = parseFrameBridgeParentOrigin("http://127.0.0.1:5173")
    if (parentOrigin === undefined) throw new Error("Expected a valid parent origin")
    const server = await createServer({
      root,
      logLevel: "silent",
      plugins: [frameInputBridgeVitePlugin({ parentOrigin })],
      server: { middlewareMode: true },
      appType: "custom"
    })
    try {
      const transformed = await server.transformIndexHtml("/", sourceHtml)
      const transformedAgain = await server.transformIndexHtml("/", transformed)

      expect(transformed.split(FRAME_INPUT_BRIDGE_HTML_MARKER)).toHaveLength(2)
      expect(transformed).toContain(JSON.stringify(parentOrigin))
      expect(transformedAgain.split(FRAME_INPUT_BRIDGE_HTML_MARKER))
        .toHaveLength(2)
    } finally {
      await server.close()
    }
  })

  it("marks a review-preview build once", async() => {
    const parentOrigin = parseFrameBridgeParentOrigin("https://review.example.com")
    if (parentOrigin === undefined) throw new Error("Expected a valid parent origin")

    await build({
      root,
      logLevel: "silent",
      mode: "crit-review-preview",
      plugins: [frameInputBridgeVitePlugin({ parentOrigin })],
      build: { outDir: "dist-review" }
    })

    const html = readFileSync(path.join(root, "dist-review", "index.html"), "utf8")
    expect(html.split(FRAME_INPUT_BRIDGE_HTML_MARKER)).toHaveLength(2)
    expect(html).toContain(JSON.stringify(parentOrigin))
  })
})
