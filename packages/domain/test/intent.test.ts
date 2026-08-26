import { describe, expect, it } from "vitest"

import {
  CanvasEngine,
  decodeCanvasChange,
  decodeCanvasProjection,
  proposeAddFrame,
  proposeBringToFront,
  proposeRemoveFrame,
  proposeRenameCanvas,
  proposeSendToBack,
  proposeSetFrameGeometry,
  proposeSetFrameRepresentation,
  proposeSetFrameStatus,
  proposeSetFrameTitle
} from "../src/index.js"

const empty = () => decodeCanvasProjection({
  schemaVersion: 3,
  canvasId: "canvas_review",
  title: "Review",
  frames: [],
  stack: [],
  stackChangedByChangeId: null,
  issuedIds: { frameIds: [] }
})
const apply = (projection: ReturnType<typeof empty>, changeId: string, commands: readonly unknown[]) => {
  const result = CanvasEngine.apply(
    projection,
    decodeCanvasChange({ canvasId: "canvas_review", changeId, commands })
  )
  if (result._tag !== "applied") throw new Error("expected applied")
  return result.projection
}

describe("intent", () => {
  it("places a Frame at the front or back of the current stack", () => {
    const created = apply(empty(), "change_create", [
      {
        _tag: "addFrame",
        frameId: "frame_a",
        title: "First",
        representation: { _tag: "webUrl", url: "https://example.com" },
        status: "in-progress",
        geometry: { x: 0, y: 0, width: 100, height: 80 }
      },
      {
        _tag: "addFrame",
        frameId: "frame_b",
        title: "Second",
        representation: { _tag: "webUrl", url: "https://example.org" },
        status: "in-progress",
        geometry: { x: 10, y: 10, width: 80, height: 60 }
      }
    ])
    const first = created.frames.find((frame) => frame.frameId === "frame_a")
    if (first === undefined) throw new Error("Frame missing")
    expect(proposeSendToBack(created, first)).toMatchObject({
      _tag: "placeCanvasItem",
      item: { _tag: "frame", frameId: "frame_a" },
      after: null,
      expectedStackChangeId: "change_create"
    })
    const back = apply(created, "change_back", [proposeSendToBack(created, first)])
    expect(back.stack.map((item) => item.frameId)).toEqual(["frame_a", "frame_b"])
    const front = apply(back, "change_front", [proposeBringToFront(back, first)])
    expect(front.stack.map((item) => item.frameId)).toEqual(["frame_b", "frame_a"])
  })

  it("builds Frame and Canvas commands from current projection fields", () => {
    const add = proposeAddFrame({
      frameId: "frame_a",
      title: "Frame",
      representation: { _tag: "webUrl", url: "https://example.com" },
      status: "in-progress",
      geometry: { x: 0, y: 0, width: 100, height: 80 }
    })
    const created = apply(empty(), "change_create", [add])
    const frame = created.frames[0]
    if (frame === undefined) throw new Error("Frame missing")

    expect(proposeRenameCanvas(created, "Renamed")).toEqual({
      _tag: "renameCanvas",
      expectedTitle: "Review",
      title: "Renamed"
    })
    expect(proposeSetFrameRepresentation(frame, {
      _tag: "webUrl",
      url: "https://example.org"
    })).toMatchObject({
      _tag: "setFrameRepresentation",
      frameId: "frame_a",
      expectedChangedByChangeId: "change_create"
    })
    expect(proposeSetFrameTitle(frame, "Updated")).toMatchObject({
      _tag: "setFrameTitle",
      expectedChangedByChangeId: "change_create"
    })
    expect(proposeSetFrameStatus(frame, "approved")).toMatchObject({
      _tag: "setFrameStatus",
      expectedChangedByChangeId: "change_create"
    })
    expect(proposeSetFrameGeometry(frame, {
      x: 10,
      y: 20,
      width: 120,
      height: 90
    })).toMatchObject({
      _tag: "setFrameGeometry",
      expectedChangedByChangeId: "change_create"
    })
    expect(proposeRemoveFrame(frame)).toMatchObject({
      _tag: "removeFrame",
      expectedUpdatedByChangeId: "change_create"
    })
  })
})
