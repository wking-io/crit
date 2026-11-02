import { Frame, Id, proposeAddFrame, type CanvasCommandBatch } from "@crit/domain"
import { Option, Schema } from "effect"
import { useEffect, useRef, type RefObject } from "react"

import { CanvasSelection } from "./canvas-selection.js"
import type { CanvasSelectionStore } from "./canvas-selection-store.js"

const ClipboardFrame = Schema.Struct({
  title: Frame.fields.title,
  representation: Frame.fields.representation,
  status: Frame.fields.status,
  geometry: Frame.fields.geometry
})
const FrameClipboard = Schema.fromJsonString(Schema.Struct({
  type: Schema.Literal("crit/frames"),
  version: Schema.Literal(1),
  frames: Schema.NonEmptyArray(ClipboardFrame)
}))
const readFrames = Schema.decodeUnknownOption(FrameClipboard)
const writeFrames = Schema.encodeSync(FrameClipboard)

export const useCanvasClipboard = ({
  rootRef,
  frames,
  selectionStore,
  onSubmit,
  onSelectionChange
}: {
  readonly rootRef: RefObject<HTMLElement | null>
  readonly frames: readonly Frame[]
  readonly selectionStore: CanvasSelectionStore
  readonly onSubmit: ((commands: CanvasCommandBatch) => void) | undefined
  readonly onSelectionChange: (selection: CanvasSelection) => void
}): void => {
  const lastPaste = useRef({ text: "", count: 0 })

  useEffect(() => {
    const root = rootRef.current
    if (root === null) return
    const document = root.ownerDocument
    const accepts = (event: ClipboardEvent): boolean => {
      if (event.defaultPrevented || event.clipboardData === null) return false
      const target = event.target
      if (!(target instanceof Element)) return false
      if (target !== document.body && !root.contains(target)) return false
      return target.closest(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="dialog"], [role="menu"]'
      ) === null
    }
    const copy = (event: ClipboardEvent) => {
      if (!accepts(event) || document.getSelection()?.type === "Range") return
      const selectedIds = new Set(selectionStore.get().map((item) => item.frameId))
      const [first, ...rest] = frames.filter((frame) => selectedIds.has(frame.frameId))
      if (first === undefined) return
      const text = writeFrames({ type: "crit/frames", version: 1, frames: [first, ...rest] })
      event.clipboardData?.setData("text/plain", text)
      event.preventDefault()
      lastPaste.current = { text, count: 0 }
    }
    const paste = (event: ClipboardEvent) => {
      if (onSubmit === undefined || !accepts(event)) return
      const text = event.clipboardData?.getData("text/plain") ?? ""
      const parsed = readFrames(text)
      if (Option.isNone(parsed)) return
      const count = lastPaste.current.text === text ? lastPaste.current.count + 1 : 1
      const offset = 32 * count
      const commands = parsed.value.frames.map((frame) => proposeAddFrame({
        ...frame,
        frameId: Id.frame(`frame_${crypto.randomUUID().replaceAll("-", "")}`),
        geometry: {
          ...frame.geometry,
          x: frame.geometry.x + offset,
          y: frame.geometry.y + offset
        }
      }))
      const [first, ...rest] = commands
      if (first === undefined) return
      event.preventDefault()
      onSubmit([first, ...rest])
      lastPaste.current = { text, count }
      onSelectionChange(CanvasSelection.make(commands.map((command) => ({
        _tag: "frame",
        frameId: command.frameId
      }))))
    }
    document.addEventListener("copy", copy)
    document.addEventListener("paste", paste)
    return () => {
      document.removeEventListener("copy", copy)
      document.removeEventListener("paste", paste)
    }
  }, [frames, onSelectionChange, onSubmit, rootRef, selectionStore])
}
