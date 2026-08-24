import { decodeCanvasProjection } from "@crit/domain"
import { describe, expect, it } from "vitest"

import { framesById } from "../src/projection-index.js"

const projection = decodeCanvasProjection({
  schemaVersion: 3,
  canvasId: "canvas_review",
  title: "Review",
  frames: [{
    frameId: "frame_checkout",
    title: "Checkout",
    representation: { _tag: "web-url", url: "https://example.com/checkout" },
    status: "in-progress",
    geometry: { x: 40, y: 80, width: 320, height: 200 },
    createdByChangeId: "change_1",
    updatedByChangeId: "change_1",
    titleChangedByChangeId: "change_1",
    representationChangedByChangeId: "change_1",
    statusChangedByChangeId: "change_1",
    geometryChangedByChangeId: "change_1"
  }],
  stack: [
    { _tag: "frame", frameId: "frame_checkout" }
  ],
  stackChangedByChangeId: "change_1",
  issuedIds: {
    frameIds: ["frame_checkout"]
  }
})

describe("projection index", () => {
  it("looks up the same Frame objects by id", () => {
    const frame = projection.frames[0]
    expect(frame).toBeDefined()
    if (frame === undefined) return
    expect(framesById(projection.frames).get(frame.frameId)).toBe(frame)
  })

  it("reuses the map while the collection identity is stable", () => {
    expect(framesById(projection.frames)).toBe(framesById(projection.frames))
  })

  it("builds a new map when the collection is replaced", () => {
    const nextFrames = [...projection.frames]
    expect(framesById(nextFrames)).not.toBe(framesById(projection.frames))
    const frame = projection.frames[0]
    expect(frame).toBeDefined()
    if (frame === undefined) return
    expect(framesById(nextFrames).get(frame.frameId)).toBe(frame)
  })
})
