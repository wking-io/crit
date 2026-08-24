import type {
  CommentAnchor,
  CommentThread,
  NormalizedPoint
} from "@crit/domain"
import { Match } from "effect"
import type { ReactElement } from "react"

export const commentPinPoint = (anchor: CommentAnchor): NormalizedPoint =>
  Match.value(anchor).pipe(Match.tagsExhaustive({
    element: ({ fallback }) => fallback,
    frame: ({ point }) => point
  }))

export function CommentPin({
  thread
}: {
  readonly thread: CommentThread
}): ReactElement {
  const point = commentPinPoint(thread.anchor)
  const label = `${thread.resolved ? "Resolved: " : ""}${thread.comments[0].body}`
  return (
    <div
      aria-label={label}
      {...(thread.resolved ? { "data-resolved": "true" } : {})}
      style={{
        left: `${point.x * 100}%`,
        position: "absolute",
        top: `${point.y * 100}%`,
        zIndex: 1
      }}
    />
  )
}
