import {
  type CanvasCommandBatch,
  type CanvasItemRef,
  type CanvasProjection,
  type Frame,
  type Note,
  type NoteColor,
  type ReviewStatus,
  proposeSetNoteColor
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

export interface CanvasBoardProps {
  readonly projection: CanvasProjection
  readonly resolver: FrameRepresentationResolver
  readonly camera: CanvasCamera
  readonly onCameraChange: (camera: CanvasCamera) => void
  readonly selection: CanvasSelection
  readonly onSelectionChange: (selection: CanvasSelection) => void
  readonly onSubmit?: (commands: CanvasCommandBatch) => void
  readonly className?: string
}

const NOTE_COLORS = [
  "neutral",
  "red",
  "orange",
  "green",
  "blue",
  "purple"
] as const satisfies readonly NoteColor[]

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
  onSelectionChange,
  onSubmit,
  projection,
  resolver,
  selection
}: CanvasBoardProps): ReactElement {
  const rootRef = useRef<HTMLElement>(null)
  const selectedFrameRef = useRef<HTMLDivElement>(null)
  const navigationRef = useRef({ camera, onCameraChange })
  const selectionRef = useRef({ selection, onSelectionChange })
  const inputTarget = CanvasSelection.inputTarget(selection)

  useLayoutEffect(() => {
    navigationRef.current = { camera, onCameraChange }
  }, [camera, onCameraChange])

  useLayoutEffect(() => {
    selectionRef.current = { selection, onSelectionChange }
  }, [onSelectionChange, selection])

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
              ref={
                inputTarget._tag === "frame" && inputTarget.frameId === frameId
                  ? selectedFrameRef
                  : undefined
              }
              aria-label={frame.title}
              aria-selected={ariaSelected(selection, item)}
              data-review-status={frame.status}
              key={frame.frameId}
              role="option"
              style={itemStyle(frame.geometry, zIndex)}
              onPointerDown={(event) => selectItem(item, event)}
            >
              {reviewStatusLabel[frame.status]}
              <FrameRenderer
                {...(liveThreads.length === 0 ? {} : { commentThreads: liveThreads })}
                {...(frameReceivesInput ? { onInputIntent: onFrameInputIntent } : {})}
                frame={frame}
                resolver={resolver}
              />
              {frameThreads.map((thread) => (
                <CommentPin key={thread.threadId} thread={thread} />
              ))}
            </div>
          )
        },
        note: (item) => {
          const { noteId } = item
          const note = notes.get(noteId)
          if (note === undefined) return null
          const selected = CanvasSelection.has(selection, item)
          return (
            <div
              aria-label={`${note.text} by ${note.author.displayName}`}
              aria-selected={ariaSelected(selection, item)}
              data-note-author={note.author.displayName}
              data-note-color={note.color}
              key={note.noteId}
              role="option"
              style={itemStyle(note.geometry, zIndex)}
              onPointerDown={(event) => selectItem(item, event)}
            >
              {note.text}
              {selected && onSubmit !== undefined
                ? (
                  <div aria-label="Note color" role="group">
                    {NOTE_COLORS.map((color) => (
                      <button
                        aria-label={color}
                        aria-pressed={note.color === color}
                        key={color}
                        type="button"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation()
                          if (note.color === color) return
                          onSubmit([proposeSetNoteColor(note, color)])
                        }}
                      >
                        {color}
                      </button>
                    ))}
                  </div>
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
      onPointerDown={(event) => {
        const target = event.target
        if (
          target instanceof Element &&
          target.closest('[role="option"]') !== null
        ) return
        applySelectionCommand({ _tag: "clear" })
      }}
    >
      {hasItems
        ? <div style={canvasCameraStyle(camera)}>{items}</div>
        : items}
    </section>
  )
}
