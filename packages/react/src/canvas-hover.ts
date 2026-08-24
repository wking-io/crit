import {
  CanvasItemRef as CanvasItemRefSchema,
  type CanvasItemRef
} from "@crit/domain"
import { Schema } from "effect"

const itemKey = (item: CanvasItemRef): string =>
  item._tag === "frame"
    ? `frame:${item.frameId}`
    : `note:${item.noteId}`

const CanvasHoverValue = CanvasItemRefSchema.pipe(Schema.brand("CanvasHover"))

export type CanvasHover = typeof CanvasHoverValue.Type

export const CanvasHover = {
  make: Schema.decodeUnknownSync(CanvasHoverValue),
  schema: CanvasHoverValue,
  matches: (hover: CanvasHover, item: CanvasItemRef): boolean =>
    itemKey(hover) === itemKey(item)
}
