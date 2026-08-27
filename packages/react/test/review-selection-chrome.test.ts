import { describe, expect, it } from "vitest"

import { resizeGeometry } from "../src/review-selection-chrome.js"

const start = { x: 40, y: 80, width: 320, height: 200 }

describe("resizeGeometry", () => {
  it("grows and shrinks from every corner", () => {
    expect(resizeGeometry(start, "south-east", 20, 10)).toEqual({
      x: 40,
      y: 80,
      width: 340,
      height: 210
    })
    expect(resizeGeometry(start, "north-west", 20, 10)).toEqual({
      x: 60,
      y: 90,
      width: 300,
      height: 190
    })
    expect(resizeGeometry(start, "north-east", 20, 10)).toEqual({
      x: 40,
      y: 90,
      width: 340,
      height: 190
    })
    expect(resizeGeometry(start, "south-west", 20, 10)).toEqual({
      x: 60,
      y: 80,
      width: 300,
      height: 210
    })
  })
})
