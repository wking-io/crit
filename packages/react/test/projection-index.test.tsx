import { decodeCanvasProjection } from "@crit/domain"
import { describe, expect, it } from "vitest"

import { framesById, notesById } from "../src/projection-index.js"

const projection = decodeCanvasProjection({
  schemaVersion: 2,
  canvasId: "canvas_review",
  title: "Review",
  frames: [{
    frameId: "frame_checkout",
    title: "Checkout",
    representation: { _tag: "web-url", url: "https://example.com/checkout" },
    status: "in-progress",
    geometry: { x: 40, y: 80, width: 320, height: 200 },
    createdByChangeId: "change_1",
    updatedByChangeId: "change_1",
    titleChangedByChangeId: "change_1",
    representationChangedByChangeId: "change_1",
    statusChangedByChangeId: "change_1",
    geometryChangedByChangeId: "change_1"
  }],
  notes: [{
    noteId: "note_price",
    text: "Check the price",
    geometry: { x: 400, y: 80, width: 160, height: 80 },
    attachedFrameId: "frame_checkout",
    author: { _tag: "person", personId: "person_ada", displayName: "Ada" },
    color: "blue",
    createdByChangeId: "change_1",
    updatedByChangeId: "change_1",
    textChangedByChangeId: "change_1",
    colorChangedByChangeId: "change_1",
    geometryChangedByChangeId: "change_1",
    attachmentChangedByChangeId: "change_1"
  }],
  threads: [],
  stack: [
    { _tag: "frame", frameId: "frame_checkout" },
    { _tag: "note", noteId: "note_price" }
  ],
  stackChangedByChangeId: "change_1",
  issuedIds: {
    frameIds: ["frame_checkout"],
    noteIds: ["note_price"],
    threadIds: [],
    commentIds: []
  }
})

describe("projection index", () => {
  it("looks up the same Frame and Note objects by id", () => {
    const frame = projection.frames[0]
    const note = projection.notes[0]
    expect(frame).toBeDefined()
    expect(note).toBeDefined()
    if (frame === undefined || note === undefined) return
    expect(framesById(projection.frames).get(frame.frameId)).toBe(frame)
    expect(notesById(projection.notes).get(note.noteId)).toBe(note)
  })

  it("reuses the map while the collection identity is stable", () => {
    expect(framesById(projection.frames)).toBe(framesById(projection.frames))
    expect(notesById(projection.notes)).toBe(notesById(projection.notes))
  })

  it("builds a new map when the collection is replaced", () => {
    const nextFrames = [...projection.frames]
    const nextNotes = [...projection.notes]
    expect(framesById(nextFrames)).not.toBe(framesById(projection.frames))
    expect(notesById(nextNotes)).not.toBe(notesById(projection.notes))
    const frame = projection.frames[0]
    const note = projection.notes[0]
    expect(frame).toBeDefined()
    expect(note).toBeDefined()
    if (frame === undefined || note === undefined) return
    expect(framesById(nextFrames).get(frame.frameId)).toBe(frame)
    expect(notesById(nextNotes).get(note.noteId)).toBe(note)
  })
})
