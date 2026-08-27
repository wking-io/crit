import {
  CanvasItemRef as CanvasItemRefSchema,
  type CanvasItemRef,
  type FrameId
} from "@crit/domain"

export type { CanvasItemRef }
import { Data, Match, Schema } from "effect"

const itemKey = (item: CanvasItemRef): string => `frame:${item.frameId}`

const CanvasSelectionValue = Schema.Array(CanvasItemRefSchema).check(
  Schema.makeFilter<readonly CanvasItemRef[]>((selection) =>
    new Set(selection.map(itemKey)).size === selection.length
      ? undefined
      : "Expected each Canvas item at most once in a selection"
  )
).pipe(Schema.brand("CanvasSelection"))

export type CanvasSelection = typeof CanvasSelectionValue.Type

export type CanvasSelectionCommand = Data.TaggedEnum<{
  readonly clear: {}
  readonly item: {
    readonly item: CanvasItemRef
    readonly additive: boolean
  }
}>
export const CanvasSelectionCommand = Data.taggedEnum<CanvasSelectionCommand>()

export type CanvasInputTarget = Data.TaggedEnum<{
  readonly camera: {}
  readonly frame: { readonly frameId: FrameId }
}>
export const CanvasInputTarget = Data.taggedEnum<CanvasInputTarget>()

const cameraTarget = CanvasInputTarget.camera()

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
  return Match.value(command).pipe(Match.tagsExhaustive({
    clear: () => makeCanvasSelection([]),
    item: (command) => {
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
  }))
}

const selectionsEqual = (
  left: CanvasSelection,
  right: CanvasSelection
): boolean => {
  if (left === right) return true
  if (left.length !== right.length) return false
  return left.every((item, index) => itemKey(item) === itemKey(right[index]!))
}

export const CanvasSelection = {
  make: makeCanvasSelection,
  schema: CanvasSelectionValue,
  has: hasCanvasItem,
  equal: selectionsEqual,
  apply: applyCanvasSelectionCommand,
  inputTarget: (selection: CanvasSelection | undefined): CanvasInputTarget => {
    if (selection === undefined || selection.length !== 1) return cameraTarget
    const item = selection[0]
    return item === undefined
      ? cameraTarget
      : CanvasInputTarget.frame({ frameId: item.frameId })
  }
}
