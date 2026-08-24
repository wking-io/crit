import {
  CanvasItemRef as CanvasItemRefSchema,
  type CanvasItemRef,
  type FrameId
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

export type CanvasInputTarget =
  | { readonly _tag: "camera" }
  | { readonly _tag: "frame"; readonly frameId: FrameId }

const cameraTarget: CanvasInputTarget = { _tag: "camera" }

export const CanvasSelection = {
  make: Schema.decodeUnknownSync(CanvasSelectionValue),
  schema: CanvasSelectionValue,
  has: (selection: CanvasSelection, item: CanvasItemRef): boolean => {
    const key = itemKey(item)
    return selection.some((selected) => itemKey(selected) === key)
  },
  inputTarget: (selection: CanvasSelection | undefined): CanvasInputTarget => {
    if (selection === undefined || selection.length !== 1) return cameraTarget
    const item = selection[0]
    return item !== undefined && item._tag === "frame"
      ? { _tag: "frame", frameId: item.frameId }
      : cameraTarget
  }
}
