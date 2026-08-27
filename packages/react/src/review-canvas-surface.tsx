import { type ReactElement, useRef } from "react"

import {
  CritContextActions,
  ReviewMenuItem
} from "./canvas-context-menu.js"
import {
  type CanvasCamera
} from "./canvas-camera.js"
import { DEFAULT_NEW_FRAME_SIZE } from "./frame-breakpoints.js"
import { reviewActionPolicy } from "./review-actions.js"
import { useOptionalReviewRunner } from "./review-runner.js"

export const canvasWorldPoint = (
  root: HTMLElement,
  camera: CanvasCamera,
  clientX: number,
  clientY: number
) => {
  const rect = root.getBoundingClientRect()
  return {
    x: (clientX - rect.left - camera.x) / camera.zoom,
    y: (clientY - rect.top - camera.y) / camera.zoom
  }
}

export const canvasCenterPlacement = (
  root: HTMLElement,
  camera: CanvasCamera
) => {
  const rect = root.getBoundingClientRect()
  return {
    x: (rect.width / 2 - camera.x) / camera.zoom -
      DEFAULT_NEW_FRAME_SIZE.width / 2,
    y: (rect.height / 2 - camera.y) / camera.zoom -
      DEFAULT_NEW_FRAME_SIZE.height / 2
  }
}

export function ReviewCanvasSurface({
  camera,
  children,
  rootRef
}: {
  readonly camera: CanvasCamera
  readonly children: ReactElement
  readonly rootRef: { readonly current: HTMLElement | null }
}): ReactElement {
  const runner = useOptionalReviewRunner()
  const actionPointRef = useRef<{ readonly x: number; readonly y: number } | null>(
    null
  )
  if (runner === null) return children

  const addFrame = reviewActionPolicy("add-frame")
  const zoomToFit = reviewActionPolicy("zoom-to-fit")
  return (
    <CritContextActions
      ariaLabel="Canvas actions"
      items={[
        ReviewMenuItem.action({
          policy: addFrame,
          onSelect: () => {
            const root = rootRef.current
            if (root === null) return
            runner.requestAddFrame(
              actionPointRef.current ?? canvasCenterPlacement(root, camera)
            )
          }
        }),
        ReviewMenuItem.action({
          policy: zoomToFit,
          disabled: !runner.runnableIds.has("zoom-to-fit"),
          onSelect: () => runner.run("zoom-to-fit")
        })
      ]}
      onOpenChange={(open, details) => {
        if (!open) return
        const event = details.event
        const target = event.target
        if (
          target instanceof Element &&
          target.closest(".crit-frame") !== null
        ) {
          details.cancel()
          return
        }
        const root = rootRef.current
        if (root === null || !(event instanceof MouseEvent)) {
          actionPointRef.current = null
          return
        }
        actionPointRef.current = canvasWorldPoint(
          root,
          camera,
          event.clientX,
          event.clientY
        )
      }}
    >
      {children}
    </CritContextActions>
  )
}
