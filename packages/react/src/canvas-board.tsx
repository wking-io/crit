import {
  type CanvasItemRef,
  type CanvasProjection,
  type Frame,
  type Note
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
  type ReactElement
} from "react"

import {
  applyCanvasCameraIntent,
  type CanvasCamera,
  canvasCameraStyle
} from "./canvas-camera.js"
import { CommentPin } from "./canvas-comment-pin.js"
import { CanvasSelection } from "./canvas-selection.js"
import {
  FrameRenderer,
  type FrameRepresentationResolver
} from "./frame-renderer.js"
import { framesById, notesById } from "./projection-index.js"

export interface CanvasBoardProps {
  readonly projection: CanvasProjection
  readonly resolver: FrameRepresentationResolver
  readonly camera?: CanvasCamera
  readonly onCameraChange?: (camera: CanvasCamera) => void
  readonly selection?: CanvasSelection
  readonly className?: string
}

const ariaSelected = (
  selection: CanvasSelection | undefined,
  item: CanvasItemRef
): true | undefined =>
  selection !== undefined && CanvasSelection.has(selection, item)
    ? true
    : undefined

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

export function CanvasBoard({
  camera,
  className,
  onCameraChange,
  projection,
  resolver,
  selection
}: CanvasBoardProps): ReactElement {
  const rootRef = useRef<HTMLElement>(null)
  const selectedFrameRef = useRef<HTMLDivElement>(null)
  const navigationRef = useRef({ camera, onCameraChange })
  const navigationArmed = camera !== undefined && onCameraChange !== undefined
  const inputTarget = CanvasSelection.inputTarget(selection)

  useLayoutEffect(() => {
    navigationRef.current = { camera, onCameraChange }
  }, [camera, onCameraChange])

  const applyCameraIntent = useCallback((intent: FrameInputIntent) => {
    const root = rootRef.current
    if (root === null) return
    const latest = navigationRef.current
    if (latest.camera === undefined || latest.onCameraChange === undefined) {
      return
    }
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
    if (!navigationArmed) return
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
  }, [applyCameraIntent, navigationArmed])

  const frames = framesById(projection.frames)
  const notes = notesById(projection.notes)

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
          const frameReceivesInput = navigationArmed && (
            inputTarget._tag === "camera" || inputTarget.frameId !== frameId
          )
          return (
            <div
              ref={
                inputTarget._tag === "frame" && inputTarget.frameId === frameId
                  ? selectedFrameRef
                  : undefined
              }
              aria-label={frame.title}
              aria-selected={ariaSelected(selection, item)}
              key={frame.frameId}
              role="option"
              style={itemStyle(frame.geometry, zIndex)}
            >
              <FrameRenderer
                {...(liveThreads.length === 0 ? {} : { commentThreads: liveThreads })}
                {...(frameReceivesInput ? { onInputIntent: applyCameraIntent } : {})}
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
          return (
            <div
              aria-label={note.text}
              aria-selected={ariaSelected(selection, item)}
              key={note.noteId}
              role="option"
              style={itemStyle(note.geometry, zIndex)}
            >
              {note.text}
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
    >
      {camera === undefined || !hasItems
        ? items
        : <div style={canvasCameraStyle(camera)}>{items}</div>}
    </section>
  )
}
