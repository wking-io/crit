import { readFile } from "node:fs/promises"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { Canvas } from "../../src/core/index.js"
import { cameraCenteringGeometry } from "../../src/react/canvas-camera.js"
import { launchSeedDocument } from "../../www/src/document.js"
import {
  INSTALL_COMMAND,
  LAUNCH_CANVAS_ID,
  LAUNCH_FEATURES,
  LAUNCH_FOCUS_ITEM_ID,
  LAUNCH_HERO,
  LAUNCH_NOTE,
  LAUNCH_SIGNUP
} from "../../www/src/layout.js"

describe("Crit website", () => {
  it("seeds the launch Canvas from package commands", () => {
    const document = launchSeedDocument()
    const canvas = Canvas.fromDocument(document)
    const frames = Canvas.listFrames(canvas)
    const notes = Canvas.listNotes(canvas)

    expect(document.id).toBe(LAUNCH_CANVAS_ID)
    expect(document.title).toBe("Crit")
    expect(frames.map((frame) => frame.id)).toEqual([
      LAUNCH_HERO.id,
      LAUNCH_FEATURES.id,
      LAUNCH_SIGNUP.id
    ])
    expect(frames.map((frame) => frame.url)).toEqual([
      LAUNCH_HERO.url,
      LAUNCH_FEATURES.url,
      LAUNCH_SIGNUP.url
    ])
    expect(frames.map((frame) => frame.geometry)).toEqual([
      LAUNCH_HERO.geometry,
      LAUNCH_FEATURES.geometry,
      LAUNCH_SIGNUP.geometry
    ])
    expect(INSTALL_COMMAND).toBe("npx @riff-refine/crit init")
    expect(notes).toMatchObject([{
      id: LAUNCH_NOTE.id,
      text: LAUNCH_NOTE.text,
      geometry: {
        x: LAUNCH_NOTE.x,
        y: LAUNCH_NOTE.y,
        width: LAUNCH_NOTE.width
      },
      color: LAUNCH_NOTE.color
    }])
  })

  it("keeps the satellite nodes inside the default-zoom view around the hero", () => {
    const viewport = { width: 1280, height: 800 }
    const camera = cameraCenteringGeometry(
      LAUNCH_HERO.geometry,
      viewport,
      0.65
    )
    const visible = {
      left: -camera.x / camera.zoom,
      top: -camera.y / camera.zoom,
      right: (viewport.width - camera.x) / camera.zoom,
      bottom: (viewport.height - camera.y) / camera.zoom
    }
    const nodes = [
      LAUNCH_FEATURES.geometry,
      LAUNCH_SIGNUP.geometry,
      {
        x: LAUNCH_NOTE.x,
        y: LAUNCH_NOTE.y,
        width: LAUNCH_NOTE.width,
        height: LAUNCH_NOTE.height
      }
    ]

    expect(camera.zoom).toBe(0.65)
    for (const geometry of nodes) {
      expect(geometry.x).toBeGreaterThanOrEqual(visible.left)
      expect(geometry.y).toBeGreaterThanOrEqual(visible.top)
      expect(geometry.x + geometry.width).toBeLessThanOrEqual(visible.right)
      expect(geometry.y + geometry.height).toBeLessThanOrEqual(visible.bottom)
    }
  })

  it("keeps the launch site in www and imports UI from the package", async () => {
    const [pagesSource, siteSource, mainSource, playgroundMain] =
      await Promise.all([
        readFile(path.resolve("www/src/pages.tsx"), "utf8"),
        readFile(path.resolve("www/src/site.tsx"), "utf8"),
        readFile(path.resolve("www/src/main.tsx"), "utf8"),
        readFile(path.resolve("playground/src/main.tsx"), "utf8")
      ])

    expect(pagesSource).toContain('from "@riff-refine/crit"')
    expect(pagesSource).not.toContain("playground/")
    expect(pagesSource).toContain("Using AI shouldn&apos;t mean you have to work like a dev")
    expect(pagesSource).toContain("Install with your agent")
    expect(pagesSource).toContain('name="copy"')
    expect(pagesSource).toContain("Get email updates")
    expect(pagesSource).toContain("Live Frames from any URL")
    expect(siteSource).toContain("BrowserCritClient")
    expect(siteSource).toContain(`canvasId={LAUNCH_CANVAS_ID}`)
    expect(siteSource).toContain("onSignIn")
    expect(siteSource).toContain(`focusItemId={LAUNCH_FOCUS_ITEM_ID}`)
    expect(mainSource).toContain("<LaunchSite />")
    expect(mainSource).toContain("launchPageFromPath")
    expect(playgroundMain).not.toContain("LaunchSite")
    expect(playgroundMain).not.toContain("launch/")
  })
})
