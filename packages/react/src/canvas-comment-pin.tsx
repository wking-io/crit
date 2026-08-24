import type { CommentThread } from "@crit/domain"
import type { ReactElement } from "react"

export function CommentPin({
  thread
}: {
  readonly thread: CommentThread
}): ReactElement | null {
  if (thread.anchor._tag !== "frame") return null
  const { point } = thread.anchor
  const opening = thread.comments[0]
  const label = `${thread.resolved ? "Resolved: " : ""}${opening.body} by ${opening.author.displayName}`
  return (
    <div
      aria-label={label}
      data-comment-author={opening.author.displayName}
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
