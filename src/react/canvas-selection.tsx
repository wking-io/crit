import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent
} from "react"

import type { CanvasGeometry } from "../core/index.js"
import { NO_HELP_HOTKEY, helpTarget } from "./canvas-help.js"

export type ResizeHandlePosition =
  | "north-west"
  | "north"
  | "north-east"
  | "east"
  | "south-east"
  | "south"
  | "south-west"
  | "west"

export const resizeGeometry = (
  start: CanvasGeometry,
  handle: ResizeHandlePosition,
  deltaX: number,
  deltaY: number,
  minimumWidth = 180,
  minimumHeight = 120
): CanvasGeometry => {
  const fromWest = handle === "north-west" || handle === "west" || handle === "south-west"
  const fromEast = handle === "north-east" || handle === "east" || handle === "south-east"
  const fromNorth = handle === "north-west" || handle === "north" || handle === "north-east"
  const fromSouth = handle === "south-west" || handle === "south" || handle === "south-east"
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

const allHandles: ReadonlyArray<ResizeHandlePosition> = [
  "north-west",
  "north",
  "north-east",
  "east",
  "south-east",
  "south",
  "south-west",
  "west"
]

const cornerHandles = new Set<ResizeHandlePosition>([
  "north-west",
  "north-east",
  "south-east",
  "south-west"
])

export function CanvasSelection({
  handles = allHandles,
  ink,
  label,
  onResize,
  zoom
}: {
  readonly handles?: ReadonlyArray<ResizeHandlePosition>
  readonly ink: string
  readonly label: string
  readonly onResize: (
    event: ReactPointerEvent,
    handle: ResizeHandlePosition
  ) => void
  readonly zoom: number
}) {
  return (
    <div
      aria-label={`Selected ${label}`}
      className="crit-selection"
      style={{
        "--selection-ink": ink,
        "--selection-ui": 1 / zoom
      } as CSSProperties}
    >
      {handles.map((handle) => (
        <button
          aria-label={`Resize ${label} from ${handle}`}
          className="crit-selection__handle"
          {...helpTarget({
            name: "Resize",
            hotkey: NO_HELP_HOTKEY,
            description: `Drag to resize the ${label} in this direction.`
          })}
          data-resize-handle={handle}
          data-visible-handle={
            (handles === allHandles ? cornerHandles.has(handle) : true) || undefined
          }
          key={handle}
          onPointerDown={(event) => onResize(event, handle)}
          type="button"
        />
      ))}
    </div>
  )
}
