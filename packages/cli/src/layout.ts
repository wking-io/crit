import {
  AuthoredText,
  CanvasId,
  CanvasTitle,
  FrameId,
  Geometry,
  type CanvasProjection
} from "@crit/domain"
import { Schema } from "effect"

export const CanvasLayoutFrame = Schema.TaggedStruct("frame", {
  frameId: FrameId,
  title: AuthoredText,
  geometry: Geometry,
  representation: Schema.Literals(["applicationRoute", "webUrl", "artifact"])
})

export const CanvasLayoutItem = CanvasLayoutFrame

export const CanvasLayout = Schema.Struct({
  canvasId: CanvasId,
  title: CanvasTitle,
  items: Schema.Array(CanvasLayoutItem)
})

export const canvasLayout = (projection: CanvasProjection): typeof CanvasLayout.Type =>
  CanvasLayout.make({
    canvasId: projection.canvasId,
    title: projection.title,
    items: projection.frames.map((frame) => CanvasLayoutFrame.make({
      frameId: frame.frameId,
      title: frame.title,
      geometry: frame.geometry,
      representation: frame.representation._tag
    }))
  })

const formatBox = (geometry: typeof Geometry.Type): string =>
  `${geometry.x} ${geometry.y} ${geometry.width} ${geometry.height}`

export const formatCanvasLayout = (layout: typeof CanvasLayout.Type): string => {
  const header = `${layout.canvasId}  ${layout.title}`
  if (layout.items.length === 0) return header
  return [
    header,
    ...layout.items.map((item) =>
      `frame  ${item.frameId}  ${item.title}  ${formatBox(item.geometry)}`
    )
  ].join("\n")
}
