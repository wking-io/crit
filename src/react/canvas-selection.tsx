import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent
} from "react"

import type { CanvasGeometry } from "../core/index.js"
import { NO_HELP_HOTKEY, helpTarget } from "./canvas-help.js"
import { FRAME_CORNER_RADIUS } from "./frame-geometry.js"

const SELECTION_HANDLE_SIZE = 13.95
const SELECTION_HANDLE_INNER_ARC_CENTER = 12.95
const SELECTION_HANDLE_OFFSET = Math.round(
  (SELECTION_HANDLE_INNER_ARC_CENTER - FRAME_CORNER_RADIUS) * 100
) / 100
const SELECTION_HANDLE_ISOLATION_PATH = "M2,13.45c-.42,0-.82-.18-1.11-.49-.29-.31-.43-.74-.39-1.16C1.05,5.81,5.81,1.05,11.81.51h.14c.83,0,1.51.67,1.51,1.5v2.45h-.5c-4.69,0-8.5,3.81-8.5,8.5v.5h-2.45Z"
const SELECTION_HANDLE_PATH = "M11.94,1c.55,0,1.01.44,1.01,1.01v1.95C7.98,3.95,3.95,7.98,3.95,12.95h-1.95c-.59,0-1.05-.51-1-1.1C1.53,6.1,6.1,1.53,11.85,1c.03,0,.06,0,.09,0h0ZM11.94,0c-.06,0-.12,0-.18,0C5.52.58.58,5.52,0,11.76c-.05.56.14,1.12.52,1.54.38.41.92.65,1.48.65h2.95v-1c0-4.41,3.59-8,8-8h1v-2.95c0-1.11-.9-2.01-2.01-2.01h0Z"
const SELECTION_HANDLE_ACCENT_PATH = "M12.95,3.95C7.98,3.95,3.95,7.98,3.95,12.95h-1C2.95,7.43,7.43,2.95,12.95,2.95v1Z"
const SIDE_HANDLE_ISOLATION_PATH = "M2,17.5c-.83,0-1.5-.67-1.5-1.5V2C.5,1.17,1.17.5,2,.5h2.45v17h-2.45Z"
const SIDE_HANDLE_PATH = "M3.95,1v16h-1.95c-.55,0-1-.45-1-1V2c0-.55.45-1,1-1h1.95ZM4.95,0h-2.95C.9,0,0,.9,0,2v14c0,1.1.9,2,2,2h2.95V0h0Z"
const SIDE_HANDLE_ACCENT_PATH = "M2.95,1h1v16h-1Z"

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

const sideHandles = new Set<ResizeHandlePosition>([
  "east",
  "west"
])

const cornerRotation: Readonly<Partial<Record<ResizeHandlePosition, number>>> = {
  "north-west": 0,
  "north-east": 90,
  "south-east": 180,
  "south-west": 270
}

const sideGeometry: Readonly<Partial<Record<ResizeHandlePosition, {
  readonly transform?: string
  readonly viewBox: string
}>>> = {
  west: { viewBox: "0 0 4.95 18" },
  east: { transform: "translate(4.95 18) rotate(180)", viewBox: "0 0 4.95 18" }
}

export function CanvasSelection({
  handles = allHandles,
  handleStyle,
  ink,
  label,
  onResize,
  shell = ink,
  zoom
}: {
  readonly handles?: ReadonlyArray<ResizeHandlePosition>
  readonly handleStyle?: "corners" | "sides"
  readonly ink: string
  readonly label: string
  readonly onResize: (
    event: ReactPointerEvent,
    handle: ResizeHandlePosition
  ) => void
  readonly shell?: string
  readonly zoom: number
}) {
  const resolvedHandleStyle = handleStyle ?? (handles === allHandles ? "corners" : "sides")
  const visibleHandles = resolvedHandleStyle === "sides" ? sideHandles : cornerHandles
  return (
    <div
      aria-label={`Selected ${label}`}
      className="crit-selection"
      data-handle-style={resolvedHandleStyle}
      style={{
        "--selection-ink": ink,
        "--selection-handle-accent": shell,
        "--selection-handle-size": SELECTION_HANDLE_SIZE,
        "--selection-handle-offset": SELECTION_HANDLE_OFFSET,
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
          data-visible-handle={visibleHandles.has(handle) || undefined}
          key={handle}
          onPointerDown={(event) => onResize(event, handle)}
          type="button"
        >
          {resolvedHandleStyle === "corners" && cornerHandles.has(handle) ? (
            <svg
              aria-hidden="true"
              className="crit-selection__handle-shape"
              style={{ transform: `rotate(${cornerRotation[handle] ?? 0}deg)` }}
              viewBox="0 0 13.95 13.95"
            >
              <path className="crit-selection__handle-isolation" d={SELECTION_HANDLE_ISOLATION_PATH} />
              <path d={SELECTION_HANDLE_PATH} />
              <path className="crit-selection__handle-accent" d={SELECTION_HANDLE_ACCENT_PATH} />
            </svg>
          ) : resolvedHandleStyle === "sides" && sideHandles.has(handle) ? (
            <svg
              aria-hidden="true"
              className="crit-selection__side-handle-shape"
              viewBox={sideGeometry[handle]?.viewBox}
            >
              <g transform={sideGeometry[handle]?.transform}>
                <path className="crit-selection__handle-isolation" d={SIDE_HANDLE_ISOLATION_PATH} />
                <path d={SIDE_HANDLE_PATH} />
                <path className="crit-selection__handle-accent" d={SIDE_HANDLE_ACCENT_PATH} />
              </g>
            </svg>
          ) : null}
        </button>
      ))}
    </div>
  )
}
