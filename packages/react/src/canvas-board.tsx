import {
  type CanvasCommandBatch,
  type CanvasItemRef,
  type CanvasProjection,
  type CommentThreadId,
  type Frame,
  type Note,
  type ReviewStatus
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
import { useCanvasItemDrag } from "./canvas-item-drag.js"
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
import { useReviewEffects } from "./review-effects.js"

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
  const [selectedThreadId, setSelectedThreadId] =
    useState<CommentThreadId | null>(null)
  const navigationRef = useRef({ camera, onCameraChange })
  const selectionRef = useRef({ selection, onSelectionChange })
  const inputTarget = CanvasSelection.inputTarget(selection)
  const itemDrag = useCanvasItemDrag({
    camera,
    ...(onSubmit === undefined ? {} : { onSubmit })
  })
  const reviewEffects = useReviewEffects({
    frameElementsRef,
    frames: projection.frames,
    selectedFrameRef,
    ...(onEffect === undefined ? {} : { onEffect })
  })
  const activeThreadId = selectedThreadId !== null &&
      projection.threads.some((thread) => thread.threadId === selectedThreadId)
    ? selectedThreadId
    : null

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
  ) => {
    setSelectedThreadId(null)
    applySelectionCommand({
      _tag: "item",
      item,
      additive: isAdditiveSelection(event)
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
              style={itemStyle(itemDrag.geometryFor(frame), zIndex)}
              onPointerDown={(event) => {
                selectItem(item, event)
                itemDrag.begin(frame, "move", event)
              }}
            >
              {reviewStatusLabel[frame.status]}
              <FrameRenderer
                {...(liveThreads.length === 0 ? {} : { commentThreads: liveThreads })}
                {...(frameReceivesInput ? { onInputIntent: onFrameInputIntent } : {})}
                frame={frame}
                paused={reviewEffects.isFramePaused(frameId)}
                resolver={resolver}
              />
              {frameThreads.map((thread) => (
                <CommentPin
                  key={thread.threadId}
                  {...(onSubmit === undefined
                    ? {}
                    : { onSelect: () => setSelectedThreadId(thread.threadId) })}
                  selected={activeThreadId === thread.threadId}
                  thread={thread}
                />
              ))}
              {CanvasSelection.has(selection, item) && onSubmit !== undefined
                ? (
                  <span
                    aria-label={`Resize ${frame.title}`}
                    style={{
                      bottom: 0,
                      cursor: "se-resize",
                      position: "absolute",
                      right: 0
                    }}
                    onPointerDown={(event) => {
                      event.stopPropagation()
                      itemDrag.begin(frame, "resize", event)
                    }}
                  >
                    Resize
                  </span>
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
              style={itemStyle(itemDrag.geometryFor(note), zIndex)}
              onPointerDown={(event) => {
                selectItem(item, event)
                itemDrag.begin(note, "move", event)
              }}
            >
              {note.text}
              {CanvasSelection.has(selection, item) && onSubmit !== undefined
                ? (
                  <span
                    aria-label={`Resize ${note.text}`}
                    style={{
                      bottom: 0,
                      cursor: "se-resize",
                      position: "absolute",
                      right: 0
                    }}
                    onPointerDown={(event) => {
                      event.stopPropagation()
                      itemDrag.begin(note, "resize", event)
                    }}
                  >
                    Resize
                  </span>
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
      onPointerCancel={itemDrag.cancel}
      onPointerDown={(event) => {
        const target = event.target
        if (
          target instanceof Element &&
          target.closest('[role="option"]') !== null
        ) return
        setSelectedThreadId(null)
        applySelectionCommand({ _tag: "clear" })
      }}
      onPointerMove={itemDrag.update}
      onPointerUp={itemDrag.finish}
    >
      {onSubmit === undefined
        ? null
        : (
          <ReviewChrome
            fullscreen={reviewEffects.fullscreen}
            onEffect={reviewEffects.handle}
            onSubmit={onSubmit}
            pauseOffscreen={reviewEffects.pauseOffscreen}
            projection={projection}
            selection={activeThreadId === null
              ? { _tag: "items", items: selection }
              : { _tag: "comment-thread", threadId: activeThreadId }}
          />
        )}
      {hasItems
        ? <div style={canvasCameraStyle(camera)}>{items}</div>
        : items}
    </section>
  )
}
