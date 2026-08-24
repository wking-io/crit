import {
  CanvasItemRef as CanvasItemRefSchema,
  type CanvasItemRef
} from "@crit/domain"
import { Schema } from "effect"

const itemKey = (item: CanvasItemRef): string =>
  item._tag === "frame"
    ? `frame:${item.frameId}`
    : `note:${item.noteId}`

const CanvasSelectionValue = Schema.Array(CanvasItemRefSchema).check(
  Schema.makeFilter<readonly CanvasItemRef[]>((selection) =>
    new Set(selection.map(itemKey)).size === selection.length
      ? undefined
      : "Expected each Canvas item at most once in a selection"
  )
).pipe(Schema.brand("CanvasSelection"))

export type CanvasSelection = typeof CanvasSelectionValue.Type

export const CanvasSelection = {
  make: Schema.decodeUnknownSync(CanvasSelectionValue),
  schema: CanvasSelectionValue,
  has: (selection: CanvasSelection, item: CanvasItemRef): boolean => {
    const key = itemKey(item)
    return selection.some((selected) => itemKey(selected) === key)
  }
}
