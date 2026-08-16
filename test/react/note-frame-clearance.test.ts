import { describe, expect, it } from "vitest"

import {
  NOTE_FRAME_CLEARANCE,
  noteFrameClearance
} from "../../src/react/note-frame-clearance.js"

const frame = { x: 300, y: 0, width: 400, height: 500 }

describe("Note Frame clearance", () => {
  it("leaves a Note unchanged when it already has the visual clearance", () => {
    const geometry = { x: 50, y: 80, width: 230, height: 100 }

    expect(noteFrameClearance({ geometry, frames: [frame], zoom: 1 }))
      .toBe(geometry)
  })

  it("anchors the near edge and expands the Note away from the Frame", () => {
    const geometry = { x: 50, y: 80, width: 332, height: 100 }
    const projected = noteFrameClearance({ geometry, frames: [frame], zoom: 1 })

    expect(projected.x).toBe(-NOTE_FRAME_CLEARANCE - 32)
    expect(frame.x - projected.x - projected.width)
      .toBe(NOTE_FRAME_CLEARANCE)
    expect(projected.y).toBe(geometry.y)
  })

  it("keeps a left-adjacent Note on the left when moving below is shorter", () => {
    const nearbyFrame = { x: 300, y: 0, width: 400, height: 200 }
    const anchor = { x: 50, y: 150, width: 230, height: 86 }
    const geometry = { x: 50, y: 150, width: 332, height: 86 }
    const projected = noteFrameClearance({
      anchor,
      geometry,
      frames: [nearbyFrame],
      zoom: 1
    })

    expect(projected).toEqual({ ...geometry, x: -52 })
  })

  it("keeps the horizontal side for a diagonally placed Note", () => {
    const nearbyFrame = { x: 300, y: 0, width: 400, height: 200 }
    const anchor = { x: 50, y: 210, width: 230, height: 86 }
    const geometry = { x: 50, y: 210, width: 332, height: 86 }
    const projected = noteFrameClearance({
      anchor,
      geometry,
      frames: [nearbyFrame],
      zoom: 1
    })

    expect(projected).toEqual({ ...geometry, x: -52 })
  })

  it("keeps repeated size measurements on the anchored side", () => {
    const nearbyFrame = { x: 300, y: 0, width: 400, height: 200 }
    const anchor = { x: 50, y: 150, width: 230, height: 86 }
    const atWidths = [280, 300, 332].map((width) => noteFrameClearance({
      anchor,
      geometry: { ...anchor, width },
      frames: [nearbyFrame],
      zoom: 1
    }))

    expect(atWidths.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 0, y: 150 },
      { x: -20, y: 150 },
      { x: -52, y: 150 }
    ])
  })

  it("keeps the clearance at 20 screen pixels at fractional zoom", () => {
    const zoom = .5
    const geometry = { x: 100, y: 50, width: 500, height: 400 }
    const projected = noteFrameClearance({ geometry, frames: [frame], zoom })

    expect((frame.x - projected.x - projected.width) * zoom)
      .toBe(NOTE_FRAME_CLEARANCE)
  })

  it("does not reject its own horizontal edge candidate at 52% zoom", () => {
    const zoom = .52
    const anchor = {
      x: -454.0542089339664,
      y: 516.7946639587549,
      width: 520,
      height: 86
    }
    const geometry = {
      ...anchor,
      width: 332 / zoom,
      height: 166
    }
    const frameAtZoom = {
      x: 80,
      y: 100,
      width: 1280,
      height: 813.8461538461538
    }
    const projected = noteFrameClearance({
      anchor,
      geometry,
      frames: [frameAtZoom],
      zoom
    })

    expect(projected.x).toBe(
      frameAtZoom.x - NOTE_FRAME_CLEARANCE / zoom - geometry.width
    )
    expect(projected.y).toBe(anchor.y)
  })

  it("moves an overlapping Note to the nearest clear Frame edge", () => {
    const geometry = { x: 250, y: 200, width: 200, height: 100 }

    expect(noteFrameClearance({ geometry, frames: [frame], zoom: 1 }))
      .toEqual({ ...geometry, x: 80 })
  })

  it("finds a position clear of multiple Frames", () => {
    const geometry = { x: 250, y: 200, width: 200, height: 100 }
    const frames = [
      frame,
      { x: 0, y: 150, width: 280, height: 250 }
    ]
    const projected = noteFrameClearance({ geometry, frames, zoom: 1 })

    for (const candidate of frames) {
      const separated =
        projected.x + projected.width <= candidate.x - NOTE_FRAME_CLEARANCE ||
        projected.x >= candidate.x + candidate.width + NOTE_FRAME_CLEARANCE ||
        projected.y + projected.height <= candidate.y - NOTE_FRAME_CLEARANCE ||
        projected.y >= candidate.y + candidate.height + NOTE_FRAME_CLEARANCE
      expect(separated).toBe(true)
    }
  })
})
