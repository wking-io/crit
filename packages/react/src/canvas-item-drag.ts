import {
  type CanvasCommandBatch,
  type Frame,
  type Geometry,
  proposeSetFrameGeometry
} from "@crit/domain"
import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from "react"

import type { CanvasCamera } from "./canvas-camera.js"

type DragMode = "move" | "resize"

type CanvasDrag = {
  readonly frame: Frame
  readonly mode: DragMode
  readonly pointerId: number
  readonly startClientX: number
  readonly startClientY: number
}

type DragPreview = {
  readonly frameId: Frame["frameId"]
  readonly geometry: Geometry
}

const dragGeometry = (
  drag: CanvasDrag,
  clientX: number,
  clientY: number,
  zoom: number
): Geometry => {
  const deltaX = (clientX - drag.startClientX) / zoom
  const deltaY = (clientY - drag.startClientY) / zoom
  if (drag.mode === "move") {
    return {
      ...drag.frame.geometry,
      x: drag.frame.geometry.x + deltaX,
      y: drag.frame.geometry.y + deltaY
    }
  }
  return {
    ...drag.frame.geometry,
    width: Math.max(1, drag.frame.geometry.width + deltaX),
    height: Math.max(1, drag.frame.geometry.height + deltaY)
  }
}

const sameGeometry = (left: Geometry, right: Geometry): boolean =>
  left.x === right.x &&
  left.y === right.y &&
  left.width === right.width &&
  left.height === right.height

export const useCanvasItemDrag = (args: {
  readonly camera: CanvasCamera
  readonly onSubmit?: (commands: CanvasCommandBatch) => void
}) => {
  const dragRef = useRef<CanvasDrag | null>(null)
  const [preview, setPreview] = useState<DragPreview | null>(null)

  const begin = (
    frame: Frame,
    mode: DragMode,
    event: ReactPointerEvent<HTMLElement>
  ) => {
    if (args.onSubmit === undefined) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dragRef.current = {
      frame,
      mode,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY
    }
    setPreview({ frameId: frame.frameId, geometry: frame.geometry })
  }

  const geometryFor = (frame: Frame): Geometry =>
    preview?.frameId === frame.frameId ? preview.geometry : frame.geometry

  const update = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    setPreview({
      frameId: drag.frame.frameId,
      geometry: dragGeometry(
        drag,
        event.clientX,
        event.clientY,
        args.camera.zoom
      )
    })
  }

  const finish = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    const geometry = dragGeometry(
      drag,
      event.clientX,
      event.clientY,
      args.camera.zoom
    )
    dragRef.current = null
    setPreview(null)
    if (
      args.onSubmit === undefined ||
      sameGeometry(geometry, drag.frame.geometry)
    ) return
    args.onSubmit([proposeSetFrameGeometry(drag.frame, geometry)])
  }

  const cancel = () => {
    dragRef.current = null
    setPreview(null)
  }

  return { begin, cancel, finish, geometryFor, update }
}
