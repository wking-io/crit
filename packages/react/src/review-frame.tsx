import type { Frame } from "@crit/domain"
import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  ReactElement,
  ReactNode
} from "react"

import { cssVariableStyle } from "./css-variable-style.js"
import { frameStatus } from "./frame-status-chrome.js"

const SELECTION_HANDLE_SIZE = 13.95
const SELECTION_HANDLE_OFFSET = 4.95
const SELECTION_HANDLE_ISOLATION_PATH =
  "M2,13.45c-.42,0-.82-.18-1.11-.49-.29-.31-.43-.74-.39-1.16C1.05,5.81,5.81,1.05,11.81.51h.14c.83,0,1.51.67,1.51,1.5v2.45h-.5c-4.69,0-8.5,3.81-8.5,8.5v.5h-2.45Z"
const SELECTION_HANDLE_PATH =
  "M11.94,1c.55,0,1.01.44,1.01,1.01v1.95C7.98,3.95,3.95,7.98,3.95,12.95h-1.95c-.59,0-1.05-.51-1-1.1C1.53,6.1,6.1,1.53,11.85,1c.03,0,.06,0,.09,0h0ZM11.94,0c-.06,0-.12,0-.18,0C5.52.58.58,5.52,0,11.76c-.05.56.14,1.12.52,1.54.38.41.92.65,1.48.65h2.95v-1c0-4.41,3.59-8,8-8h1v-2.95c0-1.11-.9-2.01-2.01-2.01h0Z"
const SELECTION_HANDLE_ACCENT_PATH =
  "M12.95,3.95C7.98,3.95,3.95,7.98,3.95,12.95h-1C2.95,7.43,7.43,2.95,12.95,2.95v1Z"

export const canvasUiScale = (zoom: number): number =>
  1 / Math.max(0.05, zoom)

const itemStyle = (
  geometry: Frame["geometry"],
  zIndex: number
): CSSProperties => ({
  height: geometry.height,
  left: geometry.x,
  position: "absolute",
  top: geometry.y,
  width: geometry.width,
  zIndex
})

export function ReviewFrame({
  capture,
  children,
  frame,
  geometry,
  onMove,
  onResize,
  onSelect,
  selected,
  selectedLabel,
  uiScale,
  zIndex,
  frameRef
}: {
  readonly capture: boolean
  readonly children: ReactNode
  readonly frame: Frame
  readonly frameRef: (element: HTMLDivElement | null) => void
  readonly geometry: Frame["geometry"]
  readonly onMove: (event: ReactPointerEvent<HTMLDivElement>) => void
  readonly onResize?: ((event: ReactPointerEvent<HTMLElement>) => void) | undefined
  readonly onSelect: (event: ReactPointerEvent<HTMLDivElement>) => void
  readonly selected: boolean
  readonly selectedLabel: true | undefined
  readonly uiScale: number
  readonly zIndex: number
}): ReactElement {
  const status = frameStatus(frame.status)
  return (
    <div
      ref={frameRef}
      aria-label={frame.title}
      aria-selected={selectedLabel}
      className="crit-frame"
      data-frame-id={frame.frameId}
      data-frame-status={frame.status}
      data-review-status={frame.status}
      data-selected={selected || undefined}
      role="option"
      style={cssVariableStyle({
        ...itemStyle(geometry, zIndex),
        "--crit-ui": uiScale,
        "--frame-ink": status.ink,
        "--frame-shell": status.shell,
        "--frame-stroke": status.stroke
      })}
      onPointerDown={(event) => {
        onSelect(event)
        onMove(event)
      }}
    >
      <div className="crit-frame__surface">
        <header className="crit-frame__chrome">
          <div className="crit-frame__identity">
            <span aria-hidden className="crit-frame__mark" />
            <span className="crit-frame__title-mask" title={frame.title}>
              <span className="crit-frame__title-label">
                <span className="crit-frame__title-track">
                  <strong>{frame.title}</strong>
                  <strong>{status.label}</strong>
                </span>
              </span>
            </span>
          </div>
        </header>
        <div className="crit-frame__viewport">
          {children}
          {capture
            ? (
              <div
                aria-hidden
                data-crit-frame-capture=""
                style={{
                  inset: 0,
                  pointerEvents: "auto",
                  position: "absolute"
                }}
              />
            )
            : null}
        </div>
      </div>
      {selected
        ? (
          <div
            aria-label={`Selected ${frame.title}`}
            className="crit-selection"
            data-handle-style="corners"
            style={cssVariableStyle({
              "--selection-ink": status.ink,
              "--selection-handle-accent": status.shell,
              "--selection-handle-size": SELECTION_HANDLE_SIZE,
              "--selection-handle-offset": SELECTION_HANDLE_OFFSET,
              "--selection-ui": uiScale
            })}
          >
            {onResize === undefined
              ? null
              : (
                <span
                  aria-label={`Resize ${frame.title}`}
                  className="crit-selection__handle"
                  data-resize-handle="south-east"
                  data-visible-handle=""
                  onPointerDown={(event) => {
                    event.stopPropagation()
                    onResize(event)
                  }}
                >
                  <svg
                    aria-hidden="true"
                    className="crit-selection__handle-shape"
                    style={{ transform: "rotate(180deg)" }}
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
                </span>
              )}
          </div>
        )
        : null}
    </div>
  )
}
