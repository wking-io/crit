import { readFile } from "node:fs/promises"

import { describe, expect, it } from "vitest"

import { critStyles } from "../../src/react/crit-styles.js"
import { STATUS_PILL_MOTION } from "../../src/react/frame-chrome.js"
import { statusMenuFrameZIndex } from "../../src/react/frame-card.js"

const cssRule = (selector: string) => {
  const start = critStyles.indexOf(`${selector} {`)
  if (start < 0) return ""
  const end = critStyles.indexOf("}", start)
  return critStyles.slice(start, end + 1)
}

describe("Frame status positioning", () => {
  it("temporarily stacks the active frame above every Canvas item", () => {
    expect(statusMenuFrameZIndex(3, 11, false)).toBe(3)
    expect(statusMenuFrameZIndex(3, 11, true)).toBe(11)
  })

  it("keeps the pills inside and behind the active frame stacking context", async () => {
    const source = await readFile(
      new URL("../../src/react/frame-card.tsx", import.meta.url),
      "utf8"
    )

    expect(source).toContain("const [statusMenuLayerActive")
    expect(source).toContain("statusMenuFrameZIndex(")
    expect(source).toContain("setStatusMenuLayerActive(false)")
    expect(source).toContain("<Menu.Portal container={frameRef}>")
    expect(source).toContain('<Menu.Positioner')
    expect(cssRule(".crit-status-positioner")).toContain("z-index: -1")
  })

  it("positions every status fan in its frame-local coordinate space", async () => {
    const source = await readFile(
      new URL("../../src/react/frame-card.tsx", import.meta.url),
      "utf8"
    )

    expect(source).not.toContain("useCritUnderlayContainer")
    expect(source).toContain("<Menu.Portal container={frameRef}>")
    expect(source).toContain('className="crit-status-positioner"')
    expect(source).toContain('"--crit-status-frame-gap"')
    expect(cssRule(".crit-status-positioner")).toContain(
      "transform: none !important"
    )
    expect(cssRule(".crit-status-menu")).toContain("position: absolute")
    expect(cssRule(".crit-status-menu")).toContain(
      "bottom: var(--crit-status-frame-gap, 0)"
    )
  })

  it("closes the status fan in exactly 200ms", () => {
    expect(STATUS_PILL_MOTION.close).toEqual({
      duration: 0.2,
      ease: "easeOut"
    })
  })

  it("preserves the complete status-pill styling inside the Canvas", () => {
    expect(critStyles).toMatch(
      /\.crit-canvas \.crit-status-option,[^{]*\{[^}]*background: var\(--status-shell\);/s
    )
    expect(critStyles).toMatch(
      /\.crit-canvas \.crit-status-option,[^{]*\{[^}]*box-sizing: border-box;/s
    )
  })

  it("drives the entire arc from one bounded spring progress value", async () => {
    const source = await readFile(
      new URL("../../src/react/frame-card.tsx", import.meta.url),
      "utf8"
    )

    expect(source).toContain("const progress = useMotionValue(0)")
    expect(source).toMatch(/animate\(\s*progress,\s*isPresent \? 1 : 0/s)
    expect(source).toMatch(
      /useTransform\(\s*progress,\s*motionPath\.times/s
    )
    expect(source).not.toContain("x: motionPath.enter.x")
    expect(source).not.toContain("y: motionPath.enter.y")
    expect(source).not.toContain("rotate: motionPath.enter.rotate")
  })
})
