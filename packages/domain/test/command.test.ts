import { describe, expect, it } from "vitest"

import { decodeCanvasCommandBatch } from "../src/command.js"

describe("CanvasCommandBatch", () => {
  it("requires a nonempty ordered command batch", () => {
    expect(() => decodeCanvasCommandBatch([])).toThrow()
    const commands = decodeCanvasCommandBatch([
      { _tag: "rename-canvas", expectedTitle: "One", title: "Two" },
      { _tag: "rename-canvas", expectedTitle: "Two", title: "Three" }
    ])
    expect(commands.map(({ title }) => title)).toEqual(["Two", "Three"])
  })

  it("rejects malformed and authority-authored command fields", () => {
    for (const command of [
      { _tag: "rename-canvas", expectedTitle: "", title: "Two" },
      { _tag: "rename-canvas", expectedTitle: " One ", title: "Two" },
      { _tag: "rename-canvas", expectedTitle: "One", title: "Two", sequence: 1 },
      { _tag: "rename-canvas", expectedTitle: "One", title: "Two", attribution: {} }
    ]) {
      expect(() => decodeCanvasCommandBatch([command])).toThrow()
    }
  })
})
