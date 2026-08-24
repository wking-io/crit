import { decodeCanvasProjection } from "@crit/domain"
import { describe, expect, it, vi } from "vitest"

import { CanvasSelection } from "../src/canvas-selection.js"
import {
  ReviewActionInput,
  availableReviewActions,
  resolveReviewAction,
  type ReviewActionContext,
  type ReviewActionId,
  type ReviewSelection
} from "../src/review-actions.js"

const projection = decodeCanvasProjection({
  schemaVersion: 2,
  canvasId: "canvas_review",
  title: "Review",
  frames: [
    {
      frameId: "frame_a",
      title: "Alpha",
      representation: { _tag: "web-url", url: "https://example.com/a" },
      status: "in-progress",
      geometry: { x: 10, y: 20, width: 100, height: 80 },
      createdByChangeId: "change_1",
      updatedByChangeId: "change_1",
      titleChangedByChangeId: "change_1",
      representationChangedByChangeId: "change_1",
      statusChangedByChangeId: "change_1",
      geometryChangedByChangeId: "change_1"
    },
    {
      frameId: "frame_b",
      title: "Beta",
      representation: {
        _tag: "artifact",
        artifactId: "artifact_beta",
        digest: `sha256:${"0".repeat(64)}`
      },
      status: "approved",
      geometry: { x: 200, y: 100, width: 120, height: 90 },
      createdByChangeId: "change_1",
      updatedByChangeId: "change_1",
      titleChangedByChangeId: "change_1",
      representationChangedByChangeId: "change_1",
      statusChangedByChangeId: "change_1",
      geometryChangedByChangeId: "change_1"
    }
  ],
  notes: [
    {
      noteId: "note_a",
      text: "First",
      author: { _tag: "person", personId: "person_ada", displayName: "Ada" },
      color: "blue",
      geometry: { x: 100, y: 40, width: 80, height: 60 },
      attachedFrameId: null,
      createdByChangeId: "change_1",
      updatedByChangeId: "change_1",
      textChangedByChangeId: "change_1",
      colorChangedByChangeId: "change_1",
      geometryChangedByChangeId: "change_1",
      attachmentChangedByChangeId: "change_1"
    },
    {
      noteId: "note_b",
      text: "Attached",
      author: { _tag: "person", personId: "person_ada", displayName: "Ada" },
      color: "neutral",
      geometry: { x: 20, y: 30, width: 80, height: 60 },
      attachedFrameId: "frame_a",
      createdByChangeId: "change_1",
      updatedByChangeId: "change_1",
      textChangedByChangeId: "change_1",
      colorChangedByChangeId: "change_1",
      geometryChangedByChangeId: "change_1",
      attachmentChangedByChangeId: "change_1"
    }
  ],
  threads: [{
    threadId: "thread_a",
    anchor: {
      _tag: "frame",
      frameId: "frame_a",
      point: { x: 0.5, y: 0.5 }
    },
    resolved: false,
    comments: [{
      commentId: "comment_a",
      body: "Review this",
      author: { _tag: "person", personId: "person_ada", displayName: "Ada" },
      createdByChangeId: "change_1",
      bodyChangedByChangeId: "change_1"
    }],
    createdByChangeId: "change_1",
    updatedByChangeId: "change_1",
    anchorChangedByChangeId: "change_1",
    resolutionChangedByChangeId: "change_1"
  }],
  stack: [
    { _tag: "frame", frameId: "frame_a" },
    { _tag: "note", noteId: "note_a" },
    { _tag: "frame", frameId: "frame_b" },
    { _tag: "note", noteId: "note_b" }
  ],
  stackChangedByChangeId: "change_1",
  issuedIds: {
    frameIds: ["frame_a", "frame_b"],
    noteIds: ["note_a", "note_b"],
    threadIds: ["thread_a"],
    commentIds: ["comment_a"]
  }
})

const itemSelection = (
  items: Parameters<typeof CanvasSelection.make>[0]
): ReviewSelection => ({ _tag: "items", items: CanvasSelection.make(items) })

const context = (
  selection: ReviewSelection,
  input: ReviewActionContext["input"] = ReviewActionInput.none
): ReviewActionContext => ({
  projection,
  selection,
  input,
  fullscreen: false,
  pauseOffscreen: false
})

const commandsFor = (
  id: ReviewActionId,
  actionContext: ReviewActionContext
) => {
  const action = resolveReviewAction(id, actionContext)
  if (action?._tag !== "batch") throw new Error(`Expected ${id} batch`)
  return action.commands
}

describe("review actions", () => {
  it("lists policies available for the current selection", () => {
    const selection = itemSelection([{ _tag: "frame", frameId: "frame_a" }])
    const ids = availableReviewActions({ projection, selection })
      .map((entry) => entry.id)

    expect(ids).toContain("remove")
    expect(ids).toContain("set-frame-status-approved")
    expect(ids).not.toContain("set-frame-status-in-progress")
  })

  it("builds mutation batches for status, title, remove, and stacking", () => {
    const frame = context(itemSelection([
      { _tag: "frame", frameId: "frame_a" }
    ]))

    expect(commandsFor("set-frame-status-approved", frame)).toEqual([{
      _tag: "set-frame-status",
      frameId: "frame_a",
      expectedChangedByChangeId: "change_1",
      status: "approved"
    }])
    expect(commandsFor("set-frame-title", {
      ...frame,
      input: { _tag: "text", text: "Updated" }
    })).toEqual([{
      _tag: "set-frame-title",
      frameId: "frame_a",
      expectedChangedByChangeId: "change_1",
      title: "Updated"
    }])
    expect(commandsFor("remove", frame)).toEqual([{
      _tag: "remove-frame",
      frameId: "frame_a",
      expectedUpdatedByChangeId: "change_1"
    }])
    expect(commandsFor("bring-to-front", frame)).toEqual([{
      _tag: "place-canvas-item",
      item: { _tag: "frame", frameId: "frame_a" },
      after: { _tag: "note", noteId: "note_b" },
      expectedStackChangeId: "change_1"
    }])
  })

  it("mints ids when adding Frames", () => {
    const randomUUID = vi.spyOn(crypto, "randomUUID")
    randomUUID.mockReturnValueOnce("00000000-0000-4000-8000-000000000001")
    const selection = itemSelection([])

    expect(commandsFor("add-frame", context(selection, {
      _tag: "url",
      url: "https://example.org/review"
    }))[0]).toMatchObject({
      _tag: "add-frame",
      frameId: "frame_00000000000040008000000000000001",
      representation: {
        _tag: "web-url",
        url: "https://example.org/review"
      }
    })
  })

  it("maps arrangement and breakpoint plans onto geometry commands", () => {
    const frames = context(itemSelection([
      { _tag: "frame", frameId: "frame_a" },
      { _tag: "frame", frameId: "frame_b" }
    ]))
    expect(commandsFor("align-left", frames)).toEqual([
      {
        _tag: "set-frame-geometry",
        frameId: "frame_a",
        expectedChangedByChangeId: "change_1",
        geometry: { x: 10, y: 20, width: 100, height: 80 }
      },
      {
        _tag: "set-frame-geometry",
        frameId: "frame_b",
        expectedChangedByChangeId: "change_1",
        geometry: { x: 10, y: 100, width: 120, height: 90 }
      }
    ])

    const frame = context(itemSelection([
      { _tag: "frame", frameId: "frame_a" }
    ]))
    expect(commandsFor("resize-frame-mobile", frame)).toEqual([{
      _tag: "set-frame-geometry",
      frameId: "frame_a",
      expectedChangedByChangeId: "change_1",
      geometry: { x: 10, y: 20, width: 402, height: 874 }
    }])
  })

  it("resolves browser-only actions without command batches", () => {
    const frame = context(itemSelection([
      { _tag: "frame", frameId: "frame_a" }
    ]))
    expect(resolveReviewAction("open-url", frame)).toEqual({
      _tag: "effect",
      effect: { _tag: "open-url", url: "https://example.com/a" }
    })
    expect(resolveReviewAction("copy-node-id", frame)).toEqual({
      _tag: "effect",
      effect: { _tag: "copy", text: "frame_a" }
    })
    expect(resolveReviewAction("toggle-pause-offscreen", frame)).toEqual({
      _tag: "effect",
      effect: {
        _tag: "set-preference",
        key: "pause-offscreen",
        value: true
      }
    })
  })

})
