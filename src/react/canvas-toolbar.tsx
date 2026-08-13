import type { CanvasTool } from "./canvas-cursors.js"
import { NO_HELP_HOTKEY, helpTarget } from "./canvas-help.js"
import { Glyph } from "./glyph.js"

export type CanvasToolbarAction =
  | "undo"
  | "redo"
  | "select"
  | "pan"
  | "add-frame"
  | "add-note"
  | "comment"

export interface CanvasToolbarProps {
  readonly title: string
  readonly tool: CanvasTool
  readonly commentAvailable: boolean
  readonly noteAvailable: boolean
  readonly onAction: (action: CanvasToolbarAction) => void
  readonly undoAvailable?: boolean
  readonly redoAvailable?: boolean
}

export function CanvasToolbar({
  title,
  tool,
  commentAvailable,
  noteAvailable,
  onAction,
  undoAvailable = false,
  redoAvailable = false
}: CanvasToolbarProps) {
  return (
    <div
      aria-label="Canvas toolbar"
      className="crit-toolbar"
      onPointerDown={(event) => event.stopPropagation()}
      role="toolbar"
    >
      <span
        className="crit-toolbar__title"
        {...helpTarget({
          name: title,
          hotkey: NO_HELP_HOTKEY,
          description: "The canvas currently open for arranging and reviewing work."
        })}
      >
        <span>{title}</span>
        <Glyph name="switcher" />
      </span>
      <span aria-hidden="true" className="crit-toolbar__divider" />
      <span className="crit-toolbar__group">
        <button
          aria-disabled={!undoAvailable}
          aria-label="Undo"
          className="crit-icon-button"
          {...helpTarget({
            name: "Undo",
            hotkey: NO_HELP_HOTKEY,
            description: undoAvailable ? "Undo the last canvas change." : "Undo is not available yet."
          })}
          onClick={() => undoAvailable && onAction("undo")}
          type="button"
        ><Glyph name="undo" /></button>
        <button
          aria-disabled={!redoAvailable}
          aria-label="Redo"
          className="crit-icon-button"
          {...helpTarget({
            name: "Redo",
            hotkey: NO_HELP_HOTKEY,
            description: redoAvailable ? "Redo the last undone canvas change." : "Redo is not available yet."
          })}
          onClick={() => redoAvailable && onAction("redo")}
          type="button"
        ><Glyph name="redo" /></button>
      </span>
      <span aria-hidden="true" className="crit-toolbar__divider" />
      <span className="crit-toolbar__group">
        <button
          aria-keyshortcuts="V"
          aria-label="Select"
          aria-pressed={tool === "select"}
          className="crit-icon-button"
          {...helpTarget({
            name: "Select",
            hotkey: "V",
            description: "Drag empty canvas to select multiple Frames; hold Shift or Cmd/Ctrl to add to the selection."
          })}
          onClick={() => onAction("select")}
          type="button"
        ><Glyph name="pointer" /></button>
        <button
          aria-keyshortcuts="H"
          aria-label="Hand"
          aria-pressed={tool === "pan"}
          className="crit-icon-button"
          {...helpTarget({
            name: "Hand",
            hotkey: "H",
            description: "Drag the canvas to pan without selecting an item."
          })}
          onClick={() => onAction("pan")}
          type="button"
        ><Glyph name="pan" /></button>
        <button
          aria-keyshortcuts="F"
          aria-label="Add frame"
          className="crit-icon-button"
          {...helpTarget({
            name: "Add frame",
            hotkey: "F",
            description: "Add a live web page to the center of the current view."
          })}
          onClick={() => onAction("add-frame")}
          type="button"
        ><Glyph name="addFrame" /></button>
        <button
          aria-keyshortcuts="N"
          aria-label="Add note"
          className="crit-icon-button"
          disabled={!noteAvailable}
          {...helpTarget({
            name: "Add note",
            hotkey: "N",
            description: noteAvailable
              ? "Add an editable note to the center of the current view."
              : "Configure Git user.name and user.email to add notes."
          })}
          onClick={() => noteAvailable && onAction("add-note")}
          type="button"
        ><Glyph name="note" /></button>
        <button
          aria-label="Comment"
          aria-pressed={tool === "comment"}
          className="crit-icon-button"
          disabled={!commentAvailable}
          {...helpTarget({
            name: "Comment",
            hotkey: NO_HELP_HOTKEY,
            description: commentAvailable
              ? "Pin feedback to an element or location inside a live frame."
              : "Configure Git user.name and user.email to leave comments."
          })}
          onClick={() => onAction("comment")}
          type="button"
        ><Glyph name="comment" /></button>
      </span>
    </div>
  )
}
