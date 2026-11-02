import {
  type CanvasCommandBatch,
  type CanvasProjection,
  type Frame,
  type FrameId,
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
import { geometryBounds } from "./canvas-group-selection.js"

type DragPointer = {
  readonly handle: ResizeHandlePosition | undefined
  readonly pointerId: number
  readonly startClientX: number
  readonly startClientY: number
}

type CanvasDrag =
  | (DragPointer & {
    readonly mode: "move"
    readonly frames: readonly [Frame, ...Frame[]]
    readonly handle: undefined
  })
  | (DragPointer & {
    readonly mode: "resize"
    readonly frames: readonly [Frame]
    readonly handle: ResizeHandlePosition
  })
  | (DragPointer & {
    readonly mode: "group-resize"
    readonly frames: readonly [Frame, Frame, ...Frame[]]
    readonly handle: ResizeHandlePosition
    readonly startedBounds: Geometry
  })

type GeometryEntry = {
  readonly frameId: FrameId
  readonly geometry: Geometry
}

const snapGeometryToPixels = (geometry: Geometry): Geometry => ({
  x: Math.round(geometry.x),
  y: Math.round(geometry.y),
  width: Math.round(geometry.width),
  height: Math.round(geometry.height)
})

type GeometryOverride = Data.TaggedEnum<{
  readonly dragging: {
    readonly entries: readonly GeometryEntry[]
  }
  readonly submitted: {
    readonly entries: readonly (GeometryEntry & { readonly started: Geometry })[]
  }
}>
const GeometryOverride = Data.taggedEnum<GeometryOverride>()

const dragGeometries = (
  drag: CanvasDrag,
  clientX: number,
  clientY: number,
  zoom: number
): readonly GeometryEntry[] => {
  const deltaX = (clientX - drag.startClientX) / zoom
  const deltaY = (clientY - drag.startClientY) / zoom
  if (drag.mode === "move") {
    return drag.frames.map((frame) => ({
      frameId: frame.frameId,
      geometry: snapGeometryToPixels({
        ...frame.geometry,
        x: frame.geometry.x + deltaX,
        y: frame.geometry.y + deltaY
      })
    }))
  }
  if (drag.mode === "group-resize") {
    const nextBounds = resizeGeometry(
      drag.startedBounds,
      drag.handle,
      deltaX,
      deltaY
    )
    const scaleX = nextBounds.width / drag.startedBounds.width
    const scaleY = nextBounds.height / drag.startedBounds.height
    return drag.frames.map((frame) => ({
      frameId: frame.frameId,
      geometry: snapGeometryToPixels({
        x: nextBounds.x + (frame.geometry.x - drag.startedBounds.x) * scaleX,
        y: nextBounds.y + (frame.geometry.y - drag.startedBounds.y) * scaleY,
        width: frame.geometry.width * scaleX,
        height: frame.geometry.height * scaleY
      })
    }))
  }
  const frame = drag.frames[0]
  return [{
    frameId: frame.frameId,
    geometry: snapGeometryToPixels(
      resizeGeometry(frame.geometry, drag.handle, deltaX, deltaY)
    )
  }]
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
  const currentFrames = framesById(frames)
  const waiting = preview.entries.some((entry) => {
    const frame = currentFrames.get(entry.frameId)
    return frame !== undefined && sameGeometry(frame.geometry, entry.started)
  })
  return waiting ? preview : null
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
  ) => { readonly drag: CanvasDrag; readonly entries: readonly GeometryEntry[] } | null
  finishPointer: (pointerId: number, clientX: number, clientY: number) => void
  cancel: () => void
}

export const useCanvasItemDrag = (args: {
  readonly frames: CanvasProjection["frames"]
  readonly getFrameElement: (frameId: Frame["frameId"]) => HTMLElement | undefined
  readonly getGroupSelectionElement: () => HTMLElement | null
  readonly getSelectedFrameIds: () => ReadonlySet<FrameId>
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
      if ((event.buttons & 1) === 0) {
        opsRef.current?.finishPointer(
          event.pointerId,
          event.clientX,
          event.clientY
        )
        return
      }
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
    for (const entry of next.entries) {
      const element = argsRef.current.getFrameElement(entry.frameId)
      if (element !== undefined) applyItemGeometry(element, entry.geometry)
    }
    const group = argsRef.current.getGroupSelectionElement()
    const first = next.entries[0]
    if (group !== null && first !== undefined && next.entries.length > 1) {
      applyItemGeometry(group, geometryBounds([
        first.geometry,
        ...next.entries.slice(1).map((entry) => entry.geometry)
      ]))
    }
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
    const entries = dragGeometries(
      drag,
      clientX,
      clientY,
      argsRef.current.getZoom()
    )
    paintPreview(GeometryOverride.dragging({
      entries
    }))
    return { drag, entries }
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
    const originalFrames = framesById(next.drag.frames)
    const changed = next.entries.filter((entry) => {
      const frame = originalFrames.get(entry.frameId)
      return frame !== undefined && !sameGeometry(entry.geometry, frame.geometry)
    })
    if (onSubmit === undefined || changed.length === 0) {
      publishPreview(null)
      return
    }
    publishPreview(GeometryOverride.submitted({
      entries: changed.flatMap((entry) => {
        const frame = originalFrames.get(entry.frameId)
        return frame === undefined ? [] : [{ ...entry, started: frame.geometry }]
      })
    }))
    try {
      const commands = changed.flatMap((entry) => {
        const frame = originalFrames.get(entry.frameId)
        return frame === undefined
          ? []
          : [proposeSetFrameGeometry(frame, entry.geometry)]
      })
      const first = commands[0]
      if (first === undefined) {
        publishPreview(null)
        return
      }
      onSubmit([first, ...commands.slice(1)])
    } catch {
      paintPreview(GeometryOverride.dragging({
        entries: next.drag.frames.map((frame) => ({
          frameId: frame.frameId,
          geometry: frame.geometry
        }))
      }))
      publishPreview(null)
    }
  }

  const cancel = () => {
    const preview = previewRef.current
    dragRef.current = null
    detachWindow()
    if (preview !== null) {
      const currentFrames = framesById(argsRef.current.frames)
      paintPreview(GeometryOverride.dragging({
        entries: preview.entries.flatMap((entry) => {
          const frame = currentFrames.get(entry.frameId)
          return frame === undefined
            ? []
            : [{ frameId: frame.frameId, geometry: frame.geometry }]
        })
      }))
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
    mode: "move" | "resize",
    event: ReactPointerEvent<HTMLElement>,
    handle?: ResizeHandlePosition
  ) => {
    if (argsRef.current.onSubmit === undefined) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const selectedFrameIds = argsRef.current.getSelectedFrameIds()
    const moveFrames = mode === "move" && selectedFrameIds.has(frame.frameId)
      ? [
        frame,
        ...argsRef.current.frames.filter((candidate) =>
          candidate.frameId !== frame.frameId && selectedFrameIds.has(candidate.frameId)
        )
      ] as const
      : [frame] as const
    dragRef.current = mode === "move"
      ? {
        frames: moveFrames,
        mode,
        handle: undefined,
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY
      }
      : {
        frames: [frame],
        mode,
        handle: handle ?? "south-east",
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY
      }
    publishPreview(GeometryOverride.dragging({
      entries: moveFrames.map((candidate) => ({
        frameId: candidate.frameId,
        geometry: candidate.geometry
      }))
    }))
    const listeners = windowListenersRef.current
    window.addEventListener("pointermove", listeners.move)
    window.addEventListener("pointerup", listeners.up)
    window.addEventListener("pointercancel", listeners.cancel)
  }

  const beginGroupResize = (
    event: ReactPointerEvent<HTMLElement>,
    handle: ResizeHandlePosition
  ) => {
    if (argsRef.current.onSubmit === undefined) return
    const selectedFrameIds = argsRef.current.getSelectedFrameIds()
    const selectedFrames = argsRef.current.frames.filter((frame) =>
      selectedFrameIds.has(frame.frameId)
    )
    const first = selectedFrames[0]
    const second = selectedFrames[1]
    if (first === undefined || second === undefined) return
    const frames: readonly [Frame, Frame, ...Frame[]] = [
      first,
      second,
      ...selectedFrames.slice(2)
    ]
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dragRef.current = {
      frames,
      mode: "group-resize",
      handle,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startedBounds: geometryBounds([
        first.geometry,
        second.geometry,
        ...selectedFrames.slice(2).map((frame) => frame.geometry)
      ])
    }
    publishPreview(GeometryOverride.dragging({
      entries: frames.map((frame) => ({
        frameId: frame.frameId,
        geometry: frame.geometry
      }))
    }))
    const listeners = windowListenersRef.current
    window.addEventListener("pointermove", listeners.move)
    window.addEventListener("pointerup", listeners.up)
    window.addEventListener("pointercancel", listeners.cancel)
  }

  const geometryFor = (frame: Frame): Geometry => {
    const current = previewRef.current
    return current?.entries.find((entry) => entry.frameId === frame.frameId)?.geometry ??
      frame.geometry
  }

  const update = (event: ReactPointerEvent<HTMLElement>) => {
    applyPointer(event.pointerId, event.clientX, event.clientY)
  }

  const finish = (event: ReactPointerEvent<HTMLElement>) => {
    finishPointer(event.pointerId, event.clientX, event.clientY)
  }

  return { begin, beginGroupResize, cancel, finish, geometryFor, update }
}
