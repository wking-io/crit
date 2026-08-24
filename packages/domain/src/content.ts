import { Schema } from "effect"

import { Geometry } from "./geometry.js"
import { ChangeId, FrameId } from "./ids.js"
import { RepresentationRef } from "./representation.js"
import { NonBlankString } from "./text.js"

export const AuthoredText = NonBlankString
export type AuthoredText = typeof AuthoredText.Type
export const ReviewStatus = Schema.Literals(["in-progress", "ready-for-review", "approved", "changes-requested"])
export type ReviewStatus = typeof ReviewStatus.Type

export const Frame = Schema.Struct({
  frameId: FrameId,
  title: AuthoredText,
  representation: RepresentationRef,
  status: ReviewStatus,
  geometry: Geometry,
  createdByChangeId: ChangeId,
  updatedByChangeId: ChangeId,
  titleChangedByChangeId: ChangeId,
  representationChangedByChangeId: ChangeId,
  statusChangedByChangeId: ChangeId,
  geometryChangedByChangeId: ChangeId
})
export type Frame = typeof Frame.Type

export const FrameItemRef = Schema.TaggedStruct("frame", { frameId: FrameId })
export const CanvasItemRef = FrameItemRef
export type CanvasItemRef = typeof CanvasItemRef.Type
