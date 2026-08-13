import { readFile } from "node:fs/promises"
import { createServer as createHttpServer } from "node:http"
import type { AddressInfo } from "node:net"
import path from "node:path"

import { describe, expect, it } from "vitest"
import { Effect, Schema } from "effect"
import { createServer } from "vite"

import { CanvasCommandSchema } from "../../src/core/index.js"
import { CritManifest } from "../../src/discovery/index.js"
import { isOrbFrameSource } from "../../playground/vite.config.js"
import { migrateLegacyPlaygroundCanvas } from "../../playground/migrate-state.mjs"

const readJson = async (file: string) =>
  JSON.parse(await readFile(path.resolve(file), "utf8")) as unknown

describe("Crit feature lab", () => {
  it("preserves legacy playground state while adding required identities", () => {
    const author = { id: "git:test", name: "Test Author" }
    const legacy = {
      format: "crit-canvas",
      version: 1,
      id: "feature-lab",
      owner: null,
      notes: [
        { id: "legacy", text: "Keep me" },
        { id: "authored", text: "Keep my Author", author: { id: "git:other", name: "Other" } }
      ],
      revision: 42
    }

    expect(migrateLegacyPlaygroundCanvas(legacy, author)).toEqual({
      ...legacy,
      owner: author,
      notes: [
        { id: "legacy", text: "Keep me", author },
        legacy.notes[1]
      ]
    })
    const current = { ...legacy, owner: author }
    expect(migrateLegacyPlaygroundCanvas(current, author)).toBe(current)
  })

  it("reloads inline orb frames for first-party frame dependencies", () => {
    expect(isOrbFrameSource(path.resolve("playground/src/frame-entry.tsx"))).toBe(true)
    expect(isOrbFrameSource(path.resolve("src/react/frame-card.tsx"))).toBe(true)
    expect(isOrbFrameSource(path.resolve("src/frame-bridge/index.ts"))).toBe(true)
    expect(isOrbFrameSource(path.resolve("docs/example.css"))).toBe(false)
  })

  it("serves orb frame routes as self-contained HTML", async () => {
    const previous = process.env.AMP_ORB
    process.env.AMP_ORB = "1"
    const vite = await createServer({ configFile: path.resolve("playground/vite.config.ts"), logLevel: "silent", server: { middlewareMode: true } })
    const http = createHttpServer(vite.middlewares)
    try {
      await new Promise<void>((resolve, reject) => { http.once("error", reject); http.listen(0, "127.0.0.1", resolve) })
      const response = await fetch(`http://127.0.0.1:${(http.address() as AddressInfo).port}/synth?variant=B&preview=1`, { headers: { Connection: "close" } })
      const html = await response.text()
      expect(response.status).toBe(200)
      expect(response.headers.get("x-amp-review-widget")).toBe("off")
      expect(html).toContain('<meta name="crit-frame-url" content="/synth?variant=B&amp;preview=1">')
      expect(html).toMatch(/<style>[^<]+/)
      expect(html).toContain("Performance instrument")
      expect(html).toContain("ASTRA")
      expect(html).not.toContain("<script src=")
      expect(html).not.toContain("<link rel=stylesheet")
      expect(html).not.toContain("/@vite/client")
    } finally {
      if (http.listening) await new Promise<void>((resolve, reject) => http.close((cause) => cause ? reject(cause) : resolve()))
      await vite.close()
      if (previous === undefined) delete process.env.AMP_ORB
      else process.env.AMP_ORB = previous
    }
  })

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
      const [home, ui, mainSource, uiSource, uiStyles, baseTokens, frameCardSource] = await Promise.all([
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
        readFile(path.resolve("playground/src/base-tokens.css"), "utf8"),
        readFile(path.resolve("src/react/frame-card.tsx"), "utf8")
      ])

      expect(home.status).toBe(200)
      expect(home.headers.get("location")).toBeNull()
      expect(await home.text()).toContain("Crit · feature-lab")
      expect(ui.status).toBe(200)
      expect(ui.headers.get("location")).toBeNull()
      expect(await ui.text()).toContain("Crit feature lab")
      expect(mainSource).toContain("frameRouteUrl()")
      expect(mainSource).toContain('pathname.replace(/\\/+$/, "") === "/ui"')
      expect(uiSource).toContain("Crit UI color assignments")
      expect(uiSource).toContain("navigator.clipboard.writeText(color)")
      expect(uiSource).toContain('document.execCommand("copy")')
      expect(uiSource).toContain("oklchToHex(oklch)")
      expect(uiSource).toContain("1200")
      expect(uiSource).toContain('mode="inline"')
      expect(uiSource).toContain("greyscale: false")
      expect(uiSource).toContain("lightness: slider(")
      expect(uiSource).toContain("chroma: slider(")
      expect(uiSource).toContain("orange: slider(HUE_DEFAULTS.orange")
      expect(uiSource).toContain("red: slider(HUE_DEFAULTS.red")
      expect(uiSource).toContain("red: 9")
      expect(uiSource).toContain("orange: 55")
      expect(uiSource.indexOf('{ id: "red"')).toBeLessThan(
        uiSource.indexOf('{ id: "orange"')
      )
      expect(uiSource.indexOf("red: slider(HUE_DEFAULTS.red")).toBeLessThan(
        uiSource.indexOf("orange: slider(HUE_DEFAULTS.orange")
      )
      expect(uiSource).toContain('title: tokenSelect("--crit-color-t2")')
      expect(uiSource).toContain('description: tokenSelect("--crit-color-t1")')
      expect(uiSource).toContain('shortcutSurface: tokenSelect("--crit-color-c1")')
      expect(uiSource).toContain('shortcutBorder: tokenSelect("--crit-color-c3")')
      expect(uiSource).not.toContain('selectedOutline: tokenSelect("--crit-color-t1")')
      expect(uiSource).not.toContain("\n  frame: {\n")
      expect(uiSource).not.toContain("frameStatus: {")
      expect(uiSource).not.toContain("\n  note: {\n")
      expect(uiSource).toContain('from "../../src/react/canvas-toolbar.js"')
      expect(uiSource).toContain('from "../../src/react/canvas-feedback.js"')
      expect(uiSource).toContain('from "../../src/react/canvas-context-menu.js"')
      expect(uiSource).toContain('from "../../src/react/comment-popover.js"')
      expect(uiSource).toContain("<FrameCard")
      expect(uiSource).toContain("defaultStatusMenuOpen")
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
      expect(uiStyles).not.toContain(".ui-lab .crit-status-option")
      expect(uiStyles).not.toContain("--crit-frame-status-")
      expect(uiStyles).not.toContain(".ui-lab .crit-selection { box-shadow:")
      expect(uiStyles).not.toContain(".ui-lab .crit-note")
      expect(uiStyles).toContain(".ui-lab .crit-comment-popover")
      expect(uiStyles).toContain(".ui-lab .crit-new-frame-dialog")
      expect(uiStyles).not.toContain(
        ".ui-lab .crit-selection { box-shadow: 0 0 0 1.5px var(--ui-frame-selected-outline); }"
      )
      expect(frameCardSource).toContain('ink="var(--frame-ink)"')
      expect(baseTokens).toContain("--crit-color-s1")
      expect(baseTokens).toContain("--crit-color-t2")
      expect(baseTokens).toContain("--crit-color-orange-s1")
      expect(baseTokens).toContain("--crit-color-blue-p2")
      expect(baseTokens).toContain("--crit-color-green-t1")
      expect(baseTokens).toContain("--crit-color-purple-t2")
      expect(baseTokens).toContain("--crit-color-red-s1")
      expect(baseTokens).toContain("--crit-color-red-t2")
      expect(baseTokens).toContain("--crit-color-red-p2: oklch(65% 0.2 9)")
      expect(baseTokens).toContain("--crit-color-orange-p2: oklch(65% 0.2 55)")
      expect(baseTokens.indexOf("--crit-color-red-s1")).toBeLessThan(
        baseTokens.indexOf("--crit-color-orange-s1")
      )
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
      "synth-workbench",
      "synth-performance",
      "synth-rack"
    ])
    expect(canvas.frames.map((frame) => frame.url)).toEqual([
      "/synth?variant=A&preview=1",
      "/synth?variant=B&preview=1",
      "/synth?variant=C&preview=1"
    ])
    expect(canvas.frames.map((frame) => frame.title)).toEqual([
      "Polyphonic Workbench",
      "Performance Deck",
      "Signal Rack"
    ])
    expect(canvas.frames.map((frame) => frame.status)).toEqual([
      "approved",
      "changes-requested",
      "in-progress"
    ])
    expect(canvas.frames.every((frame) => frame.geometry !== undefined)).toBe(true)

    expect(
      commands
        .filter((command) => command._tag === "SetFrameStatus")
        .map((command) => command.status)
    ).toEqual([])
    expect(commands.filter((command) => command._tag === "AddNote")).toHaveLength(1)
  })
})
