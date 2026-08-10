import {
  useEffect,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from "react"

import type {
  CanvasGeometry,
  CanvasNote
} from "../core/index.js"
import { canvasItemStyle } from "./canvas-item-style.js"
import { NO_HELP_HOTKEY, helpTarget } from "./canvas-help.js"
import {
  CanvasSelection,
  type ResizeHandlePosition
} from "./canvas-selection.js"
import { frameStatus } from "./frame-chrome.js"
import { Glyph } from "./glyph.js"
import { OrderControls } from "./order-controls.js"

export function NoteCard({
  note,
  geometry,
  selected,
  zoom,
  onBringToFront,
  onMove,
  onRemove,
  onResize,
  onSelect,
  onSendToBack,
  onText
}: {
  readonly note: CanvasNote
  readonly geometry: CanvasGeometry
  readonly selected: boolean
  readonly zoom: number
  readonly onBringToFront: () => void
  readonly onMove: (event: ReactPointerEvent, item: CanvasNote) => void
  readonly onRemove: () => void
  readonly onResize: (
    event: ReactPointerEvent,
    item: CanvasNote,
    handle: ResizeHandlePosition
  ) => void
  readonly onSelect: () => void
  readonly onSendToBack: () => void
  readonly onText: (expectedText: string, text: string) => void
}) {
  const [text, setText] = useState(note.text)
  useEffect(() => setText(note.text), [note.text])
  return (
    <article
      className="crit-note"
      data-selected={selected || undefined}
      style={{ ...canvasItemStyle(geometry, note.zIndex), "--crit-ui": 1 } as CSSProperties}
    >
      <header
        className="crit-note__chrome"
        {...helpTarget({
          name: "Move note",
          hotkey: NO_HELP_HOTKEY,
          description: "Drag the note header to reposition it on the canvas."
        })}
        onPointerDown={(event) => {
          onSelect()
          onMove(event, note)
        }}
      >
        <span className="crit-note__label">{note.attachedTo === null ? "Note" : `Attached to ${note.attachedTo}`}</span>
        <span className="crit-note__actions">
          <OrderControls
            label="note"
            onBringToFront={onBringToFront}
            onSendToBack={onSendToBack}
          />
          <button
            aria-keyshortcuts="Backspace"
            aria-label="Delete note"
            {...helpTarget({
              name: "Remove note",
              hotkey: "Del",
              description: "Remove this note from the canvas."
            })}
            onClick={onRemove}
            onPointerDown={(event) => event.stopPropagation()}
            type="button"
          ><Glyph name="trash" /></button>
        </span>
      </header>
      <textarea
        aria-label="Note"
        {...helpTarget({
          name: "Edit note",
          hotkey: NO_HELP_HOTKEY,
          description: "Write review feedback. Changes save when focus leaves the note."
        })}
        onBlur={() => text !== note.text && onText(note.text, text)}
        onChange={(event) => setText(event.currentTarget.value)}
        value={text}
      />
      {!selected ? (
        <button
          aria-label="Select note"
          className="crit-note__select-shield"
          {...helpTarget({
            name: "Select note",
            hotkey: "V",
            description: "Select this note so it can be moved or resized."
          })}
          onPointerDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onSelect()
          }}
          type="button"
        />
      ) : null}
      {selected ? (
        <CanvasSelection
          ink={frameStatus("archived").ink}
          label="note"
          onResize={(event, handle) => onResize(event, note, handle)}
          zoom={zoom}
        />
      ) : null}
    </article>
  )
}
