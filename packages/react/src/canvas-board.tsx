import {
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
import {
  FrameRenderer,
  type FrameRepresentationResolver
} from "./frame-renderer.js"
import { framesById, notesById } from "./projection-index.js"

export interface CanvasBoardProps {
  readonly projection: CanvasProjection
  readonly resolver: FrameRepresentationResolver
  readonly camera?: CanvasCamera
  readonly className?: string
}

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
  projection,
  resolver
}: CanvasBoardProps): ReactElement {
  const frames = framesById(projection.frames)
  const notes = notesById(projection.notes)

  const items = projection.stack.length === 0
    ? (
      <p role="status">{`${projection.title} has no Frames or Notes.`}</p>
    )
    : projection.stack.map((item, zIndex) =>
      Match.value(item).pipe(Match.tagsExhaustive({
        frame: ({ frameId }) => {
          const frame = frames.get(frameId)
          if (frame === undefined) return null
          return (
            <section
              aria-label={frame.title}
              key={frame.frameId}
              style={itemStyle(frame.geometry, zIndex)}
            >
              <FrameRenderer frame={frame} resolver={resolver} />
            </section>
          )
        },
        note: ({ noteId }) => {
          const note = notes.get(noteId)
          if (note === undefined) return null
          return (
            <article
              key={note.noteId}
              style={itemStyle(note.geometry, zIndex)}
            >
              {note.text}
            </article>
          )
        }
      }))
    )

  return (
    <section
      aria-label={projection.title}
      className={className}
      style={{ position: "relative" }}
    >
      {camera === undefined || projection.stack.length === 0
        ? items
        : <div style={canvasCameraStyle(camera)}>{items}</div>}
    </section>
  )
}
