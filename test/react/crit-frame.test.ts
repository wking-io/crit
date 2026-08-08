import { describe, expect, it } from "vitest"

import {
  CritFrameShapeUtil,
  isFrameInteractiveTool
} from "../../src/react/crit-frame.js"
import {
  critFrameMigrations,
  critFrameProps
} from "../../src/core/internal/tldraw-schema.js"

describe("CritFrameShapeUtil", () => {
  it("uses the same schema contract as the headless core", () => {
    expect(CritFrameShapeUtil.type).toBe("crit-frame")
    expect(CritFrameShapeUtil.props).toBe(critFrameProps)
    expect(CritFrameShapeUtil.migrations).toBe(critFrameMigrations)
  })

  it("only lets the select tool interact with embedded pages", () => {
    expect(isFrameInteractiveTool("select")).toBe(true)
    expect(isFrameInteractiveTool("draw")).toBe(false)
    expect(isFrameInteractiveTool("highlight")).toBe(false)
    expect(isFrameInteractiveTool("arrow")).toBe(false)
  })
})
