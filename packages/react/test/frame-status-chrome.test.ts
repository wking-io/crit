import { describe, expect, it } from "vitest"

import {
  calculateStatusFanLayout,
  frameStatus,
  frameStatusMenuOptions,
  shortIdForIndex,
  statusPillMotionPath
} from "../src/frame-status-chrome.js"

describe("frame status chrome", () => {
  it("keeps the rewrite status table and fan motion path", () => {
    expect(frameStatus("approved").glyph).toBe("statusApproved")
    expect(frameStatus("in-progress").label).toBe("In progress")
    const options = frameStatusMenuOptions("in-progress")
    expect(options.map((option) => option.id)).toEqual([
      "changes-requested",
      "approved",
      "ready-for-review"
    ])
    const fan = calculateStatusFanLayout(options)
    expect(fan.items).toHaveLength(3)
    expect(fan.frameGap).toBeGreaterThan(0)
    const path = statusPillMotionPath({
      startY: fan.items[0]!.startY,
      finalX: fan.items[0]!.finalX,
      finalY: fan.items[0]!.finalY,
      finalRotate: fan.items[0]!.finalRotate
    })
    expect(path.times).toEqual([0, 0.18, 0.36, 0.55, 0.75, 1])
    expect(path.enter.x[0]).toBe(0)
    expect(path.exit.x[0]).toBe(path.enter.x[path.enter.x.length - 1])
    expect(shortIdForIndex(0)).toBe("A")
    expect(shortIdForIndex(25)).toBe("Z")
    expect(shortIdForIndex(26)).toBe("AA")
  })
})
