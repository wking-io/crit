import { readFile } from "node:fs/promises"

import { describe, expect, it } from "vitest"

import { critStyles } from "../../src/react/crit-styles.js"
import { STATUS_PILL_MOTION } from "../../src/react/frame-chrome.js"

describe("Frame status positioning", () => {
  it("positions every frame status menu in the canvas underlay coordinate space", async () => {
    const source = await readFile(
      new URL("../../src/react/frame-card.tsx", import.meta.url),
      "utf8"
    )

    expect(source).toContain("const underlayContainer = useCritUnderlayContainer()")
    expect(source).toContain("<Menu.Portal container={underlayContainer}>")
    expect(source).not.toContain("<Menu.Portal container={frameRef}>")
    expect(source).toContain('anchor={frameRef}')
    expect(source).toContain('align="start"')
    expect(source).toContain('side="top"')
  })

  it("closes the status fan in exactly 200ms", () => {
    expect(STATUS_PILL_MOTION.close).toEqual({
      duration: 0.2,
      ease: "easeOut"
    })
  })

  it("preserves the complete status-pill styling inside that underlay", () => {
    expect(critStyles).toMatch(
      /\.crit-underlay-container \.crit-status-option,[^{]*\{[^}]*background: var\(--status-shell\);/s
    )
    expect(critStyles).toMatch(
      /\.crit-underlay-container \.crit-status-option,[^{]*\{[^}]*box-sizing: border-box;/s
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
