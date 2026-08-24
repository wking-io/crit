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

export type CanvasSelectionCommand =
  | { readonly _tag: "clear" }
  | {
    readonly _tag: "item"
    readonly item: CanvasItemRef
    readonly additive: boolean
  }

export type CanvasInputTarget =
  | { readonly _tag: "camera" }
  | { readonly _tag: "frame"; readonly frameId: FrameId }

const cameraTarget: CanvasInputTarget = { _tag: "camera" }

const makeCanvasSelection = Schema.decodeUnknownSync(CanvasSelectionValue)

const hasCanvasItem = (
  selection: CanvasSelection,
  item: CanvasItemRef
): boolean => {
  const key = itemKey(item)
  return selection.some((selected) => itemKey(selected) === key)
}

const applyCanvasSelectionCommand = (
  current: CanvasSelection | undefined,
  command: CanvasSelectionCommand
): CanvasSelection => {
  switch (command._tag) {
    case "clear":
      return makeCanvasSelection([])
    case "item": {
      if (!command.additive) return makeCanvasSelection([command.item])
      const selection = current ?? makeCanvasSelection([])
      if (!hasCanvasItem(selection, command.item)) {
        return makeCanvasSelection([...selection, command.item])
      }
      const key = itemKey(command.item)
      return makeCanvasSelection(
        selection.filter((selected) => itemKey(selected) !== key)
      )
    }
  }
}

export const CanvasSelection = {
  make: makeCanvasSelection,
  schema: CanvasSelectionValue,
  has: hasCanvasItem,
  apply: applyCanvasSelectionCommand,
  inputTarget: (selection: CanvasSelection | undefined): CanvasInputTarget => {
    if (selection === undefined || selection.length !== 1) return cameraTarget
    const item = selection[0]
    return item !== undefined && item._tag === "frame"
      ? { _tag: "frame", frameId: item.frameId }
      : cameraTarget
  }
}
