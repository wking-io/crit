import { Button } from "@base-ui/react/button"
import { Dialog } from "@base-ui/react/dialog"
import { Input } from "@base-ui/react/input"
import { Menu } from "@base-ui/react/menu"
import { Toggle } from "@base-ui/react/toggle"
import { Toolbar } from "@base-ui/react/toolbar"
import { Effect } from "effect"
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type Ref
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
import { useCritOverlayContainer } from "./overlay-container.js"

export type CanvasToolbarAction =
  | "undo"
  | "redo"
  | "select"
  | "pan"
  | "add-frame"
  | "add-note"
  | "comment"

export interface CanvasChoice {
  readonly id: string
  readonly title: string
}

export interface CanvasToolbarProps {
  readonly canvasId?: string
  readonly canvasChoices?: ReadonlyArray<CanvasChoice> | undefined
  readonly title: string
  readonly tool: CanvasTool
  readonly commentAvailable: boolean
  readonly noteAvailable: boolean
  readonly onAction: (action: CanvasToolbarAction) => void
  readonly onCanvasSelect?: ((canvasId: string) => void) | undefined
  readonly onTitleChange?: (title: string) => Effect.Effect<unknown, unknown>
  readonly addFrameButtonRef?: Ref<HTMLButtonElement>
  readonly undoAvailable?: boolean
  readonly redoAvailable?: boolean
  readonly selectedItemCount?: number
  readonly onArrange?: (
    operation: CanvasArrangementOperation
  ) => Effect.Effect<unknown, unknown>
  readonly trailingControls?: ReactNode
}

function ActionButton({
  action,
  children,
  className = "crit-icon-button",
  controls,
  buttonRef,
  pressed,
  onRun
}: {
  readonly action: ResolvedCanvasAction
  readonly children: ReactNode
  readonly className?: string
  readonly controls: CanvasControlsInstance
  readonly buttonRef?: Ref<HTMLButtonElement> | undefined
  readonly pressed?: boolean
  readonly onRun: () => void
}) {
  const runner = useCanvasActionRunner()
  if (action.availability === "hidden") return null
  const content = pressed === undefined ? (
    <Toolbar.Button
      aria-keyshortcuts={action.ariaKeyShortcuts ?? undefined}
      aria-label={action.label}
      className={className}
      disabled={action.availability !== "enabled"}
      focusableWhenDisabled={false}
      ref={buttonRef}
      {...actionHelpTarget(action)}
      onClick={() => runner.run(controls, action, Effect.sync(onRun))}
      type="button"
    >{children}</Toolbar.Button>
  ) : (
    <Toolbar.Button
      aria-keyshortcuts={action.ariaKeyShortcuts ?? undefined}
      aria-label={action.label}
      className={className}
      disabled={action.availability !== "enabled"}
      focusableWhenDisabled={false}
      ref={buttonRef}
      {...actionHelpTarget(action)}
      onClick={() => runner.run(controls, action, Effect.sync(onRun))}
      render={<Toggle pressed={pressed} />}
    >{children}</Toolbar.Button>
  )
  return content
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

interface ArrangementAnchorBounds {
  readonly bottom: number
  readonly height: number
  readonly left: number
  readonly right: number
  readonly top: number
  readonly width: number
  readonly x: number
  readonly y: number
}

export const arrangementMenuAnchorRect = (
  trigger: ArrangementAnchorBounds,
  toolbar: ArrangementAnchorBounds
) => ({
  bottom: toolbar.bottom,
  height: toolbar.height,
  left: trigger.left,
  right: trigger.right,
  top: toolbar.top,
  width: trigger.width,
  x: trigger.x,
  y: toolbar.y,
  toJSON: () => ({})
})

function CanvasTitleDialog({
  finalFocus,
  onOpenChange,
  onSave,
  open,
  title
}: {
  readonly finalFocus?: Dialog.Popup.Props["finalFocus"]
  readonly onOpenChange: (open: boolean) => void
  readonly onSave: (title: string) => Effect.Effect<unknown, unknown>
  readonly open: boolean
  readonly title: string
}) {
  const [draft, setDraft] = useState(title)
  const controls = useCanvasControls(["canvas", "canvas-title-edit"], true)
  const runner = useCanvasActionRunner()
  const overlayContainer = useCritOverlayContainer()
  const cancel = controls.action({ id: "cancel-canvas-title-edit" })
  const save = controls.action({ id: "save-canvas-title-edit" })
  const nextTitle = draft.trim()
  const saveAvailable =
    nextTitle.length > 0 && nextTitle !== title && save.availability === "enabled"

  useEffect(() => {
    if (open) setDraft(title)
  }, [open, title])

  const close = () => runner.run(
    controls,
    cancel,
    Effect.sync(() => onOpenChange(false))
  )
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!saveAvailable) return
    runner.run(
      controls,
      save,
      onSave(nextTitle).pipe(
        Effect.tap(() => Effect.sync(() => onOpenChange(false)))
      )
    )
  }

  return (
    <Dialog.Root
      modal
      onOpenChange={(nextOpen) => {
        if (!nextOpen && open) close()
      }}
      open={open}
    >
      <Dialog.Portal container={overlayContainer}>
        <Dialog.Backdrop className="crit-dialog-backdrop" />
        <Dialog.Popup
          className="crit-new-frame-dialog crit-new-frame-dialog--popup"
          finalFocus={finalFocus ?? true}
        >
          <form className="crit-new-frame-dialog__form" onSubmit={submit}>
            <Dialog.Title>Rename canvas</Dialog.Title>
            <Dialog.Description className="crit-new-frame-dialog__description">
              Change the title shown in Crit. The canvas ID stays the same.
            </Dialog.Description>
            <label>
              Title
              <Input
                aria-label="Canvas title"
                autoFocus
                onChange={(event) => setDraft(event.currentTarget.value)}
                required
                type="text"
                value={draft}
              />
            </label>
            <div className="crit-new-frame-dialog__actions">
              <Dialog.Close
                aria-keyshortcuts={cancel.ariaKeyShortcuts ?? undefined}
                {...actionHelpTarget(cancel)}
                type="button"
              >{cancel.label}</Dialog.Close>
              <Button
                aria-keyshortcuts={save.ariaKeyShortcuts ?? undefined}
                data-primary=""
                disabled={!saveAvailable}
                {...actionHelpTarget(save)}
                type="submit"
              >{save.label}</Button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function CanvasToolbar({
  canvasId,
  canvasChoices,
  title,
  tool,
  commentAvailable,
  noteAvailable,
  onAction,
  onCanvasSelect,
  onTitleChange,
  addFrameButtonRef,
  undoAvailable = false,
  redoAvailable = false,
  selectedItemCount = 0,
  onArrange = () => Effect.void,
  trailingControls
}: CanvasToolbarProps) {
  const [arrangementOpen, setArrangementOpen] = useState(false)
  const [titleEditing, setTitleEditing] = useState(false)
  const arrangementTriggerRef = useRef<HTMLButtonElement>(null)
  const titleTriggerRef = useRef<HTMLButtonElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const scopes = arrangementOpen
    ? ["canvas", "arrangement-menu"] as const
    : ["canvas"] as const
  const controls = useCanvasControls(scopes, commentAvailable || noteAvailable)
  const runner = useCanvasActionRunner()
  const overlayContainer = useCritOverlayContainer()
  const selectionHasMultipleItems = selectedItemCount >= 2
  const selectionHasThreeItems = selectedItemCount >= 3
  const select = controls.action({ id: "select-tool" })
  const hand = controls.action({ id: "hand-tool" })
  const addFrame = controls.action({ id: "open-new-frame" })
  const addNote = controls.action({ id: "create-note" })
  const comment = controls.action({ id: "activate-comment-tool" })
  const beginTitleEdit = controls.action({ id: "begin-canvas-title-edit" })
  const openArrangement = controls.action({
    id: "open-arrangement-menu",
    selectionHasMultipleItems
  })
  const closeArrangement = controls.action({ id: "close-arrangement-menu" })
  const arrangementTrigger = arrangementOpen
    ? closeArrangement
    : openArrangement
  const changeArrangementOpen = (open: boolean) => {
    const action = open ? openArrangement : closeArrangement
    runner.run(
      controls,
      action,
      Effect.sync(() => setArrangementOpen(open))
    )
  }

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

  const arrangementAnchor = () => {
    const trigger = arrangementTriggerRef.current
    const toolbar = toolbarRef.current
    if (trigger === null || toolbar === null) return trigger

    return {
      contextElement: trigger,
      getBoundingClientRect: () => arrangementMenuAnchorRect(
        trigger.getBoundingClientRect(),
        toolbar.getBoundingClientRect()
      )
    }
  }

  const choices = canvasChoices === undefined
    ? []
    : canvasId === undefined
      ? canvasChoices
      : canvasChoices.some((choice) => choice.id === canvasId)
        ? canvasChoices.map((choice) =>
            choice.id === canvasId ? { ...choice, title } : choice)
        : [{ id: canvasId, title }, ...canvasChoices]
  const canvasSelectionAvailable =
    canvasId !== undefined && onCanvasSelect !== undefined && choices.length > 0
  const canvasMenuAvailable = canvasSelectionAvailable || onTitleChange !== undefined
  const titleContent = (
    <>
      <span>{title}</span>
      <Glyph name="switcher" />
    </>
  )
  const titleTriggerLabel = onTitleChange === undefined
    ? "Change canvas"
    : "Canvas options"
  const titleHelp = informationalHelpTarget(onTitleChange !== undefined
    ? {
        name: "Canvas options",
        description: canvasSelectionAvailable
          ? "Rename this canvas or choose a different canvas."
          : "Rename this canvas."
      }
    : canvasSelectionAvailable
      ? {
          name: "Change canvas",
          description: "Choose a different canvas."
        }
    : {
        name: title,
        description: "The canvas currently open for arranging and reviewing work."
      })

  return (
    <Toolbar.Root
      aria-label="Canvas toolbar"
      className="crit-toolbar"
      loopFocus
      onPointerDown={(event) => event.stopPropagation()}
      ref={toolbarRef}
    >
      {canvasMenuAvailable ? (
        <Menu.Root>
          <Toolbar.Button
            aria-label={titleTriggerLabel}
            className="crit-toolbar__title"
            ref={titleTriggerRef}
            {...titleHelp}
            render={<Menu.Trigger />}
          >{titleContent}</Toolbar.Button>
          <Menu.Portal container={overlayContainer}>
            <Menu.Positioner
              align="start"
              alignOffset={8}
              anchor={toolbarRef}
              className="crit-canvas-switcher-positioner"
              side="bottom"
              sideOffset={8}
            >
              <Menu.Popup
                aria-label={titleTriggerLabel}
                className="crit-canvas-switcher"
              >
                {canvasSelectionAvailable ? (
                  <Menu.RadioGroup
                    onValueChange={(nextCanvasId) => {
                      if (nextCanvasId !== canvasId) onCanvasSelect?.(nextCanvasId)
                    }}
                    value={canvasId}
                  >
                    {choices.map((choice) => (
                      <Menu.RadioItem
                        className="crit-canvas-switcher__item"
                        key={choice.id}
                        value={choice.id}
                      >
                        <Menu.RadioItemIndicator
                          className="crit-canvas-switcher__indicator"
                        >
                          <span aria-hidden="true" />
                        </Menu.RadioItemIndicator>
                        <span className="crit-canvas-switcher__label">
                          {choice.title}
                        </span>
                      </Menu.RadioItem>
                    ))}
                  </Menu.RadioGroup>
                ) : null}
                {onTitleChange === undefined ? null : (
                  <>
                    {canvasSelectionAvailable ? (
                      <Menu.Separator className="crit-canvas-switcher__separator" />
                    ) : null}
                    <Menu.Item
                      className="crit-canvas-switcher__item"
                      onClick={() => runner.run(
                        controls,
                        beginTitleEdit,
                        Effect.sync(() => setTitleEditing(true))
                      )}
                    >
                      <Glyph name="edit" />
                      <span className="crit-canvas-switcher__label">
                        Rename canvas…
                      </span>
                    </Menu.Item>
                  </>
                )}
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      ) : (
        <span className="crit-toolbar__title" {...titleHelp}>
          {titleContent}
        </span>
      )}
      {onTitleChange === undefined ? null : (
        <CanvasTitleDialog
          finalFocus={titleTriggerRef}
          onOpenChange={setTitleEditing}
          onSave={onTitleChange}
          open={titleEditing}
          title={title}
        />
      )}
      <Toolbar.Separator className="crit-toolbar__divider" />
      <Toolbar.Group
        className="crit-toolbar__group"
        render={<span />}
      >
        <Toolbar.Button
          aria-disabled={!undoAvailable}
          aria-label="Undo"
          className="crit-icon-button"
          {...informationalHelpTarget({
            name: "Undo",
            description: undoAvailable ? "Undo the last canvas change." : "Undo is not available yet."
          })}
          onClick={() => undoAvailable && onAction("undo")}
          type="button"
        ><Glyph name="undo" /></Toolbar.Button>
        <Toolbar.Button
          aria-disabled={!redoAvailable}
          aria-label="Redo"
          className="crit-icon-button"
          {...informationalHelpTarget({
            name: "Redo",
            description: redoAvailable ? "Redo the last undone canvas change." : "Redo is not available yet."
          })}
          onClick={() => redoAvailable && onAction("redo")}
          type="button"
        ><Glyph name="redo" /></Toolbar.Button>
        <Menu.Root
          modal={false}
          onOpenChange={changeArrangementOpen}
          open={arrangementOpen}
        >
          <Toolbar.Button
            aria-expanded={arrangementOpen}
            aria-haspopup="menu"
            aria-keyshortcuts={arrangementTrigger.ariaKeyShortcuts ?? undefined}
            aria-label={arrangementTrigger.label}
            className="crit-icon-button"
            disabled={arrangementTrigger.availability !== "enabled"}
            focusableWhenDisabled={false}
            ref={arrangementTriggerRef}
            {...actionHelpTarget(arrangementTrigger)}
            render={<Menu.Trigger />}
          ><Glyph name="arrangement" /></Toolbar.Button>
          <Menu.Portal container={overlayContainer}>
            <Menu.Positioner
              align="center"
              anchor={arrangementAnchor}
              className="crit-arrangement-positioner"
              side="bottom"
              sideOffset={8}
            >
              <Menu.Popup
                aria-label="Align and distribute"
                className="crit-arrangement-popover"
              >
                <div className="crit-arrangement-popover__grid">
                  {alignmentOptions.map((option) => {
                    const action = controls.action({
                      id: "align-selection",
                      alignment: option.alignment,
                      selectionHasMultipleItems
                    })
                    return (
                      <Menu.Item
                        aria-label={action.label}
                        className="crit-arrangement-popover__button"
                        closeOnClick={false}
                        disabled={action.availability !== "enabled"}
                        key={option.alignment}
                        label={action.label}
                        {...actionHelpTarget(action)}
                        onClick={() => runArrangement(action, {
                          _tag: "Align",
                          alignment: option.alignment
                        })}
                      ><Glyph name={option.glyph} /></Menu.Item>
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
                      <Menu.Item
                        aria-label={action.label}
                        className="crit-arrangement-popover__button"
                        closeOnClick={false}
                        disabled={action.availability !== "enabled"}
                        key={option.axis}
                        label={action.label}
                        {...actionHelpTarget(action)}
                        onClick={() => runArrangement(action, {
                          _tag: "Distribute",
                          axis: option.axis
                        })}
                      ><Glyph name={option.glyph} /></Menu.Item>
                    )
                  })}
                  {(() => {
                    const action = controls.action({
                      id: "arrange-selection-grid",
                      selectionHasMultipleItems
                    })
                    return (
                      <Menu.Item
                        aria-label={action.label}
                        className="crit-arrangement-popover__button"
                        closeOnClick={false}
                        disabled={action.availability !== "enabled"}
                        label={action.label}
                        {...actionHelpTarget(action)}
                        onClick={() => runArrangement(action, {
                          _tag: "ArrangeGrid"
                        })}
                      ><Glyph name="arrangeGrid" /></Menu.Item>
                    )
                  })()}
                </div>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </Toolbar.Group>
      <Toolbar.Separator className="crit-toolbar__divider" />
      <Toolbar.Group
        className="crit-toolbar__group"
        render={<span />}
      >
        <ActionButton action={select} controls={controls} pressed={tool === "select"} onRun={() => onAction("select")}>
          <Glyph name="pointer" />
        </ActionButton>
        <ActionButton action={hand} controls={controls} pressed={tool === "pan"} onRun={() => onAction("pan")}>
          <Glyph name="pan" />
        </ActionButton>
        <ActionButton action={addFrame} buttonRef={addFrameButtonRef} controls={controls} onRun={() => onAction("add-frame")}>
          <Glyph name="addFrame" />
        </ActionButton>
        <ActionButton action={addNote} controls={controls} onRun={() => onAction("add-note")}>
          <Glyph name="note" />
        </ActionButton>
        <ActionButton action={comment} controls={controls} pressed={tool === "comment"} onRun={() => onAction("comment")}>
          <Glyph name="comment" />
        </ActionButton>
      </Toolbar.Group>
      {trailingControls === undefined ? null : (
        <>
          <Toolbar.Separator className="crit-toolbar__divider" />
          {trailingControls}
        </>
      )}
    </Toolbar.Root>
  )
}
