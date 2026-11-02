import { Menu } from "@base-ui/react/menu"
import { Toolbar } from "@base-ui/react/toolbar"
import type { CanvasProjection } from "@crit/domain"
import { useHotkeys } from "@tanstack/react-hotkeys"
import { useRef, useState, type ReactElement } from "react"

import { CanvasTitleDialog } from "./canvas-title-dialog.js"
import {
  TOOLBAR_OVERLAY_GAP,
  toolbarOverlayPositionerProps
} from "./canvas-toolbar-overlay.js"
import { Glyph } from "./glyph.js"
import { useCritOverlayContainer } from "./overlay-container.js"
import {
  ReviewActionInput,
  reviewActionPolicies
} from "./review-actions.js"
import {
  reviewActionHelpTarget,
  reviewInformationalHelpTarget
} from "./review-help.js"
import type { ReviewRunner } from "./review-runner.js"

export function ReviewChromeView({
  action,
  projection,
  run,
  runnableIds,
  snapshotCapturing,
  snapshotFailed
}: {
  readonly action: ReviewRunner["action"]
  readonly projection: CanvasProjection
  readonly run: ReviewRunner["run"]
  readonly runnableIds: ReadonlySet<string>
  readonly snapshotCapturing: boolean
  readonly snapshotFailed: boolean
}): ReactElement {
  const [titleEditing, setTitleEditing] = useState(false)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const overlayContainer = useCritOverlayContainer()
  const rename = action("rename-canvas")

  useHotkeys(
    reviewActionPolicies.flatMap((policy) =>
      action(policy.id).shortcuts.map((hotkey) => ({
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


  return (
    <aside
      aria-label="Review controls"
      className="crit-review-chrome"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="crit-overlay-container">
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
                    aria-keyshortcuts={rename.ariaKeyShortcuts ?? undefined}
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
          {snapshotCapturing
            ? <p role="status">Capturing snapshot.</p>
            : null}
          {snapshotFailed
            ? <p role="alert">Snapshot failed.</p>
            : null}
        </Toolbar.Root>
      </div>
    </aside>
  )
}
