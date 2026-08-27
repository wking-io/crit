import { Button } from "@base-ui/react/button"
import type { Geometry } from "@crit/domain"
import type { PointerEvent as ReactPointerEvent, ReactElement } from "react"

import { cssVariableStyle } from "./css-variable-style.js"
import { reviewInformationalHelpTarget } from "./review-help.js"

const SELECTION_HANDLE_SIZE = 13.95
const SELECTION_HANDLE_OFFSET = 4.95
const SELECTION_HANDLE_ISOLATION_PATH =
  "M2,13.45c-.42,0-.82-.18-1.11-.49-.29-.31-.43-.74-.39-1.16C1.05,5.81,5.81,1.05,11.81.51h.14c.83,0,1.51.67,1.51,1.5v2.45h-.5c-4.69,0-8.5,3.81-8.5,8.5v.5h-2.45Z"
const SELECTION_HANDLE_PATH =
  "M11.94,1c.55,0,1.01.44,1.01,1.01v1.95C7.98,3.95,3.95,7.98,3.95,12.95h-1.95c-.59,0-1.05-.51-1-1.1C1.53,6.1,6.1,1.53,11.85,1c.03,0,.06,0,.09,0h0ZM11.94,0c-.06,0-.12,0-.18,0C5.52.58.58,5.52,0,11.76c-.05.56.14,1.12.52,1.54.38.41.92.65,1.48.65h2.95v-1c0-4.41,3.59-8,8-8h1v-2.95c0-1.11-.9-2.01-2.01-2.01h0Z"
const SELECTION_HANDLE_ACCENT_PATH =
  "M12.95,3.95C7.98,3.95,3.95,7.98,3.95,12.95h-1C2.95,7.43,7.43,2.95,12.95,2.95v1Z"

export type ResizeHandlePosition =
  | "north-west"
  | "north-east"
  | "south-east"
  | "south-west"

const cornerHandles = [
  "north-west",
  "north-east",
  "south-east",
  "south-west"
] as const satisfies readonly ResizeHandlePosition[]

const SELECTION_HANDLE_ROTATION = {
  "north-west": 0,
  "north-east": 90,
  "south-east": 180,
  "south-west": 270
} as const satisfies Record<ResizeHandlePosition, number>

export const resizeGeometry = (
  start: Geometry,
  handle: ResizeHandlePosition,
  deltaX: number,
  deltaY: number,
  minimumWidth = 180,
  minimumHeight = 120
): Geometry => {
  const fromWest = handle === "north-west" || handle === "south-west"
  const fromEast = handle === "north-east" || handle === "south-east"
  const fromNorth = handle === "north-west" || handle === "north-east"
  const fromSouth = handle === "south-west" || handle === "south-east"
  const width = fromWest
    ? Math.max(minimumWidth, start.width - deltaX)
    : fromEast
      ? Math.max(minimumWidth, start.width + deltaX)
      : start.width
  const height = fromNorth
    ? Math.max(minimumHeight, start.height - deltaY)
    : fromSouth
      ? Math.max(minimumHeight, start.height + deltaY)
      : start.height
  return {
    x: fromWest ? start.x + start.width - width : start.x,
    y: fromNorth ? start.y + start.height - height : start.y,
    width,
    height
  }
}

export function ReviewSelectionChrome({
  ink,
  label,
  onResize,
  shell = ink,
  uiScale
}: {
  readonly ink: string
  readonly label: string
  readonly onResize?:
    | ((
      event: ReactPointerEvent<HTMLElement>,
      handle: ResizeHandlePosition
    ) => void)
    | undefined
  readonly shell?: string
  readonly uiScale: number
}): ReactElement {
  return (
    <div
      aria-label={`Selected ${label}`}
      className="crit-selection"
      data-handle-style="corners"
      style={cssVariableStyle({
        "--selection-ink": ink,
        "--selection-handle-accent": shell,
        "--selection-handle-size": SELECTION_HANDLE_SIZE,
        "--selection-handle-offset": SELECTION_HANDLE_OFFSET,
        "--selection-ui": uiScale
      })}
    >
      {onResize === undefined
        ? null
        : cornerHandles.map((handle) => (
          <Button
            aria-label={`Resize ${label} from ${handle}`}
            className="crit-selection__handle"
            data-resize-handle={handle}
            data-visible-handle=""
            key={handle}
            {...reviewInformationalHelpTarget({
              name: "Resize",
              description: `Drag to resize the ${label} in this direction.`
            })}
            onPointerDown={(event) => {
              event.stopPropagation()
              onResize(event, handle)
            }}
            type="button"
          >
            <svg
              aria-hidden="true"
              className="crit-selection__handle-shape"
              style={{
                transform: `rotate(${SELECTION_HANDLE_ROTATION[handle]}deg)`
              }}
              viewBox="0 0 13.95 13.95"
            >
              <path
                className="crit-selection__handle-isolation"
                d={SELECTION_HANDLE_ISOLATION_PATH}
              />
              <path d={SELECTION_HANDLE_PATH} />
              <path
                className="crit-selection__handle-accent"
                d={SELECTION_HANDLE_ACCENT_PATH}
              />
            </svg>
          </Button>
        ))}
    </div>
  )
}
