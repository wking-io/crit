import type { Frame, Geometry } from "@crit/domain"
import { type PointerEvent as ReactPointerEvent, type ReactElement } from "react"

import { useLiveCanvasSelection } from "./canvas-selection-store.js"
import { CanvasArrangementMenu } from "./canvas-arrangement-menu.js"
import { CanvasSelection } from "./canvas-selection.js"
import { framesById } from "./projection-index.js"
import { frameStatus } from "./frame-status-chrome.js"
import {
  ReviewSelectionChrome,
  type ResizeHandlePosition
} from "./review-selection-chrome.js"

export const geometryBounds = (
  geometries: readonly [Geometry, ...Geometry[]]
): Geometry => {
  let left = geometries[0].x
  let top = geometries[0].y
  let right = left + geometries[0].width
  let bottom = top + geometries[0].height
  for (const geometry of geometries.slice(1)) {
    left = Math.min(left, geometry.x)
    top = Math.min(top, geometry.y)
    right = Math.max(right, geometry.x + geometry.width)
    bottom = Math.max(bottom, geometry.y + geometry.height)
  }
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export function CanvasGroupSelection({
  allowsMutation,
  frames,
  geometryFor,
  groupRef,
  onMove,
  onResize,
  uiScale
}: {
  readonly allowsMutation: boolean
  readonly frames: readonly Frame[]
  readonly geometryFor: (frame: Frame) => Geometry
  readonly groupRef: (element: HTMLDivElement | null) => void
  readonly onMove: (frame: Frame, event: ReactPointerEvent<HTMLDivElement>) => void
  readonly onResize: (
    event: ReactPointerEvent<HTMLElement>,
    handle: ResizeHandlePosition
  ) => void
  readonly uiScale: number
}): ReactElement | null {
  const selection = useLiveCanvasSelection(CanvasSelection.make([]))
  if (selection.length < 2) return null
  const frameIndex = framesById(frames)
  const selectedFrames = selection.flatMap((item) => {
    const frame = frameIndex.get(item.frameId)
    return frame === undefined ? [] : [frame]
  })
  const first = selectedFrames[0]
  const second = selectedFrames[1]
  if (first === undefined || second === undefined) return null
  const geometry = geometryBounds([
    geometryFor(first),
    geometryFor(second),
    ...selectedFrames.slice(2).map(geometryFor)
  ])
  const status = frameStatus(first.status)
  return (
    <div
      ref={groupRef}
      className="crit-group-selection"
      style={{
        borderRadius: `${8 * uiScale}px`,
        height: `${geometry.height}px`,
        left: `${geometry.x}px`,
        top: `${geometry.y}px`,
        width: `${geometry.width}px`
      }}
      onPointerDown={(event) => {
        event.stopPropagation()
        onMove(first, event)
      }}
    >
      <ReviewSelectionChrome
        ink={status.ink}
        label={`${selectedFrames.length} Frames`}
        onResize={onResize}
        shell={status.shell}
        uiScale={uiScale}
      />
      {allowsMutation ? (
        <div
          className="crit-group-selection__tools"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          style={{ marginBottom: `${16 * uiScale}px`, transform: `scale(${uiScale})` }}
        >
          <CanvasArrangementMenu />
        </div>
      ) : null}
    </div>
  )
}
