import type { CanvasProjection, Frame, Note } from "@crit/domain"

type Frames = CanvasProjection["frames"]
type Notes = CanvasProjection["notes"]

const frames = new WeakMap<Frames, ReadonlyMap<Frame["frameId"], Frame>>()
const notes = new WeakMap<Notes, ReadonlyMap<Note["noteId"], Note>>()

export const framesById = (values: Frames): ReadonlyMap<Frame["frameId"], Frame> => {
  const cached = frames.get(values)
  if (cached !== undefined) return cached
  const next = new Map(values.map((frame) => [frame.frameId, frame]))
  frames.set(values, next)
  return next
}

export const notesById = (values: Notes): ReadonlyMap<Note["noteId"], Note> => {
  const cached = notes.get(values)
  if (cached !== undefined) return cached
  const next = new Map(values.map((note) => [note.noteId, note]))
  notes.set(values, next)
  return next
}
