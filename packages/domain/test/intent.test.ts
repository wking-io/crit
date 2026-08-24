import { describe, expect, it } from "vitest"

import {
  CanvasEngine,
  decodeCanvasChange,
  decodeCanvasProjection,
  proposeAddNote,
  proposeBringToFront,
  proposeSendToBack,
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
})
