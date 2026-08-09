import { describe, expect, it } from "vitest"

import { CANVAS_HELP_MOTION } from "../../src/react/canvas-help.js"

describe("Canvas help notification motion", () => {
  it("matches the wking tooltip open and close animation", () => {
    expect(CANVAS_HELP_MOTION).toEqual({
      closed: { opacity: 0, scale: 0.96, y: 4 },
      open: { opacity: 1, scale: 1, y: 0 },
      transition: {
        opacity: { duration: 0.12, ease: [0.25, 0.1, 0.25, 1] },
        scale: { duration: 0.16, ease: [0.22, 1, 0.36, 1] },
        y: { duration: 0.16, ease: [0.22, 1, 0.36, 1] }
      }
    })
  })
})
