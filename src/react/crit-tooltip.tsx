import { Tooltip } from "@base-ui/react/tooltip"
import type { CSSProperties } from "react"

export type CritTooltipHandle = ReturnType<typeof Tooltip.createHandle<string>>

export function CritTooltipPopup({
  handle,
  ink
}: {
  readonly handle: CritTooltipHandle
  readonly ink: string
}) {
  return (
    <Tooltip.Root handle={handle}>
      {({ payload }) => (
        <Tooltip.Portal>
          <Tooltip.Positioner
            className="crit-tooltip__positioner"
            side="top"
            sideOffset={8}
            style={{ "--tooltip-ink": ink } as CSSProperties}
          >
            <Tooltip.Popup className="crit-tooltip__popup">
              <Tooltip.Arrow className="crit-tooltip__arrow">
                <svg width="8" height="4" viewBox="0 0 8 4" aria-hidden="true">
                  <path d="M0 0L4 4L8 0Z" />
                </svg>
              </Tooltip.Arrow>
              <Tooltip.Viewport className="crit-tooltip__viewport">
                {payload}
              </Tooltip.Viewport>
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      )}
    </Tooltip.Root>
  )
}
