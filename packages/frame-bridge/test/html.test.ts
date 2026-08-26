import { describe, expect, it } from "vitest"

import {
  FRAME_ROUTE_BRIDGE_HTML_MARKER,
  parseFrameBridgeParentOrigin,
  renderFrameRouteBridgeTag
} from "../src/html.js"

describe("Frame Bridge HTML", () => {
  it.each([
    undefined,
    "null",
    "https://person:secret@example.com",
    "ftp://example.com",
    "not an origin",
    "http://127.0.0.1:5173/app",
    "http://127.0.0.1:5173?x=1",
    "http://127.0.0.1:5173#hash"
  ])("rejects an invalid parent origin", (value) => {
    expect(parseFrameBridgeParentOrigin(value)).toBeUndefined()
  })

  it("accepts and brands an HTTP loopback parent origin", () => {
    expect(parseFrameBridgeParentOrigin("http://127.0.0.1:5173"))
      .toBe("http://127.0.0.1:5173")
  })

  it("renders one marked script for the exact parent origin", () => {
    const parentOrigin = parseFrameBridgeParentOrigin("https://review.example.com")
    if (parentOrigin === undefined) throw new Error("Expected a valid parent origin")

    const html = renderFrameRouteBridgeTag({ parentOrigin })

    expect(html.split(FRAME_ROUTE_BRIDGE_HTML_MARKER)).toHaveLength(2)
    expect(html).toContain(`<script ${FRAME_ROUTE_BRIDGE_HTML_MARKER}="">`)
    expect(html).toContain(JSON.stringify(parentOrigin))
    expect(html).not.toContain('"*"')
    expect(html).not.toMatch(/postMessage\([\s\S]*?,\s*["']\*["']\s*\)/)
  })
})
