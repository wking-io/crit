import {
  AddFrameCommand,
  PlaceCanvasItemCommand,
  RemoveFrameCommand,
  RenameCanvasCommand,
  SetFrameGeometryCommand,
  SetFrameRepresentationCommand,
  SetFrameStatusCommand,
  SetFrameTitleCommand
} from "./command.js"
import type { CanvasProjection } from "./canvas.js"
import { FrameItemRef, type AuthoredText, type Frame, type ReviewStatus } from "./content.js"
import type { Geometry } from "./geometry.js"
import type { FrameId } from "./ids.js"
import type { RepresentationRef } from "./representation.js"

export const proposeRenameCanvas = (
  projection: CanvasProjection,
  title: CanvasProjection["title"]
) =>
  RenameCanvasCommand.make({
    expectedTitle: projection.title,
    title
  })

export const proposeAddFrame = (input: {
  readonly frameId: FrameId
  readonly title: AuthoredText
  readonly representation: RepresentationRef
  readonly status: ReviewStatus
  readonly geometry: Geometry
}) => AddFrameCommand.make(input)

export const proposeSetFrameRepresentation = (
  frame: Frame,
  representation: RepresentationRef
) =>
  SetFrameRepresentationCommand.make({
    frameId: frame.frameId,
    expectedChangedByChangeId: frame.representationChangedByChangeId,
    representation
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

const itemOf = (frame: Frame) => FrameItemRef.make({ frameId: frame.frameId })
const itemKey = (item: CanvasProjection["stack"][number]) => `frame:${item.frameId}`

export const proposeBringToFront = (projection: CanvasProjection, frame: Frame) => {
  const item = itemOf(frame)
  const without = projection.stack.filter((entry) => itemKey(entry) !== itemKey(item))
  const after = without.at(-1) ?? null
  return PlaceCanvasItemCommand.make({
    item,
    after,
    expectedStackChangeId: projection.stackChangedByChangeId
  })
}

export const proposeSendToBack = (projection: CanvasProjection, frame: Frame) =>
  PlaceCanvasItemCommand.make({
    item: itemOf(frame),
    after: null,
    expectedStackChangeId: projection.stackChangedByChangeId
  })
