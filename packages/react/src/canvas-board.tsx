import {
  type CanvasCommandBatch,
  type CanvasItemRef,
  type CanvasProjection,
  type Frame,
  type Geometry,
  type Note,
  type ReviewStatus,
  proposeSetFrameGeometry,
  proposeSetNoteGeometry
} from "@crit/domain"
import {
  connectCanvasInput,
  type FrameInputIntent
} from "@crit/frame-bridge"
import { Match } from "effect"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactElement
} from "react"

import {
  applyCanvasCameraIntent,
  type CanvasCamera,
  canvasCameraStyle
} from "./canvas-camera.js"
import { CommentPin } from "./canvas-comment-pin.js"
import {
  CanvasSelection,
  type CanvasSelectionCommand
} from "./canvas-selection.js"
import {
  FrameRenderer,
  type FrameRepresentationResolver
} from "./frame-renderer.js"
import { framesById, notesById } from "./projection-index.js"
import { ReviewChrome } from "./review-chrome.js"
import type { ReviewClientEffect } from "./review-actions.js"
import { applyReviewEffect } from "./review-effects.js"

export interface CanvasBoardProps {
  readonly projection: CanvasProjection
  readonly resolver: FrameRepresentationResolver
  readonly camera: CanvasCamera
  readonly onCameraChange: (camera: CanvasCamera) => void
  readonly selection: CanvasSelection
  readonly onSelectionChange: (selection: CanvasSelection) => void
  readonly onSubmit?: (commands: CanvasCommandBatch) => void
  readonly onEffect?: (effect: ReviewClientEffect) => void
  readonly className?: string
}

const ariaSelected = (
  selection: CanvasSelection,
  item: CanvasItemRef
): true | undefined =>
  CanvasSelection.has(selection, item) ? true : undefined

const itemStyle = (
  geometry: Frame["geometry"] | Note["geometry"],
  zIndex: number
): CSSProperties => ({
  height: geometry.height,
  left: geometry.x,
  position: "absolute",
  top: geometry.y,
  width: geometry.width,
  zIndex
})

type DragMode = "move" | "resize"

type CanvasItem = Frame | Note

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

const canvasItemKey = (item: CanvasItem): string =>
  "frameId" in item ? `frame:${item.frameId}` : `note:${item.noteId}`

const dragGeometry = (
  drag: CanvasDrag,
  clientX: number,
  clientY: number,
  zoom: number
): Geometry => {
  const deltaX = (clientX - drag.startClientX) / zoom
  const deltaY = (clientY - drag.startClientY) / zoom
  return drag.mode === "move"
    ? {
      ...drag.item.geometry,
      x: drag.item.geometry.x + deltaX,
      y: drag.item.geometry.y + deltaY
    }
    : {
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

const isAdditiveSelection = (
  event: Pick<ReactPointerEvent, "ctrlKey" | "metaKey" | "shiftKey">
): boolean => event.ctrlKey || event.metaKey || event.shiftKey

const reviewStatusLabel = {
  "in-progress": "In progress",
  "ready-for-review": "Ready for review",
  approved: "Approved",
  "changes-requested": "Changes requested"
} satisfies Record<ReviewStatus, string>

export function CanvasBoard({
  camera,
  className,
  onCameraChange,
  onEffect,
  onSelectionChange,
  onSubmit,
  projection,
  resolver,
  selection
}: CanvasBoardProps): ReactElement {
  const rootRef = useRef<HTMLElement>(null)
  const selectedFrameRef = useRef<HTMLDivElement>(null)
  const frameElementsRef = useRef(new Map<string, HTMLDivElement>())
  const dragRef = useRef<CanvasDrag | null>(null)
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [offscreenFrames, setOffscreenFrames] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const [pauseOffscreen, setPauseOffscreen] = useState(false)
  const navigationRef = useRef({ camera, onCameraChange })
  const selectionRef = useRef({ selection, onSelectionChange })
  const inputTarget = CanvasSelection.inputTarget(selection)

  useLayoutEffect(() => {
    navigationRef.current = { camera, onCameraChange }
  }, [camera, onCameraChange])

  useLayoutEffect(() => {
    selectionRef.current = { selection, onSelectionChange }
  }, [onSelectionChange, selection])

  useLayoutEffect(() => {
    selectedFrameRef.current = inputTarget._tag === "frame"
      ? frameElementsRef.current.get(inputTarget.frameId) ?? null
      : null
  }, [inputTarget])

  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement !== null)
    changed()
    document.addEventListener("fullscreenchange", changed)
    return () => document.removeEventListener("fullscreenchange", changed)
  }, [])

  useEffect(() => {
    if (!pauseOffscreen || typeof IntersectionObserver === "undefined") {
      setOffscreenFrames((current) =>
        current.size === 0 ? current : new Set()
      )
      return
    }
    const observer = new IntersectionObserver((entries) => {
      setOffscreenFrames((current) => {
        const next = new Set(current)
        for (const entry of entries) {
          const frameId = entry.target.getAttribute("data-frame-id")
          if (frameId === null) continue
          if (entry.isIntersecting) next.delete(frameId)
          else next.add(frameId)
        }
        return next
      })
    })
    for (const element of frameElementsRef.current.values()) {
      observer.observe(element)
    }
    return () => observer.disconnect()
  }, [pauseOffscreen, projection.frames])

  const applySelectionCommand = useCallback(
    (command: CanvasSelectionCommand) => {
      const latest = selectionRef.current
      latest.onSelectionChange(CanvasSelection.apply(latest.selection, command))
    },
    []
  )

  const applyCameraIntent = useCallback((intent: FrameInputIntent) => {
    const root = rootRef.current
    if (root === null) return
    const latest = navigationRef.current
    const nextCamera = applyCanvasCameraIntent(
      latest.camera,
      intent,
      root.getBoundingClientRect()
    )
    if (nextCamera !== latest.camera) {
      latest.onCameraChange(nextCamera)
    }
  }, [])

  useEffect(() => {
    const root = rootRef.current
    if (root === null) return
    return connectCanvasInput({
      target: window,
      root,
      onIntent: applyCameraIntent,
      ignore: ({ clientX, clientY }) => {
        const frame = selectedFrameRef.current
        if (frame === null) return false
        const rect = frame.getBoundingClientRect()
        return clientX >= rect.left &&
          clientX <= rect.right &&
          clientY >= rect.top &&
          clientY <= rect.bottom
      }
    })
  }, [applyCameraIntent])

  const frames = framesById(projection.frames)
  const notes = notesById(projection.notes)
  const selectItem = (
    item: CanvasItemRef,
    event: ReactPointerEvent<HTMLDivElement>
  ) => applySelectionCommand({
    _tag: "item",
    item,
    additive: isAdditiveSelection(event)
  })
  const beginDrag = (
    item: CanvasItem,
    mode: DragMode,
    event: ReactPointerEvent<HTMLElement>
  ) => {
    const itemRef: CanvasItemRef = "frameId" in item
      ? { _tag: "frame", frameId: item.frameId }
      : { _tag: "note", noteId: item.noteId }
    if (
      onSubmit === undefined ||
      !CanvasSelection.has(selection, itemRef)
    ) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dragRef.current = {
      item,
      mode,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY
    }
    setDragPreview({
      itemKey: canvasItemKey(item),
      geometry: item.geometry
    })
  }
  const geometryFor = (item: CanvasItem): Geometry =>
    dragPreview?.itemKey === canvasItemKey(item)
      ? dragPreview.geometry
      : item.geometry
  const updateDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    setDragPreview({
      itemKey: canvasItemKey(drag.item),
      geometry: dragGeometry(drag, event.clientX, event.clientY, camera.zoom)
    })
  }
  const finishDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    const geometry = dragGeometry(
      drag,
      event.clientX,
      event.clientY,
      camera.zoom
    )
    dragRef.current = null
    setDragPreview(null)
    if (onSubmit === undefined || sameGeometry(geometry, drag.item.geometry)) {
      return
    }
    onSubmit([
      "frameId" in drag.item
        ? proposeSetFrameGeometry(drag.item, geometry)
        : proposeSetNoteGeometry(drag.item, geometry)
    ])
  }
  const cancelDrag = () => {
    dragRef.current = null
    setDragPreview(null)
  }
  const handleReviewEffect = (effect: ReviewClientEffect) => {
    if (onEffect !== undefined) {
      onEffect(effect)
      return
    }
    applyReviewEffect(effect, {
      frameElement: selectedFrameRef.current,
      setPauseOffscreen
    })
  }

  const items = projection.stack.length === 0
    ? (
      <p role="status">{`${projection.title} has no Frames or Notes.`}</p>
    )
    : projection.stack.map((item, zIndex) =>
      Match.value(item).pipe(Match.tagsExhaustive({
        frame: (item) => {
          const { frameId } = item
          const frame = frames.get(frameId)
          if (frame === undefined) return null
          const threads = projection.threads.filter(
            (thread) => thread.anchor.frameId === frameId
          )
          const liveThreads = threads.filter(
            (thread) => thread.anchor._tag === "element"
          )
          const frameThreads = threads.filter(
            (thread) => thread.anchor._tag === "frame"
          )
          const frameReceivesInput = inputTarget._tag === "camera" ||
            inputTarget.frameId !== frameId
          const onFrameInputIntent = (intent: FrameInputIntent) => {
            if (intent.type === "select") {
              applySelectionCommand({
                _tag: "item",
                item,
                additive: intent.additive
              })
              return
            }
            applyCameraIntent(intent)
          }
          return (
            <div
              ref={(element) => {
                if (element === null) frameElementsRef.current.delete(frameId)
                else frameElementsRef.current.set(frameId, element)
              }}
              aria-label={frame.title}
              aria-selected={ariaSelected(selection, item)}
              data-frame-id={frameId}
              data-review-status={frame.status}
              key={frame.frameId}
              role="option"
              style={itemStyle(geometryFor(frame), zIndex)}
              onPointerDown={(event) => {
                selectItem(item, event)
                beginDrag(frame, "move", event)
              }}
            >
              {reviewStatusLabel[frame.status]}
              <FrameRenderer
                {...(liveThreads.length === 0 ? {} : { commentThreads: liveThreads })}
                {...(frameReceivesInput ? { onInputIntent: onFrameInputIntent } : {})}
                frame={frame}
                paused={pauseOffscreen && offscreenFrames.has(frameId)}
                resolver={resolver}
              />
              {frameThreads.map((thread) => (
                <CommentPin key={thread.threadId} thread={thread} />
              ))}
              {CanvasSelection.has(selection, item) && onSubmit !== undefined
                ? (
                  <button
                    aria-label={`Resize ${frame.title}`}
                    style={{
                      bottom: 0,
                      position: "absolute",
                      right: 0
                    }}
                    type="button"
                    onPointerDown={(event) => {
                      event.stopPropagation()
                      beginDrag(frame, "resize", event)
                    }}
                  >
                    Resize
                  </button>
                )
                : null}
            </div>
          )
        },
        note: (item) => {
          const { noteId } = item
          const note = notes.get(noteId)
          if (note === undefined) return null
          return (
            <div
              aria-label={`${note.text} by ${note.author.displayName}`}
              aria-selected={ariaSelected(selection, item)}
              data-note-author={note.author.displayName}
              data-note-color={note.color}
              key={note.noteId}
              role="option"
              style={itemStyle(geometryFor(note), zIndex)}
              onPointerDown={(event) => {
                selectItem(item, event)
                beginDrag(note, "move", event)
              }}
            >
              {note.text}
              {CanvasSelection.has(selection, item) && onSubmit !== undefined
                ? (
                  <button
                    aria-label={`Resize ${note.text}`}
                    style={{
                      bottom: 0,
                      position: "absolute",
                      right: 0
                    }}
                    type="button"
                    onPointerDown={(event) => {
                      event.stopPropagation()
                      beginDrag(note, "resize", event)
                    }}
                  >
                    Resize
                  </button>
                )
                : null}
            </div>
          )
        }
      }))
    )

  const hasItems = projection.stack.length > 0

  return (
    <section
      ref={rootRef}
      aria-label={projection.title}
      aria-multiselectable={hasItems ? true : undefined}
      className={className}
      role={hasItems ? "listbox" : undefined}
      style={{ position: "relative" }}
      onPointerCancel={cancelDrag}
      onPointerDown={(event) => {
        const target = event.target
        if (
          target instanceof Element &&
          target.closest('[role="option"]') !== null
        ) return
        applySelectionCommand({ _tag: "clear" })
      }}
      onPointerMove={updateDrag}
      onPointerUp={finishDrag}
    >
      {onSubmit === undefined
        ? null
        : (
          <ReviewChrome
            fullscreen={fullscreen}
            onEffect={handleReviewEffect}
            onSubmit={onSubmit}
            pauseOffscreen={pauseOffscreen}
            projection={projection}
            selection={{ _tag: "items", items: selection }}
          />
        )}
      {hasItems
        ? <div style={canvasCameraStyle(camera)}>{items}</div>
        : items}
    </section>
  )
}
