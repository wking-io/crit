import { Menu } from "@base-ui/react/menu"
import { Toolbar } from "@base-ui/react/toolbar"
import type { CanvasProjection } from "@crit/domain"
import { useHotkeys } from "@tanstack/react-hotkeys"
import { useRef, useState, type ReactElement } from "react"

import type { CanvasAlignment } from "./canvas-arrangement.js"
import { CanvasTitleDialog } from "./canvas-title-dialog.js"
import {
  TOOLBAR_OVERLAY_GAP,
  toolbarOverlayAnchor,
  toolbarOverlayPositionerProps
} from "./canvas-toolbar-overlay.js"
import { Glyph, type GlyphName } from "./glyph.js"
import { useCritOverlayContainer } from "./overlay-container.js"
import {
  ReviewActionInput,
  reviewActionPolicies,
  reviewActionPolicy,
  type ReviewActionId
} from "./review-actions.js"
import {
  ReviewHelpPanel,
  ReviewHelpSurface,
  reviewActionHelpTarget,
  reviewInformationalHelpTarget
} from "./review-help.js"
import type { ReviewRunner } from "./review-runner.js"

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

const arrangementTrigger = {
  name: "Align and distribute",
  description: "Align, distribute, or arrange the selected Frames."
}

export function ReviewChromeView({
  onAddFramePlacement,
  projection,
  requestAddFrame,
  run,
  runnableIds,
  snapshotCapturing,
  snapshotFailed
}: {
  readonly onAddFramePlacement?: () => { readonly x: number; readonly y: number }
  readonly projection: CanvasProjection
  readonly requestAddFrame: ReviewRunner["requestAddFrame"]
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
  const addFrame = reviewActionPolicy("add-frame")
  const arrangeGrid = reviewActionPolicy("arrange-grid")
  const alignmentAvailable = alignmentOptions.some((option) =>
    runnableIds.has(option.id)
  )

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
            <Toolbar.Button
              aria-label={addFrame.label}
              className="crit-icon-button"
              {...reviewActionHelpTarget(addFrame)}
              onClick={() => requestAddFrame(
                onAddFramePlacement?.() ?? { x: 0, y: 0 }
              )}
            >
              <Glyph name="addFrame" />
            </Toolbar.Button>
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
