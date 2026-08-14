import { Effect } from "effect"
import {
  useEffect,
  useRef,
  useState,
  type ReactNode
} from "react"

import {
  useCanvasActionRunner,
  useCanvasControls
} from "./canvas-action-runner.js"
import type {
  CanvasControlsInstance,
  ResolvedCanvasAction
} from "./canvas-controls.js"
import type { CanvasArrangementOperation } from "./canvas-arrangement.js"
import type { CanvasTool } from "./canvas-cursors.js"
import {
  actionHelpTarget,
  informationalHelpTarget
} from "./canvas-help.js"
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
  readonly selectedItemCount?: number
  readonly onArrange?: (
    operation: CanvasArrangementOperation
  ) => Effect.Effect<unknown, unknown>
}

function ActionButton({
  action,
  children,
  className = "crit-icon-button",
  controls,
  pressed,
  onRun
}: {
  readonly action: ResolvedCanvasAction
  readonly children: ReactNode
  readonly className?: string
  readonly controls: CanvasControlsInstance
  readonly pressed?: boolean
  readonly onRun: () => void
}) {
  const runner = useCanvasActionRunner()
  if (action.availability === "hidden") return null
  return (
    <button
      aria-keyshortcuts={action.ariaKeyShortcuts}
      aria-label={action.label}
      {...(pressed === undefined ? {} : { "aria-pressed": pressed })}
      className={className}
      disabled={action.availability !== "enabled"}
      {...actionHelpTarget(action)}
      onClick={() => runner.run(controls, action, Effect.sync(onRun))}
      type="button"
    >{children}</button>
  )
}

const alignmentOptions = [
  { alignment: "left", glyph: "alignLeft" },
  { alignment: "horizontal-center", glyph: "alignHorizontalCenter" },
  { alignment: "right", glyph: "alignRight" },
  { alignment: "top", glyph: "alignTop" },
  { alignment: "vertical-center", glyph: "alignVerticalCenter" },
  { alignment: "bottom", glyph: "alignBottom" }
] as const

const distributionOptions = [
  { axis: "vertical", glyph: "distributeVertical" },
  { axis: "horizontal", glyph: "distributeHorizontal" }
] as const

export function CanvasToolbar({
  title,
  tool,
  commentAvailable,
  noteAvailable,
  onAction,
  undoAvailable = false,
  redoAvailable = false,
  selectedItemCount = 0,
  onArrange = () => Effect.void
}: CanvasToolbarProps) {
  const [arrangementOpen, setArrangementOpen] = useState(false)
  const arrangementRef = useRef<HTMLSpanElement>(null)
  const scopes = arrangementOpen
    ? ["canvas", "arrangement-menu"] as const
    : ["canvas"] as const
  const controls = useCanvasControls(scopes, commentAvailable || noteAvailable)
  const runner = useCanvasActionRunner()
  const selectionHasMultipleItems = selectedItemCount >= 2
  const selectionHasThreeItems = selectedItemCount >= 3
  const select = controls.action({ id: "select-tool" })
  const hand = controls.action({ id: "hand-tool" })
  const addFrame = controls.action({ id: "open-new-frame" })
  const addNote = controls.action({ id: "create-note" })
  const comment = controls.action({ id: "activate-comment-tool" })
  const openArrangement = controls.action({
    id: "open-arrangement-menu",
    selectionHasMultipleItems
  })
  const closeArrangement = controls.action({ id: "close-arrangement-menu" })
  const arrangementTrigger = arrangementOpen
    ? closeArrangement
    : openArrangement
  const closeArrangementMenu = () => runner.run(
    controls,
    closeArrangement,
    Effect.sync(() => setArrangementOpen(false))
  )

  useEffect(() => {
    if (!arrangementOpen) return
    const closeForOutsidePointer = (event: PointerEvent) => {
      if (!arrangementRef.current?.contains(event.target as Node)) {
        closeArrangementMenu()
      }
    }
    const closeForEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      closeArrangementMenu()
    }
    document.addEventListener("pointerdown", closeForOutsidePointer)
    document.addEventListener("keydown", closeForEscape)
    return () => {
      document.removeEventListener("pointerdown", closeForOutsidePointer)
      document.removeEventListener("keydown", closeForEscape)
    }
  }, [arrangementOpen, closeArrangement, controls, runner])

  useEffect(() => {
    if (!selectionHasMultipleItems) setArrangementOpen(false)
  }, [selectionHasMultipleItems])

  const runArrangement = (
    action: ResolvedCanvasAction,
    operation: CanvasArrangementOperation
  ) => runner.run(
    controls,
    action,
    onArrange(operation).pipe(
      Effect.tap(() => Effect.sync(() => setArrangementOpen(false)))
    )
  )

  return (
    <div
      aria-label="Canvas toolbar"
      className="crit-toolbar"
      onPointerDown={(event) => event.stopPropagation()}
      role="toolbar"
    >
      <span
        className="crit-toolbar__title"
        {...informationalHelpTarget({
          name: title,
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
          {...informationalHelpTarget({
            name: "Undo",
            description: undoAvailable ? "Undo the last canvas change." : "Undo is not available yet."
          })}
          onClick={() => undoAvailable && onAction("undo")}
          type="button"
        ><Glyph name="undo" /></button>
        <button
          aria-disabled={!redoAvailable}
          aria-label="Redo"
          className="crit-icon-button"
          {...informationalHelpTarget({
            name: "Redo",
            description: redoAvailable ? "Redo the last undone canvas change." : "Redo is not available yet."
          })}
          onClick={() => redoAvailable && onAction("redo")}
          type="button"
        ><Glyph name="redo" /></button>
        <span className="crit-arrangement-control" ref={arrangementRef}>
          <button
            aria-expanded={arrangementOpen}
            aria-haspopup="menu"
            aria-keyshortcuts={arrangementTrigger.ariaKeyShortcuts}
            aria-label={arrangementTrigger.label}
            className="crit-icon-button"
            disabled={arrangementTrigger.availability !== "enabled"}
            {...actionHelpTarget(arrangementTrigger)}
            onClick={() => arrangementOpen
              ? closeArrangementMenu()
              : runner.run(
                  controls,
                  openArrangement,
                  Effect.sync(() => setArrangementOpen(true))
                )}
            type="button"
          ><Glyph name="arrangement" /></button>
          {arrangementOpen ? (
            <div
              aria-label="Align and distribute"
              className="crit-arrangement-popover"
              role="menu"
            >
              <div className="crit-arrangement-popover__grid">
                {alignmentOptions.map((option) => {
                  const action = controls.action({
                    id: "align-selection",
                    alignment: option.alignment,
                    selectionHasMultipleItems
                  })
                  return (
                    <button
                      aria-label={action.label}
                      className="crit-arrangement-popover__button"
                      disabled={action.availability !== "enabled"}
                      key={option.alignment}
                      {...actionHelpTarget(action)}
                      onClick={() => runArrangement(action, {
                        _tag: "Align",
                        alignment: option.alignment
                      })}
                      role="menuitem"
                      type="button"
                    ><Glyph name={option.glyph} /></button>
                  )
                })}
              </div>
              <div className="crit-arrangement-popover__grid crit-arrangement-popover__grid--distribution">
                {distributionOptions.map((option) => {
                  const action = controls.action({
                    id: "distribute-selection",
                    axis: option.axis,
                    selectionHasThreeItems
                  })
                  return (
                    <button
                      aria-label={action.label}
                      className="crit-arrangement-popover__button"
                      disabled={action.availability !== "enabled"}
                      key={option.axis}
                      {...actionHelpTarget(action)}
                      onClick={() => runArrangement(action, {
                        _tag: "Distribute",
                        axis: option.axis
                      })}
                      role="menuitem"
                      type="button"
                    ><Glyph name={option.glyph} /></button>
                  )
                })}
                {(() => {
                  const action = controls.action({
                    id: "arrange-selection-grid",
                    selectionHasMultipleItems
                  })
                  return (
                    <button
                      aria-label={action.label}
                      className="crit-arrangement-popover__button"
                      disabled={action.availability !== "enabled"}
                      {...actionHelpTarget(action)}
                      onClick={() => runArrangement(action, {
                        _tag: "ArrangeGrid"
                      })}
                      role="menuitem"
                      type="button"
                    ><Glyph name="arrangeGrid" /></button>
                  )
                })()}
              </div>
            </div>
          ) : null}
        </span>
      </span>
      <span aria-hidden="true" className="crit-toolbar__divider" />
      <span className="crit-toolbar__group">
        <ActionButton action={select} controls={controls} pressed={tool === "select"} onRun={() => onAction("select")}>
          <Glyph name="pointer" />
        </ActionButton>
        <ActionButton action={hand} controls={controls} pressed={tool === "pan"} onRun={() => onAction("pan")}>
          <Glyph name="pan" />
        </ActionButton>
        <ActionButton action={addFrame} controls={controls} onRun={() => onAction("add-frame")}>
          <Glyph name="addFrame" />
        </ActionButton>
        <ActionButton action={addNote} controls={controls} onRun={() => onAction("add-note")}>
          <Glyph name="note" />
        </ActionButton>
        <ActionButton action={comment} controls={controls} pressed={tool === "comment"} onRun={() => onAction("comment")}>
          <Glyph name="comment" />
        </ActionButton>
      </span>
    </div>
  )
}
