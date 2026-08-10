import { readFile } from "node:fs/promises"
import { createServer as createHttpServer } from "node:http"
import type { AddressInfo } from "node:net"
import path from "node:path"

import { describe, expect, it } from "vitest"
import { Effect, Schema } from "effect"
import { createServer } from "vite"

import { CanvasCommandSchema } from "../../src/core/index.js"
import { CritManifest } from "../../src/discovery/index.js"

const readJson = async (file: string) =>
  JSON.parse(await readFile(path.resolve(file), "utf8")) as unknown

describe("Crit feature lab", () => {
  it("uses the feature-lab Canvas as home and serves the repo-only UI lab", async () => {
    const vite = await createServer({
      configFile: path.resolve("playground/vite.config.ts"),
      logLevel: "silent",
      server: { middlewareMode: true }
    })
    const http = createHttpServer(vite.middlewares)

    try {
      await new Promise<void>((resolve, reject) => {
        http.once("error", reject)
        http.listen(0, "127.0.0.1", resolve)
      })
      const port = (http.address() as AddressInfo).port
      const origin = `http://127.0.0.1:${port}`
      const [home, ui, mainSource, uiSource, uiStyles, baseTokens] = await Promise.all([
        fetch(origin, {
          headers: { Connection: "close" },
          redirect: "manual"
        }),
        fetch(`${origin}/ui`, {
          headers: { Connection: "close" },
          redirect: "manual"
        }),
        readFile(path.resolve("playground/src/main.tsx"), "utf8"),
        readFile(path.resolve("playground/src/ui-lab.tsx"), "utf8"),
        readFile(path.resolve("playground/src/ui-lab.css"), "utf8"),
        readFile(path.resolve("playground/src/base-tokens.css"), "utf8")
      ])

      expect(home.status).toBe(200)
      expect(home.headers.get("location")).toBeNull()
      expect(await home.text()).toContain("Crit · feature-lab")
      expect(ui.status).toBe(200)
      expect(ui.headers.get("location")).toBeNull()
      expect(await ui.text()).toContain("Crit feature lab")
      expect(mainSource).toContain('window.location.pathname.replace(/\\/+$/, "") === "/ui"')
      expect(uiSource).toContain("Crit UI color assignments")
      expect(uiSource).toContain('mode="inline"')
      expect(uiSource).toContain("greyscale: false")
      expect(uiSource).toContain("lightness: slider(")
      expect(uiSource).toContain("chroma: slider(")
      expect(uiSource).toContain("orange: slider(HUE_DEFAULTS.orange")
      expect(uiSource).toContain("red: slider(HUE_DEFAULTS.red")
      expect(uiSource).toContain("frameStatus: {")
      expect(uiSource).toContain('from "../../src/react/canvas-toolbar.js"')
      expect(uiSource).toContain('from "../../src/react/canvas-feedback.js"')
      expect(uiSource).toContain('from "../../src/react/canvas-context-menu.js"')
      expect(uiSource).toContain('from "../../src/react/comment-popover.js"')
      expect(uiSource).toContain("<FrameCard")
      expect(uiSource).toContain("<NoteCard")
      expect(uiSource).toContain("<CanvasToolbar")
      expect(uiSource).toContain("<NewFrameForm")
      expect(uiSource).toContain("<CommentPopover")
      expect(uiSource).toContain("<CanvasCommentPin")
      expect(uiSource).not.toContain('className="ui-toolbar"')
      expect(uiSource).not.toContain('className="ui-frame"')
      expect(uiSource).not.toContain('className="ui-note"')
      expect(uiSource).not.toContain("function HelpPanel")
      expect(mainSource).toContain("<GlyphProvider><App /></GlyphProvider>")
      expect(uiStyles).toContain(".ui-toolbar-stage .crit-toolbar")
      expect(uiStyles).not.toContain(
        ".ui-lab .crit-frame__chrome { background: var(--ui-frame-chrome-surface); }"
      )
      expect(uiStyles).toContain(
        "--crit-frame-status-in-progress-shell: var(--ui-frame-status-in-progress-shell)"
      )
      expect(uiStyles).toContain(".ui-lab .crit-comment-popover")
      expect(uiStyles).toContain(".ui-lab .crit-new-frame-dialog")
      expect(baseTokens).toContain("--crit-color-s1")
      expect(baseTokens).toContain("--crit-color-t2")
      expect(baseTokens).toContain("--crit-color-orange-s1")
      expect(baseTokens).toContain("--crit-color-blue-p2")
      expect(baseTokens).toContain("--crit-color-green-t1")
      expect(baseTokens).toContain("--crit-color-purple-t2")
      expect(baseTokens).toContain("--crit-color-red-s1")
      expect(baseTokens).toContain("--crit-color-red-t2")
    } finally {
      if (http.listening) {
        await new Promise<void>((resolve, reject) => {
          http.close((cause) => cause ? reject(cause) : resolve())
        })
      }
      await vite.close()
    }
  })

  it("uses the real manifest and semantic command schemas", async () => {
    const packageJson = await readJson("package.json") as {
      readonly scripts?: Record<string, string>
      readonly portless?: { readonly name?: string; readonly script?: string }
    }
    const manifest = await Effect.runPromise(
      CritManifest.decode(
        await readJson("playground/crit.manifest.json"),
        "playground/crit.manifest.json"
      )
    )
    const commands = Schema.decodeUnknownSync(Schema.Array(CanvasCommandSchema))(
      await readJson("playground/feature-lab.commands.json")
    )
    const canvas = manifest.canvases[0]!

    expect(packageJson.scripts?.["dev:portless"]).toBe(
      "PORTLESS_PORT=443 portless"
    )
    expect(packageJson.portless).toEqual({ name: "crit", script: "dev" })
    expect(canvas.id).toBe("feature-lab")
    expect(canvas.frames.map((frame) => frame.id)).toEqual([
      "checkout-draft",
      "checkout-ready",
      "checkout-approved",
      "checkout-changes"
    ])
    expect(canvas.frames.every((frame) => frame.url.startsWith("/frames/"))).toBe(true)
    expect(canvas.frames.every((frame) => frame.status === undefined)).toBe(true)
    expect(canvas.frames.every((frame) => frame.geometry === undefined)).toBe(true)

    expect(
      commands
        .filter((command) => command._tag === "SetFrameStatus")
        .map((command) => command.status)
    ).toEqual([
      "in-progress",
      "ready-for-review",
      "approved",
      "changes-requested"
    ])
    expect(commands.filter((command) => command._tag === "AddNote")).toHaveLength(4)
    expect(commands).toContainEqual({
      _tag: "AttachNote",
      id: "attached-feedback",
      frameId: "checkout-ready"
    })
  })
})
