import { Button } from "@base-ui/react/button"
import { Dialog } from "@base-ui/react/dialog"
import { Input } from "@base-ui/react/input"
import { Menu } from "@base-ui/react/menu"
import { Toolbar } from "@base-ui/react/toolbar"
import type { CanvasCommandBatch, CanvasProjection } from "@crit/domain"
import { useHotkeys } from "@tanstack/react-hotkeys"
import { useEffect, useRef, useState, type FormEvent, type ReactElement } from "react"

import type { CanvasAlignment } from "./canvas-arrangement.js"
import {
  TOOLBAR_OVERLAY_GAP,
  toolbarOverlayAnchor,
  toolbarOverlayPositionerProps
} from "./canvas-toolbar-overlay.js"
import { Glyph, GlyphProvider, type GlyphName } from "./glyph.js"
import { CritOverlayProvider, useCritOverlayContainer } from "./overlay-container.js"
import {
  ReviewActionInput,
  reviewActionPolicies,
  reviewActionPolicy,
  type ReviewActionId,
  type ReviewClientEffect,
  type ReviewSelection
} from "./review-actions.js"
import {
  ReviewHelpPanel,
  ReviewHelpSurface,
  reviewActionHelpTarget,
  reviewInformationalHelpTarget
} from "./review-help.js"
import {
  ReviewRunnerProvider,
  useOptionalReviewRunner,
  type ReviewRunner
} from "./review-runner.js"
import type { FrameSnapshotter } from "./frame-snapshot.js"

export interface ReviewChromeProps {
  readonly projection: CanvasProjection
  readonly selection: ReviewSelection
  readonly onSubmit: (commands: CanvasCommandBatch) => void
  readonly onEffect?: (effect: ReviewClientEffect) => void
  readonly snapshotter?: FrameSnapshotter
  readonly fullscreen?: boolean
}

const alignmentOptions = [
  { id: "align-left", alignment: "left", glyph: "alignLeft" },
  { id: "align-horizontal-center", alignment: "horizontal-center", glyph: "alignHorizontalCenter" },
  { id: "align-right", alignment: "right", glyph: "alignRight" },
  { id: "align-top", alignment: "top", glyph: "alignTop" },
  { id: "align-vertical-center", alignment: "vertical-center", glyph: "alignVerticalCenter" },
  { id: "align-bottom", alignment: "bottom", glyph: "alignBottom" }
] as const satisfies readonly {
  readonly id: ReviewActionId
  readonly alignment: CanvasAlignment
  readonly glyph: GlyphName
}[]

const distributionOptions = [
  { id: "distribute-vertical", glyph: "distributeVertical" },
  { id: "distribute-horizontal", glyph: "distributeHorizontal" }
] as const satisfies readonly {
  readonly id: ReviewActionId
  readonly glyph: GlyphName
}[]

function CanvasTitleDialog({
  onOpenChange,
  onSave,
  open,
  title
}: {
  readonly onOpenChange: (open: boolean) => void
  readonly onSave: (title: string) => boolean
  readonly open: boolean
  readonly title: string
}) {
  const [draft, setDraft] = useState(title)
  const overlayContainer = useCritOverlayContainer()
  const cancel = reviewActionPolicy("rename-canvas")
  const nextTitle = draft.trim()
  const saveAvailable = nextTitle.length > 0 && nextTitle !== title

  useEffect(() => {
    if (open) setDraft(title)
  }, [open, title])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!saveAvailable) return
    if (onSave(nextTitle)) onOpenChange(false)
  }

  return (
    <Dialog.Root
      modal
      onOpenChange={(nextOpen) => {
        if (!nextOpen && open) onOpenChange(false)
      }}
      open={open}
    >
      <Dialog.Portal container={overlayContainer}>
        <Dialog.Backdrop className="crit-dialog-backdrop" />
        <Dialog.Popup className="crit-new-frame-dialog crit-new-frame-dialog--popup">
          <form
            aria-label={cancel.label}
            className="crit-new-frame-dialog__form"
            onSubmit={submit}
          >
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
              <Dialog.Close type="button">Cancel</Dialog.Close>
              <Button
                data-primary=""
                disabled={!saveAvailable}
                type="submit"
              >
                Save title
              </Button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ReviewChromeView({
  projection,
  run,
  runnableIds,
  snapshotCapturing,
  snapshotFailed
}: {
  readonly projection: CanvasProjection
  readonly run: ReviewRunner["run"]
  readonly runnableIds: ReadonlySet<string>
  readonly snapshotCapturing: boolean
  readonly snapshotFailed: boolean
}): ReactElement {
  const [arrangementOpen, setArrangementOpen] = useState(false)
  const [titleEditing, setTitleEditing] = useState(false)
  const arrangementTriggerRef = useRef<HTMLButtonElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const overlayContainer = useCritOverlayContainer()
  const rename = reviewActionPolicy("rename-canvas")
  const arrangeGrid = reviewActionPolicy("arrange-grid")
  const alignmentAvailable = alignmentOptions.some((option) =>
    runnableIds.has(option.id)
  )
  const arrangementTrigger = {
    name: "Align and distribute",
    description: "Align, distribute, or arrange the selected Frames."
  }

  useHotkeys(
    reviewActionPolicies.flatMap((policy) =>
      policy.shortcuts.map((hotkey) => ({
        hotkey,
        callback: () => {
          run(policy.id)
        },
        options: {
          enabled: runnableIds.has(policy.id),
          ignoreInputs: hotkey !== "Escape"
        }
      }))
    )
  )

  const arrangementAnchor = () => toolbarOverlayAnchor(
    arrangementTriggerRef.current,
    toolbarRef.current
  )

  return (
    <aside
      aria-label="Review controls"
      className="crit-review-chrome"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <ReviewHelpSurface className="crit-overlay-container">
        <Toolbar.Root
          aria-label="Canvas toolbar"
          className="crit-toolbar"
          data-crit-toolbar=""
          loopFocus
          ref={toolbarRef}
        >
          <Menu.Root>
            <Toolbar.Button
              aria-label="Canvas options"
              className="crit-toolbar__title"
              {...reviewInformationalHelpTarget({
                name: "Canvas options",
                description: "Rename this canvas."
              })}
              render={<Menu.Trigger />}
            >
              <span>{projection.title}</span>
              <Glyph name="switcher" />
            </Toolbar.Button>
            <Menu.Portal container={overlayContainer}>
              <Menu.Positioner
                {...toolbarOverlayPositionerProps}
                alignOffset={TOOLBAR_OVERLAY_GAP}
                anchor={toolbarRef}
                className="crit-toolbar-overlay-positioner crit-canvas-switcher-positioner"
              >
                <Menu.Popup
                  aria-label="Canvas options"
                  className="crit-canvas-switcher"
                >
                  <Menu.Item
                    className="crit-canvas-switcher__item"
                    {...reviewActionHelpTarget(rename)}
                    onClick={() => setTitleEditing(true)}
                  >
                    <Glyph name="edit" />
                    <span className="crit-canvas-switcher__label">
                      Rename canvas…
                    </span>
                  </Menu.Item>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
          <CanvasTitleDialog
            onOpenChange={setTitleEditing}
            onSave={(title) => run("rename-canvas", ReviewActionInput.text({ text: title }))}
            open={titleEditing}
            title={projection.title}
          />
          <Toolbar.Separator className="crit-toolbar__divider" />
          <Toolbar.Group className="crit-toolbar__group" render={<span />}>
            <Menu.Root
              modal={false}
              onOpenChange={setArrangementOpen}
              open={arrangementOpen}
            >
              <Toolbar.Button
                aria-expanded={arrangementOpen}
                aria-haspopup="menu"
                aria-label={arrangementTrigger.name}
                className="crit-icon-button"
                disabled={!alignmentAvailable}
                focusableWhenDisabled={false}
                ref={arrangementTriggerRef}
                {...reviewInformationalHelpTarget(arrangementTrigger)}
                render={<Menu.Trigger />}
              >
                <Glyph name="arrangement" />
              </Toolbar.Button>
              <Menu.Portal container={overlayContainer}>
                <Menu.Positioner
                  {...toolbarOverlayPositionerProps}
                  align="center"
                  anchor={arrangementAnchor}
                  className="crit-toolbar-overlay-positioner crit-arrangement-positioner"
                >
                  <Menu.Popup
                    aria-label="Align and distribute"
                    className="crit-arrangement-popover"
                  >
                    <div className="crit-arrangement-popover__grid">
                      {alignmentOptions.map((option) => {
                        const policy = reviewActionPolicy(option.id)
                        return (
                          <Menu.Item
                            aria-label={policy.label}
                            className="crit-arrangement-popover__button"
                            closeOnClick={false}
                            disabled={!runnableIds.has(option.id)}
                            key={option.id}
                            label={policy.label}
                            {...reviewActionHelpTarget(policy)}
                            onClick={() => run(option.id)}
                          >
                            <Glyph name={option.glyph} />
                          </Menu.Item>
                        )
                      })}
                    </div>
                    <div className="crit-arrangement-popover__grid crit-arrangement-popover__grid--distribution">
                      {distributionOptions.map((option) => {
                        const policy = reviewActionPolicy(option.id)
                        return (
                          <Menu.Item
                            aria-label={policy.label}
                            className="crit-arrangement-popover__button"
                            closeOnClick={false}
                            disabled={!runnableIds.has(option.id)}
                            key={option.id}
                            label={policy.label}
                            {...reviewActionHelpTarget(policy)}
                            onClick={() => run(option.id)}
                          >
                            <Glyph name={option.glyph} />
                          </Menu.Item>
                        )
                      })}
                      <Menu.Item
                        aria-label={arrangeGrid.label}
                        className="crit-arrangement-popover__button"
                        closeOnClick={false}
                        disabled={!runnableIds.has(arrangeGrid.id)}
                        label={arrangeGrid.label}
                        {...reviewActionHelpTarget(arrangeGrid)}
                        onClick={() => run(arrangeGrid.id)}
                      >
                        <Glyph name="arrangeGrid" />
                      </Menu.Item>
                    </div>
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.Root>
          </Toolbar.Group>
          {snapshotCapturing
            ? <p role="status">Capturing snapshot.</p>
            : null}
          {snapshotFailed
            ? <p role="alert">Snapshot failed.</p>
            : null}
        </Toolbar.Root>
        <ReviewHelpPanel />
      </ReviewHelpSurface>
    </aside>
  )
}

function ReviewChromeBound(props: ReviewChromeProps): ReactElement {
  const runner = useOptionalReviewRunner()
  if (runner === null) {
    return (
      <ReviewRunnerProvider
        fullscreen={props.fullscreen ?? false}
        onEffect={props.onEffect}
        onSubmit={props.onSubmit}
        projection={props.projection}
        selection={props.selection}
        snapshotter={props.snapshotter}
      >
        <ReviewChromeBound {...props} />
      </ReviewRunnerProvider>
    )
  }
  return (
    <ReviewChromeView
      projection={props.projection}
      run={runner.run}
      runnableIds={runner.runnableIds}
      snapshotCapturing={runner.snapshotCapturing}
      snapshotFailed={runner.snapshotFailed}
    />
  )
}

function ReviewChromeStandalone(props: ReviewChromeProps): ReactElement {
  const overlay = useCritOverlayContainer()
  if (overlay !== undefined) return <ReviewChromeBound {...props} />
  return (
    <GlyphProvider>
      <CritOverlayProvider>
        <ReviewChromeBound {...props} />
      </CritOverlayProvider>
    </GlyphProvider>
  )
}

export function ReviewChrome(props: ReviewChromeProps): ReactElement {
  return <ReviewChromeStandalone {...props} />
}
