import {
  type CanvasCommandBatch,
  type CanvasProjection,
  type Frame,
  type Geometry,
  proposeSetFrameGeometry
} from "@crit/domain"
import { Data } from "effect"
import {
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from "react"

import { framesById } from "./projection-index.js"
import {
  resizeGeometry,
  type ResizeHandlePosition
} from "./review-selection-chrome.js"

type DragMode = "move" | "resize"

type CanvasDrag = {
  readonly frame: Frame
  readonly mode: DragMode
  readonly handle: ResizeHandlePosition | undefined
  readonly pointerId: number
  readonly startClientX: number
  readonly startClientY: number
}

type GeometryOverride = Data.TaggedEnum<{
  readonly dragging: {
    readonly frameId: Frame["frameId"]
    readonly geometry: Geometry
  }
  readonly submitted: {
    readonly frameId: Frame["frameId"]
    readonly geometry: Geometry
    readonly started: Geometry
  }
}>
const GeometryOverride = Data.taggedEnum<GeometryOverride>()

const dragGeometry = (
  drag: CanvasDrag,
  clientX: number,
  clientY: number,
  zoom: number
): Geometry => {
  const deltaX = (clientX - drag.startClientX) / zoom
  const deltaY = (clientY - drag.startClientY) / zoom
  if (drag.mode === "move" || drag.handle === undefined) {
    return {
      ...drag.frame.geometry,
      x: drag.frame.geometry.x + deltaX,
      y: drag.frame.geometry.y + deltaY
    }
  }
  return resizeGeometry(drag.frame.geometry, drag.handle, deltaX, deltaY)
}

const sameGeometry = (left: Geometry, right: Geometry): boolean =>
  left.x === right.x &&
  left.y === right.y &&
  left.width === right.width &&
  left.height === right.height

const releasedOverride = (
  frames: CanvasProjection["frames"],
  preview: GeometryOverride
): GeometryOverride | null => {
  if (!GeometryOverride.$is("submitted")(preview)) return preview
  const frame = framesById(frames).get(preview.frameId)
  if (frame === undefined) return null
  if (
    sameGeometry(frame.geometry, preview.geometry) ||
    !sameGeometry(frame.geometry, preview.started)
  ) return null
  return preview
}

export const applyItemGeometry = (
  element: HTMLElement,
  geometry: Geometry
): void => {
  element.style.left = `${geometry.x}px`
  element.style.top = `${geometry.y}px`
  element.style.width = `${geometry.width}px`
  element.style.height = `${geometry.height}px`
}

type DragOps = {
  applyPointer: (
    pointerId: number,
    clientX: number,
    clientY: number
  ) => { readonly drag: CanvasDrag; readonly geometry: Geometry } | null
  finishPointer: (pointerId: number, clientX: number, clientY: number) => void
  cancel: () => void
}

export const useCanvasItemDrag = (args: {
  readonly frames: CanvasProjection["frames"]
  readonly getFrameElement: (frameId: Frame["frameId"]) => HTMLElement | undefined
  readonly getZoom: () => number
  readonly onSubmit?: (commands: CanvasCommandBatch) => void
}) => {
  const dragRef = useRef<CanvasDrag | null>(null)
  const previewRef = useRef<GeometryOverride | null>(null)
  const [preview, setPreview] = useState<GeometryOverride | null>(null)
  const argsRef = useRef(args)
  argsRef.current = args
  const opsRef = useRef<DragOps | null>(null)
  const windowListenersRef = useRef({
    move: (event: PointerEvent) => {
      opsRef.current?.applyPointer(event.pointerId, event.clientX, event.clientY)
    },
    up: (event: PointerEvent) => {
      opsRef.current?.finishPointer(event.pointerId, event.clientX, event.clientY)
    },
    cancel: (event: PointerEvent) => {
      if (dragRef.current?.pointerId !== event.pointerId) return
      opsRef.current?.cancel()
    }
  })

  const publishPreview = (next: GeometryOverride | null) => {
    previewRef.current = next
    setPreview(next)
  }

  const paintPreview = (next: GeometryOverride) => {
    previewRef.current = next
    const element = argsRef.current.getFrameElement(next.frameId)
    if (element !== undefined) applyItemGeometry(element, next.geometry)
  }

  const detachWindow = () => {
    const listeners = windowListenersRef.current
    window.removeEventListener("pointermove", listeners.move)
    window.removeEventListener("pointerup", listeners.up)
    window.removeEventListener("pointercancel", listeners.cancel)
  }

  const applyPointer = (
    pointerId: number,
    clientX: number,
    clientY: number
  ) => {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== pointerId) return null
    const geometry = dragGeometry(
      drag,
      clientX,
      clientY,
      argsRef.current.getZoom()
    )
    paintPreview(GeometryOverride.dragging({
      frameId: drag.frame.frameId,
      geometry
    }))
    return { drag, geometry }
  }

  const finishPointer = (
    pointerId: number,
    clientX: number,
    clientY: number
  ) => {
    const next = applyPointer(pointerId, clientX, clientY)
    if (next === null) return
    dragRef.current = null
    detachWindow()
    const onSubmit = argsRef.current.onSubmit
    if (
      onSubmit === undefined ||
      sameGeometry(next.geometry, next.drag.frame.geometry)
    ) {
      publishPreview(null)
      return
    }
    publishPreview(GeometryOverride.submitted({
      frameId: next.drag.frame.frameId,
      geometry: next.geometry,
      started: next.drag.frame.geometry
    }))
    try {
      onSubmit([proposeSetFrameGeometry(next.drag.frame, next.geometry)])
    } catch {
      paintPreview(GeometryOverride.dragging({
        frameId: next.drag.frame.frameId,
        geometry: next.drag.frame.geometry
      }))
      publishPreview(null)
    }
  }

  const cancel = () => {
    const preview = previewRef.current
    dragRef.current = null
    detachWindow()
    if (preview !== null) {
      const frame = framesById(argsRef.current.frames).get(preview.frameId)
      if (frame !== undefined) {
        paintPreview(GeometryOverride.dragging({
          frameId: preview.frameId,
          geometry: frame.geometry
        }))
      }
    }
    publishPreview(null)
  }

  opsRef.current = { applyPointer, cancel, finishPointer }

  useLayoutEffect(() => {
    if (preview === null) {
      previewRef.current = null
      return
    }
    const next = releasedOverride(args.frames, preview)
    if (next !== preview) publishPreview(next)
  }, [args.frames, preview])

  const begin = (
    frame: Frame,
    mode: DragMode,
    event: ReactPointerEvent<HTMLElement>,
    handle?: ResizeHandlePosition
  ) => {
    if (argsRef.current.onSubmit === undefined) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dragRef.current = {
      frame,
      mode,
      handle,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY
    }
    publishPreview(GeometryOverride.dragging({
      frameId: frame.frameId,
      geometry: frame.geometry
    }))
    const listeners = windowListenersRef.current
    window.addEventListener("pointermove", listeners.move)
    window.addEventListener("pointerup", listeners.up)
    window.addEventListener("pointercancel", listeners.cancel)
  }

  const geometryFor = (frame: Frame): Geometry => {
    const current = previewRef.current
    return current !== null && current.frameId === frame.frameId
      ? current.geometry
      : frame.geometry
  }

  const update = (event: ReactPointerEvent<HTMLElement>) => {
    applyPointer(event.pointerId, event.clientX, event.clientY)
  }

  const finish = (event: ReactPointerEvent<HTMLElement>) => {
    finishPointer(event.pointerId, event.clientX, event.clientY)
  }

  return { begin, cancel, finish, geometryFor, update }
}
