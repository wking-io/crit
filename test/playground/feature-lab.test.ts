import { readFile } from "node:fs/promises"
import { createServer as createHttpServer } from "node:http"
import path from "node:path"

import { describe, expect, it } from "vitest"
import { Effect, Schema } from "effect"
import { createServer } from "vite"

import { CanvasCommandSchema } from "../../src/core/index.js"
import { CritManifest } from "../../src/discovery/index.js"
import {
  isOrbFrameSource,
  playgroundMode,
  playgroundPublicUrl
} from "../../playground/vite.config.js"
import {
  resolvePlaygroundProfile
} from "../../playground/src/playground-profile.js"
import { migrateLegacyPlaygroundCanvas } from "../../playground/migrate-state.mjs"
import { serverPort } from "../support/server-address.js"

const readJson = async (file: string) =>
  JSON.parse(await readFile(path.resolve(file), "utf8"))

describe("Crit feature lab", () => {
  it("uses the stable Portless URL as the browser-visible origin", () => {
    expect(playgroundPublicUrl({
      PORTLESS_URL: "http://crit.local"
    })).toBe("http://crit.local")
    expect(playgroundPublicUrl({
      PORTLESS_URL: "http://crit.local",
      PUBLIC_URL: "https://review.example"
    })).toBe("https://review.example")
    expect(playgroundPublicUrl({})).toBeUndefined()
  })

  it("defaults to full development features and can emulate an alpha release", () => {
    expect(playgroundMode({})).toBe("development")
    expect(playgroundMode({ CRIT_PLAYGROUND_MODE: "alpha" })).toBe("alpha")
    expect(playgroundMode({ CRIT_PLAYGROUND_MODE: "release" })).toBe("release")
  })

  it("resolves the live playground profile from URL, then cookie, then storage", () => {
    expect(resolvePlaygroundProfile({})).toBe("development")
    expect(resolvePlaygroundProfile({ url: "alpha" })).toBe("alpha")
    expect(resolvePlaygroundProfile({
      url: "nope",
      cookie: "other=1; crit-playground-profile=release"
    })).toBe("release")
    expect(resolvePlaygroundProfile({
      cookie: "crit-playground-profile=nope",
      stored: "alpha"
    })).toBe("alpha")
    expect(resolvePlaygroundProfile({
      stored: "nope",
      fallback: "release"
    })).toBe("release")
  })

  it("preserves legacy playground state while adding required identities", () => {
    const author = { id: "git:test", name: "Test Author" }
    const legacy = {
      format: "crit-canvas",
      version: 1,
      id: "feature-lab",
      owner: null,
      notes: [
        { id: "legacy", text: "Keep me", extension: { retained: true } },
        { id: "authored", text: "Keep my Author", author: { id: "git:other", name: "Other" } }
      ],
      revision: 42,
      extension: { retained: true }
    }

    expect(migrateLegacyPlaygroundCanvas(legacy, author)).toEqual({
      ...legacy,
      owner: author,
      notes: [
        {
          id: "legacy",
          text: "Keep me",
          extension: { retained: true },
          author
        },
        legacy.notes[1]
      ]
    })
    const current = { ...legacy, owner: author }
    expect(migrateLegacyPlaygroundCanvas(current, author)).toBe(current)
    expect(() => migrateLegacyPlaygroundCanvas({
      format: "crit-canvas",
      version: 1,
      owner: null,
      notes: "invalid"
    }, author)).toThrow(/Expected array/)
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
      const response = await fetch(`http://127.0.0.1:${serverPort(http)}/synth?variant=B&preview=1`, { headers: { Connection: "close" } })
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
      expect(html).toContain("@riff-refine/crit/frame-comments")
    } finally {
      if (http.listening) await new Promise<void>((resolve, reject) => http.close((cause) => cause ? reject(cause) : resolve()))
      await vite.close()
      if (previous === undefined) delete process.env.AMP_ORB
      else process.env.AMP_ORB = previous
    }
  })

  it("omits the comment bridge from orb frames in alpha playground mode", async () => {
    const previousOrb = process.env.AMP_ORB
    const previousMode = process.env.CRIT_PLAYGROUND_MODE
    process.env.AMP_ORB = "1"
    process.env.CRIT_PLAYGROUND_MODE = "alpha"
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
      const response = await fetch(
        `http://127.0.0.1:${serverPort(http)}/synth?variant=B&preview=1`,
        { headers: { Connection: "close" } }
      )
      const html = await response.text()
      expect(response.status).toBe(200)
      expect(html).not.toContain("@riff-refine/crit/frame-comments")
    } finally {
      if (http.listening) {
        await new Promise<void>((resolve, reject) => {
          http.close((cause) => cause ? reject(cause) : resolve())
        })
      }
      await vite.close()
      if (previousOrb === undefined) delete process.env.AMP_ORB
      else process.env.AMP_ORB = previousOrb
      if (previousMode === undefined) delete process.env.CRIT_PLAYGROUND_MODE
      else process.env.CRIT_PLAYGROUND_MODE = previousMode
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
      const port = serverPort(http)
      const origin = `http://127.0.0.1:${port}`
      const [home, ui, mainSource, uiSource, uiStyles, baseTokens, frameCardSource, editorShell] = await Promise.all([
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
        readFile(path.resolve("src/react/frame-card.tsx"), "utf8"),
        readFile(path.resolve("playground/src/editor-shell.tsx"), "utf8")
      ])

      expect(home.status).toBe(200)
      expect(home.headers.get("location")).toBeNull()
      expect(await home.text()).toContain("Crit · feature-lab")
      expect(editorShell).not.toContain('aria-label="Playground version"')
      expect(editorShell).not.toContain("PlaygroundProfileSelector")
      expect(editorShell).not.toContain('className="playground-profile"')
      expect(editorShell).not.toContain("editor-shell.css")
      expect(editorShell).toContain("extraCanvasContextMenus")
      expect(editorShell).toContain('label: "Playground"')
      expect(editorShell).toContain("Development")
      expect(editorShell).toContain("Alpha")
      expect(editorShell).toContain("Release")
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
      expect(uiSource).toContain('import { Toast } from "@base-ui/react/toast"')
      expect(uiSource).toContain('import { Tooltip } from "@base-ui/react/tooltip"')
      expect(uiSource).toContain('<Toast.Provider limit={1} timeout={1200}>')
      expect(uiSource).toContain("<Tooltip.Root>")
      expect(uiSource).toContain('description: "copied"')
      expect(uiSource).not.toContain("function UiTooltip")
      expect(uiStyles).toContain(".ui-color-toast-viewport")
      expect(uiStyles).toContain(".ui-tooltip[data-starting-style]")
      expect(uiStyles).toContain(".ui-color-toast-positioner[data-anchor-hidden]")
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
      expect(uiSource).toContain("CritMenuSpecimen")
      expect(uiSource).toContain('label: "Playground"')
      expect(uiSource).toContain("hover Playground for submenu")
      expect(uiSource).not.toContain("CritContextMenu")
      expect(uiSource).toContain("CritOverlayProvider")
      expect(uiSource).toContain("container={overlayContainer}")
      expect(uiSource).toContain('from "../../src/react/comment-popover.js"')
      expect(uiSource).toContain("<FrameCard")
      expect(uiSource).toContain("defaultStatusMenuOpen")
      expect(uiSource).toContain("<NoteCard")
      expect(uiSource).toContain("<CanvasToolbar")
      expect(uiSource).toContain("LAB_AGENT_IDENTITIES")
      expect(uiSource).toContain("Agent popovers")
      expect(uiSource).toContain('className="crit-presence__name"')
      expect(uiSource).toContain('className="crit-presence__secondary"')
      expect(uiStyles).toContain(".ui-presence-popovers")
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
      expect(uiStyles).toContain(":is(.ui-lab, .ui-lab-overlays) .crit-comment-popover")
      expect(uiStyles).toContain(":is(.ui-lab, .ui-lab-overlays) .crit-new-frame-dialog")
      expect(uiStyles).toContain(
        '.ui-lab-shell[data-greyscale="true"] .ui-lab-overlays :is('
      )
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
    const packageJson = Schema.decodeUnknownSync(Schema.Struct({
      scripts: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
      portless: Schema.optionalKey(Schema.Struct({
        name: Schema.optionalKey(Schema.String),
        script: Schema.optionalKey(Schema.String)
      }))
    }))(await readJson("package.json"))
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
      "synth-rack",
      "prototype-eyes-randomized",
      "prototype-eyes-art-directed",
      "prototype-pattern-directions",
      "prototype-pattern-color-mixing",
      "prototype-pattern-family-review",
      "prototype-pattern-density-review",
      "prototype-pattern-character-review"
    ])
    expect(canvas.frames.map((frame) => frame.url)).toEqual([
      "/synth?variant=A&preview=1",
      "/synth?variant=B&preview=1",
      "/synth?variant=C&preview=1",
      "/ui/prototypes/eyes-randomized",
      "/ui/prototypes/eyes-art-directed",
      "/ui/prototypes/pattern-directions",
      "/ui/prototypes/pattern-color-mixing",
      "/pattern-review-prototype.html",
      "/pattern-review-prototype-v2.html",
      "/pattern-review-prototype-v3.html"
    ])
    expect(canvas.frames.map((frame) => frame.title)).toEqual([
      "Polyphonic Workbench",
      "Performance Deck",
      "Signal Rack",
      "Randomized Eye Systems",
      "Art-directed Eye Systems",
      "Three Pattern Directions",
      "Mixed-color Pattern Study",
      "Woven Pattern Family Review",
      "Woven Pattern Density Review",
      "Woven Pattern Character Review"
    ])
    expect(canvas.frames.map((frame) => frame.status)).toEqual([
      "approved",
      "changes-requested",
      "in-progress",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined
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
