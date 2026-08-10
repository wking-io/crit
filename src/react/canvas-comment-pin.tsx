import type { CSSProperties } from "react"

import { Glyph } from "./glyph.js"

export function CanvasCommentPin({
  authorName,
  active,
  color,
  onOpen,
  xRatio,
  yRatio
}: {
  readonly authorName: string
  readonly active: boolean
  readonly color: string
  readonly onOpen: () => void
  readonly xRatio: number
  readonly yRatio: number
}) {
  return (
    <button
      aria-label={`Open comment by ${authorName}`}
      aria-expanded={active}
      className="crit-comment-pin"
      data-active={active || undefined}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onOpen()
      }}
      onPointerDown={(event) => event.stopPropagation()}
      style={{
        color,
        left: `${xRatio * 100}%`,
        top: `${yRatio * 100}%`
      } as CSSProperties}
      type="button"
    ><Glyph name="commentPin" /></button>
  )
}
