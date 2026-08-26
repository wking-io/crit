import { CanvasTitle, emptyCanvasProjection, Id } from "@crit/domain"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import { projectionDigest } from "../src/index.js"

const title = Schema.decodeUnknownSync(CanvasTitle)("Checkout")

describe("projectionDigest", () => {
  it("is stable for the same projection and changes when the title changes", () => {
    const canvasId = Id.canvas("canvas_checkout")
    const first = projectionDigest(emptyCanvasProjection(canvasId, title))
    const second = projectionDigest(emptyCanvasProjection(canvasId, title))
    const renamed = projectionDigest(
      emptyCanvasProjection(
        canvasId,
        Schema.decodeUnknownSync(CanvasTitle)("Renamed")
      )
    )

    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(second).toBe(first)
    expect(renamed).not.toBe(first)
  })
})
