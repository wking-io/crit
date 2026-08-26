import { describe, expect, it } from "vitest"

import {
  decodeCanvasDirectoryWire,
  encodeCanvasDirectoryWire
} from "../src/share.js"

describe("canvas directory protocol", () => {
  it("round-trips a directory", () => {
    const wire = {
      kind: "canvas-directory" as const,
      schemaVersion: 1 as const,
      canvases: [{
        canvasId: "canvas_checkout",
        workspaceId: "workspace_default",
        title: "Checkout"
      }]
    }
    expect(decodeCanvasDirectoryWire(encodeCanvasDirectoryWire(wire))).toEqual(wire)
  })
})
