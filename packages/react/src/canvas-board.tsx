import {
  type CanvasItemRef,
  type CanvasProjection,
  type Frame,
  type Note
} from "@crit/domain"
import { Match } from "effect"
import type { CSSProperties, ReactElement } from "react"

import {
  type CanvasCamera,
  canvasCameraStyle
} from "./canvas-camera.js"
import { CommentPin } from "./canvas-comment-pin.js"
import { CanvasHover } from "./canvas-hover.js"
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
  readonly selection?: CanvasSelection
  readonly hover?: CanvasHover
  readonly className?: string
}

const ariaSelected = (
  selection: CanvasSelection | undefined,
  item: CanvasItemRef
): true | undefined =>
  selection !== undefined && CanvasSelection.has(selection, item)
    ? true
    : undefined

const dataHovered = (
  hover: CanvasHover | undefined,
  item: CanvasItemRef
): true | undefined =>
  hover !== undefined && CanvasHover.matches(hover, item)
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
  hover,
  projection,
  resolver,
  selection
}: CanvasBoardProps): ReactElement {
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
          return (
            <div
              aria-label={frame.title}
              aria-selected={ariaSelected(selection, item)}
              data-hovered={dataHovered(hover, item)}
              key={frame.frameId}
              role="option"
              style={itemStyle(frame.geometry, zIndex)}
            >
              <FrameRenderer
                {...(liveThreads.length === 0 ? {} : { commentThreads: liveThreads })}
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
              data-hovered={dataHovered(hover, item)}
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
