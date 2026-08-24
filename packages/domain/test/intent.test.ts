import { describe, expect, it } from "vitest"

import {
  CanvasEngine,
  decodeCanvasChange,
  decodeCanvasProjection,
  proposeAddCommentThread,
  proposeAddFrame,
  proposeAddNote,
  proposeAttachNote,
  proposeBringToFront,
  proposeDetachNote,
  proposeEditComment,
  proposeEditNote,
  proposeRemoveFrame,
  proposeRemoveNote,
  proposeRenameCanvas,
  proposeReplyToCommentThread,
  proposeSendToBack,
  proposeSetCommentThreadResolution,
  proposeSetFrameGeometry,
  proposeSetFrameRepresentation,
  proposeSetFrameStatus,
  proposeSetFrameTitle,
  proposeSetNoteGeometry,
  proposeSetNoteColor
} from "../src/index.js"

const person = { _tag: "person" as const, personId: "person_ada", displayName: "Ada" }
const empty = () => decodeCanvasProjection({
  schemaVersion: 2, canvasId: "canvas_review", title: "Review",
  frames: [], notes: [], threads: [], stack: [], stackChangedByChangeId: null,
  issuedIds: { frameIds: [], noteIds: [], threadIds: [], commentIds: [] }
})
const apply = (projection: ReturnType<typeof empty>, changeId: string, commands: readonly unknown[]) => {
  const result = CanvasEngine.apply(
    projection,
    decodeCanvasChange({ canvasId: "canvas_review", changeId, commands }),
    person
  )
  if (result._tag !== "applied") throw new Error("expected applied")
  return result.projection
}

describe("intent", () => {
  it("builds a preconditioned Note Color change from the current Note", () => {
    const created = apply(empty(), "change_create", [
      proposeAddNote({
        noteId: "note_a",
        text: "Copy",
        color: "blue",
        geometry: { x: 0, y: 0, width: 100, height: 80 },
        attachedFrameId: null
      })
    ])
    const note = created.notes[0]
    if (note === undefined) throw new Error("Note missing")
    expect(proposeSetNoteColor(note, "green")).toEqual({
      _tag: "set-note-color",
      noteId: "note_a",
      expectedChangedByChangeId: "change_create",
      color: "green"
    })
    const colored = apply(created, "change_color", [proposeSetNoteColor(note, "green")])
    expect(colored.notes[0]?.color).toBe("green")
  })

  it("places a Note at the front or back of the current stack", () => {
    const created = apply(empty(), "change_create", [
      {
        _tag: "add-frame",
        frameId: "frame_a",
        title: "Frame",
        representation: { _tag: "web-url", url: "https://example.com" },
        status: "in-progress",
        geometry: { x: 0, y: 0, width: 100, height: 80 }
      },
      proposeAddNote({
        noteId: "note_a",
        text: "Copy",
        color: "blue",
        geometry: { x: 10, y: 10, width: 80, height: 60 },
        attachedFrameId: null
      })
    ])
    const note = created.notes[0]
    if (note === undefined) throw new Error("Note missing")
    expect(proposeSendToBack(created, note)).toMatchObject({
      _tag: "place-canvas-item",
      item: { _tag: "note", noteId: "note_a" },
      after: null,
      expectedStackChangeId: "change_create"
    })
    const back = apply(created, "change_back", [proposeSendToBack(created, note)])
    expect(back.stack.map((item) => item._tag)).toEqual(["note", "frame"])
    const front = apply(back, "change_front", [proposeBringToFront(back, note)])
    expect(front.stack.map((item) => item._tag)).toEqual(["frame", "note"])
  })

  it("builds Frame and Canvas commands from current projection fields", () => {
    const add = proposeAddFrame({
      frameId: "frame_a",
      title: "Frame",
      representation: { _tag: "web-url", url: "https://example.com" },
      status: "in-progress",
      geometry: { x: 0, y: 0, width: 100, height: 80 }
    })
    const created = apply(empty(), "change_create", [add])
    const frame = created.frames[0]
    if (frame === undefined) throw new Error("Frame missing")

    expect(proposeRenameCanvas(created, "Renamed")).toEqual({
      _tag: "rename-canvas",
      expectedTitle: "Review",
      title: "Renamed"
    })
    expect(proposeSetFrameRepresentation(frame, {
      _tag: "web-url",
      url: "https://example.org"
    })).toMatchObject({
      _tag: "set-frame-representation",
      frameId: "frame_a",
      expectedChangedByChangeId: "change_create"
    })
    expect(proposeSetFrameTitle(frame, "Updated")).toMatchObject({
      _tag: "set-frame-title",
      expectedChangedByChangeId: "change_create"
    })
    expect(proposeSetFrameStatus(frame, "approved")).toMatchObject({
      _tag: "set-frame-status",
      expectedChangedByChangeId: "change_create"
    })
    expect(proposeSetFrameGeometry(frame, {
      x: 10,
      y: 20,
      width: 120,
      height: 90
    })).toMatchObject({
      _tag: "set-frame-geometry",
      expectedChangedByChangeId: "change_create"
    })
    expect(proposeRemoveFrame(frame)).toMatchObject({
      _tag: "remove-frame",
      expectedUpdatedByChangeId: "change_create"
    })
  })

  it("builds Note commands from current Note preconditions", () => {
    const created = apply(empty(), "change_create", [
      proposeAddFrame({
        frameId: "frame_a",
        title: "Frame",
        representation: { _tag: "web-url", url: "https://example.com" },
        status: "in-progress",
        geometry: { x: 0, y: 0, width: 100, height: 80 }
      }),
      proposeAddNote({
        noteId: "note_a",
        text: "Copy",
        color: "blue",
        geometry: { x: 10, y: 10, width: 80, height: 60 },
        attachedFrameId: null
      })
    ])
    const note = created.notes[0]
    if (note === undefined) throw new Error("Note missing")

    expect(proposeEditNote(note, "Edited")).toEqual({
      _tag: "edit-note",
      noteId: "note_a",
      expectedText: "Copy",
      text: "Edited"
    })
    expect(proposeAttachNote(note, "frame_a")).toEqual({
      _tag: "attach-note",
      noteId: "note_a",
      frameId: "frame_a",
      expectedChangedByChangeId: "change_create"
    })
    const attached = apply(created, "change_attach", [
      proposeAttachNote(note, "frame_a")
    ])
    const attachedNote = attached.notes[0]
    if (attachedNote === undefined) throw new Error("Attached Note missing")
    expect(proposeDetachNote(attachedNote)).toEqual({
      _tag: "detach-note",
      noteId: "note_a",
      expectedChangedByChangeId: "change_attach"
    })
    expect(proposeSetNoteGeometry(note, {
      x: 20,
      y: 30,
      width: 80,
      height: 60
    })).toMatchObject({
      _tag: "set-note-geometry",
      expectedChangedByChangeId: "change_create"
    })
    expect(proposeRemoveNote(note)).toMatchObject({
      _tag: "remove-note",
      expectedUpdatedByChangeId: "change_create"
    })
  })

  it("builds Comment commands from current Thread and Comment fields", () => {
    const framed = apply(empty(), "change_frame", [
      proposeAddFrame({
        frameId: "frame_a",
        title: "Frame",
        representation: { _tag: "web-url", url: "https://example.com" },
        status: "in-progress",
        geometry: { x: 0, y: 0, width: 100, height: 80 }
      })
    ])
    const add = proposeAddCommentThread({
      threadId: "thread_a",
      commentId: "comment_a",
      anchor: {
        _tag: "frame",
        frameId: "frame_a",
        point: { x: 0.5, y: 0.5 }
      },
      body: "First"
    })
    expect(add).toMatchObject({
      _tag: "add-comment-thread",
      threadId: "thread_a",
      commentId: "comment_a"
    })
    const threaded = apply(framed, "change_thread", [add])
    const thread = threaded.threads[0]
    const comment = thread?.comments[0]
    if (thread === undefined || comment === undefined) {
      throw new Error("Comment Thread missing")
    }
    expect(proposeReplyToCommentThread(thread, {
      commentId: "comment_b",
      body: "Reply"
    })).toEqual({
      _tag: "reply-to-comment-thread",
      threadId: "thread_a",
      commentId: "comment_b",
      body: "Reply"
    })
    expect(proposeEditComment(thread, comment, "Edited")).toEqual({
      _tag: "edit-comment",
      threadId: "thread_a",
      commentId: "comment_a",
      expectedBody: "First",
      body: "Edited"
    })
    expect(proposeSetCommentThreadResolution(thread, true)).toEqual({
      _tag: "set-comment-thread-resolution",
      threadId: "thread_a",
      expectedChangedByChangeId: "change_thread",
      resolved: true
    })
  })
})
