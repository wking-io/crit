import { Menu } from "@base-ui/react/menu"
import type { ReactElement } from "react"

import type { CanvasAlignment } from "./canvas-arrangement.js"
import { Glyph, type GlyphName } from "./glyph.js"
import { useCritOverlayContainer } from "./overlay-container.js"
import type { ReviewActionId } from "./review-actions.js"
import { reviewActionHelpTarget, reviewInformationalHelpTarget } from "./review-help.js"
import { useOptionalReviewRunner } from "./review-runner.js"

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

export function CanvasArrangementMenu(): ReactElement | null {
  const overlayContainer = useCritOverlayContainer()
  const runner = useOptionalReviewRunner()
  if (runner === null) return null
  const { action, run } = runner
  const runnableIds = runner.runnableIds()
  const arrangeGrid = action("arrange-grid")
  const alignmentAvailable = alignmentOptions.some((option) => runnableIds.has(option.id))
  return (
    <Menu.Root
      modal={false}
    >
      <Menu.Trigger
        aria-haspopup="menu"
        aria-label={arrangementTrigger.name}
        className="crit-icon-button"
        disabled={!alignmentAvailable}
        {...reviewInformationalHelpTarget(arrangementTrigger)}
      >
        <Glyph name="arrangement" />
      </Menu.Trigger>
      <Menu.Portal container={overlayContainer}>
        <Menu.Positioner
          side="top"
          align="start"
          sideOffset={8}
          collisionAvoidance={{ side: "none", align: "shift" }}
          className="crit-toolbar-overlay-positioner crit-arrangement-positioner"
        >
          <Menu.Popup
            aria-label="Align and distribute"
            className="crit-arrangement-popover"
          >
            <div className="crit-arrangement-popover__grid">
              {alignmentOptions.map((option) => {
                const policy = action(option.id)
                return (
                  <Menu.Item
                    aria-keyshortcuts={policy.ariaKeyShortcuts ?? undefined}
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
                const policy = action(option.id)
                return (
                  <Menu.Item
                    aria-keyshortcuts={policy.ariaKeyShortcuts ?? undefined}
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
                aria-keyshortcuts={arrangeGrid.ariaKeyShortcuts ?? undefined}
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
  )
}
