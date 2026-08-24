import { Schema } from "effect"

import { CanvasItemRef, Frame } from "./content.js"
import { isCanonicalIdOrder } from "./canonical-order.js"
import { CanvasId, ChangeId, FrameId } from "./ids.js"
import { NonBlankString } from "./text.js"

export const CanvasTitle = NonBlankString
export type CanvasTitle = typeof CanvasTitle.Type

const IssuedIds = Schema.Struct({
  frameIds: Schema.Array(FrameId)
})

const CanvasProjectionFields = Schema.Struct({
  schemaVersion: Schema.Literal(3),
  canvasId: CanvasId,
  title: CanvasTitle,
  frames: Schema.Array(Frame),
  stack: Schema.Array(CanvasItemRef),
  stackChangedByChangeId: Schema.NullOr(ChangeId),
  issuedIds: IssuedIds
})

const itemKey = (item: CanvasItemRef) => `frame:${item.frameId}`
const projectionFailure = (projection: typeof CanvasProjectionFields.Type) => {
  const frameIds = projection.frames.map((frame) => frame.frameId)
  if (![frameIds, projection.issuedIds.frameIds].every(isCanonicalIdOrder)) {
    return "Entity and issued ID collections must be sorted and unique"
  }
  const issuedFrameIds = new Set(projection.issuedIds.frameIds)
  if (!frameIds.every((id) => issuedFrameIds.has(id))) {
    return "Every active ID must have been issued"
  }
  const activeItems = new Set(frameIds.map((id) => `frame:${id}`))
  const stackItems = new Set<string>()
  for (const item of projection.stack) {
    const key = itemKey(item)
    if (!activeItems.has(key) || stackItems.has(key)) {
      return "Stack must contain each active Frame exactly once"
    }
    stackItems.add(key)
  }
  if (activeItems.size !== stackItems.size) {
    return "Stack must contain each active Frame exactly once"
  }
  if (projection.stack.length > 0 && projection.stackChangedByChangeId === null) {
    return "A non-empty stack must have change provenance"
  }
  return undefined
}

export const CanvasProjection = CanvasProjectionFields.check(
  Schema.makeFilter<typeof CanvasProjectionFields.Type>(projectionFailure)
)
export type CanvasProjection = typeof CanvasProjection.Type

export const decodeCanvasProjection = (input: Schema.Json): CanvasProjection =>
  Schema.decodeUnknownSync(CanvasProjection, { onExcessProperty: "error" })(input)

export const emptyCanvasProjection = (canvasId: CanvasId, title: CanvasTitle): CanvasProjection => ({
  schemaVersion: 3,
  canvasId,
  title,
  frames: [],
  stack: [],
  stackChangedByChangeId: null,
  issuedIds: { frameIds: [] }
})
