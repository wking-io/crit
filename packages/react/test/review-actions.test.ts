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
    const selection = itemSelection([{ _tag: "note", noteId: "note_a" }])
    const ids = availableReviewActions({ projection, selection })
      .map((entry) => entry.id)

    expect(ids).toContain("remove")
    expect(ids).toContain("set-note-color-green")
    expect(ids).not.toContain("set-note-color-blue")
    expect(ids).not.toContain("set-frame-status-approved")
  })

  it("builds mutation batches for status, title, color, remove, and stacking", () => {
    const frame = context(itemSelection([
      { _tag: "frame", frameId: "frame_a" }
    ]))
    const note = context(itemSelection([
      { _tag: "note", noteId: "note_a" }
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
    expect(commandsFor("set-note-color-green", note)).toEqual([{
      _tag: "set-note-color",
      noteId: "note_a",
      expectedChangedByChangeId: "change_1",
      color: "green"
    }])
    expect(commandsFor("remove", note)).toEqual([{
      _tag: "remove-note",
      noteId: "note_a",
      expectedUpdatedByChangeId: "change_1"
    }])
    expect(commandsFor("bring-to-front", frame)).toEqual([{
      _tag: "place-canvas-item",
      item: { _tag: "frame", frameId: "frame_a" },
      after: { _tag: "note", noteId: "note_b" },
      expectedStackChangeId: "change_1"
    }])
  })

  it("mints ids when adding Frames and Notes", () => {
    const randomUUID = vi.spyOn(crypto, "randomUUID")
    randomUUID
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000001")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000002")
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
    expect(commandsFor("add-note", context(selection, {
      _tag: "text",
      text: "New note"
    }))[0]).toMatchObject({
      _tag: "add-note",
      noteId: "note_00000000000040008000000000000002",
      text: "New note",
      color: "neutral",
      attachedFrameId: null
    })
  })

  it("builds attachment and detachment batches", () => {
    const pair = context(itemSelection([
      { _tag: "frame", frameId: "frame_a" },
      { _tag: "note", noteId: "note_a" }
    ]))
    const attached = context(itemSelection([
      { _tag: "note", noteId: "note_b" }
    ]))

    expect(commandsFor("attach-note", pair)).toEqual([{
      _tag: "attach-note",
      noteId: "note_a",
      frameId: "frame_a",
      expectedChangedByChangeId: "change_1"
    }])
    expect(commandsFor("detach-note", attached)).toEqual([{
      _tag: "detach-note",
      noteId: "note_b",
      expectedChangedByChangeId: "change_1"
    }])
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

  it("builds comment compose, reply, edit, and resolution batches", () => {
    const randomUUID = vi.spyOn(crypto, "randomUUID")
    randomUUID
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000003")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000004")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000005")
    const frame = context(itemSelection([
      { _tag: "frame", frameId: "frame_a" }
    ]), { _tag: "text", text: "New thread" })
    const thread = context(
      { _tag: "comment-thread", threadId: "thread_a" },
      { _tag: "text", text: "Reply" }
    )

    expect(commandsFor("compose-comment", frame)[0]).toMatchObject({
      _tag: "add-comment-thread",
      threadId: "thread_00000000000040008000000000000003",
      commentId: "comment_00000000000040008000000000000004",
      body: "New thread"
    })
    expect(commandsFor("reply-comment", thread)[0]).toMatchObject({
      _tag: "reply-to-comment-thread",
      threadId: "thread_a",
      commentId: "comment_00000000000040008000000000000005",
      body: "Reply"
    })
    expect(commandsFor("edit-comment", {
      ...thread,
      input: { _tag: "text", text: "Edited" }
    })).toEqual([{
      _tag: "edit-comment",
      threadId: "thread_a",
      commentId: "comment_a",
      expectedBody: "Review this",
      body: "Edited"
    }])
    expect(commandsFor("resolve-comment", thread)).toEqual([{
      _tag: "set-comment-thread-resolution",
      threadId: "thread_a",
      expectedChangedByChangeId: "change_1",
      resolved: true
    }])
  })
})
