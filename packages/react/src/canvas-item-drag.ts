import {
  type CanvasCommandBatch,
  type Frame,
  type Geometry,
  type Note,
  proposeSetFrameGeometry,
  proposeSetNoteGeometry
} from "@crit/domain"
import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from "react"

import type { CanvasCamera } from "./canvas-camera.js"

type CanvasItem = Frame | Note
type DragMode = "move" | "resize"

type CanvasDrag = {
  readonly item: CanvasItem
  readonly mode: DragMode
  readonly pointerId: number
  readonly startClientX: number
  readonly startClientY: number
}

type DragPreview = {
  readonly itemKey: string
  readonly geometry: Geometry
}

const itemKey = (item: CanvasItem): string =>
  "frameId" in item ? `frame:${item.frameId}` : `note:${item.noteId}`

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
      ...drag.item.geometry,
      x: drag.item.geometry.x + deltaX,
      y: drag.item.geometry.y + deltaY
    }
  }
  return {
    ...drag.item.geometry,
    width: Math.max(1, drag.item.geometry.width + deltaX),
    height: Math.max(1, drag.item.geometry.height + deltaY)
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
    item: CanvasItem,
    mode: DragMode,
    event: ReactPointerEvent<HTMLElement>
  ) => {
    if (args.onSubmit === undefined) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dragRef.current = {
      item,
      mode,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY
    }
    setPreview({ itemKey: itemKey(item), geometry: item.geometry })
  }

  const geometryFor = (item: CanvasItem): Geometry =>
    preview?.itemKey === itemKey(item) ? preview.geometry : item.geometry

  const update = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    setPreview({
      itemKey: itemKey(drag.item),
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
      sameGeometry(geometry, drag.item.geometry)
    ) return
    args.onSubmit([
      "frameId" in drag.item
        ? proposeSetFrameGeometry(drag.item, geometry)
        : proposeSetNoteGeometry(drag.item, geometry)
    ])
  }

  const cancel = () => {
    dragRef.current = null
    setPreview(null)
  }

  return { begin, cancel, finish, geometryFor, update }
}
