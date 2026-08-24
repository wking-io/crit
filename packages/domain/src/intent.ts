import {
  AddNoteCommand,
  PlaceCanvasItemCommand,
  RemoveFrameCommand,
  RemoveNoteCommand,
  SetFrameGeometryCommand,
  SetFrameStatusCommand,
  SetFrameTitleCommand,
  SetNoteColorCommand,
  SetNoteGeometryCommand
} from "./command.js"
import type { CanvasProjection } from "./canvas.js"
import {
  FrameItemRef,
  NoteItemRef,
  type AuthoredText,
  type Frame,
  type Note,
  type NoteColor,
  type ReviewStatus
} from "./content.js"
import type { Geometry } from "./geometry.js"
import type { NoteId } from "./ids.js"

export const proposeSetNoteColor = (note: Note, color: NoteColor) =>
  SetNoteColorCommand.make({
    noteId: note.noteId,
    expectedChangedByChangeId: note.colorChangedByChangeId,
    color
  })

export const proposeSetNoteGeometry = (note: Note, geometry: Geometry) =>
  SetNoteGeometryCommand.make({
    noteId: note.noteId,
    expectedChangedByChangeId: note.geometryChangedByChangeId,
    geometry
  })

export const proposeAddNote = (input: {
  readonly noteId: NoteId
  readonly text: AuthoredText
  readonly color: NoteColor
  readonly geometry: Geometry
  readonly attachedFrameId: Note["attachedFrameId"]
}) => AddNoteCommand.make(input)

export const proposeRemoveNote = (note: Note) =>
  RemoveNoteCommand.make({
    noteId: note.noteId,
    expectedUpdatedByChangeId: note.updatedByChangeId
  })

export const proposeSetFrameGeometry = (frame: Frame, geometry: Geometry) =>
  SetFrameGeometryCommand.make({
    frameId: frame.frameId,
    expectedChangedByChangeId: frame.geometryChangedByChangeId,
    geometry
  })

export const proposeSetFrameTitle = (frame: Frame, title: AuthoredText) =>
  SetFrameTitleCommand.make({
    frameId: frame.frameId,
    expectedChangedByChangeId: frame.titleChangedByChangeId,
    title
  })

export const proposeSetFrameStatus = (frame: Frame, status: ReviewStatus) =>
  SetFrameStatusCommand.make({
    frameId: frame.frameId,
    expectedChangedByChangeId: frame.statusChangedByChangeId,
    status
  })

export const proposeRemoveFrame = (frame: Frame) =>
  RemoveFrameCommand.make({
    frameId: frame.frameId,
    expectedUpdatedByChangeId: frame.updatedByChangeId
  })

const itemOf = (value: Frame | Note) =>
  "frameId" in value
    ? FrameItemRef.make({ frameId: value.frameId })
    : NoteItemRef.make({ noteId: value.noteId })

const itemKey = (item: CanvasProjection["stack"][number]) =>
  item._tag === "frame" ? `frame:${item.frameId}` : `note:${item.noteId}`

export const proposeBringToFront = (projection: CanvasProjection, value: Frame | Note) => {
  const item = itemOf(value)
  const without = projection.stack.filter((entry) => itemKey(entry) !== itemKey(item))
  const after = without.at(-1) ?? null
  return PlaceCanvasItemCommand.make({
    item,
    after,
    expectedStackChangeId: projection.stackChangedByChangeId
  })
}

export const proposeSendToBack = (projection: CanvasProjection, value: Frame | Note) =>
  PlaceCanvasItemCommand.make({
    item: itemOf(value),
    after: null,
    expectedStackChangeId: projection.stackChangedByChangeId
  })
