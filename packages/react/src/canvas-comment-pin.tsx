import type { CommentThread } from "@crit/domain"
import type { ReactElement } from "react"

export function CommentPin({
  onSelect,
  selected = false,
  thread
}: {
  readonly onSelect?: () => void
  readonly selected?: boolean
  readonly thread: CommentThread
}): ReactElement | null {
  if (thread.anchor._tag !== "frame") return null
  const { point } = thread.anchor
  const opening = thread.comments[0]
  const label = `${thread.resolved ? "Resolved: " : ""}${opening.body} by ${opening.author.displayName}`
  return (
    <div
      aria-label={label}
      {...(onSelect === undefined ? {} : { "aria-pressed": selected })}
      data-comment-author={opening.author.displayName}
      {...(selected ? { "data-selected": "true" } : {})}
      {...(thread.resolved ? { "data-resolved": "true" } : {})}
      role={onSelect === undefined ? undefined : "button"}
      style={{
        left: `${point.x * 100}%`,
        position: "absolute",
        top: `${point.y * 100}%`,
        zIndex: 1
      }}
      tabIndex={onSelect === undefined ? undefined : 0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (
          onSelect === undefined ||
          (event.key !== "Enter" && event.key !== " ")
        ) return
        event.preventDefault()
        onSelect()
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {opening.author.displayName}
    </div>
  )
}
