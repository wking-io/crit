import { describe, expect, it } from "vitest"

import { parseFrameBridgeParentOrigin } from "../src/html.js"
import {
  frameAncestorsNamesOrigin,
  renderCloudflarePagesHeadersFile,
  renderFrameAncestorsContentSecurityPolicy,
  renderFrameAncestorsResponseHeaders
} from "../src/headers.js"

describe("Frame Bridge headers", () => {
  it("renders a frame-ancestors CSP for the exact parent origin", () => {
    const parentOrigin = parseFrameBridgeParentOrigin("https://crit.acme.internal")
    if (parentOrigin === undefined) throw new Error("Expected a valid parent origin")

    expect(renderFrameAncestorsContentSecurityPolicy({ parentOrigin }))
      .toBe("frame-ancestors https://crit.acme.internal")
    expect(renderFrameAncestorsResponseHeaders({ parentOrigin }))
      .toEqual({
        "content-security-policy": "frame-ancestors https://crit.acme.internal"
      })
    expect(renderCloudflarePagesHeadersFile({ parentOrigin }))
      .toBe("/*\n  Content-Security-Policy: frame-ancestors https://crit.acme.internal\n")
  })

  it("detects when frame-ancestors names the Crit host", () => {
    const parentOrigin = parseFrameBridgeParentOrigin("https://crit.acme.internal")
    if (parentOrigin === undefined) throw new Error("Expected a valid parent origin")

    expect(frameAncestorsNamesOrigin(
      "frame-ancestors https://crit.acme.internal",
      parentOrigin
    )).toBe(true)
    expect(frameAncestorsNamesOrigin(
      "default-src 'self'; frame-ancestors https://crit.acme.internal",
      parentOrigin
    )).toBe(true)
    expect(frameAncestorsNamesOrigin(undefined, parentOrigin)).toBe(false)
    expect(frameAncestorsNamesOrigin("default-src 'self'", parentOrigin)).toBe(false)
    expect(frameAncestorsNamesOrigin(
      "frame-ancestors https://evil.example",
      parentOrigin
    )).toBe(false)
  })
})
