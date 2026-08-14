import type { CSSProperties } from "react"
import { Effect } from "effect"

import {
  useCanvasActionRunner,
  useCanvasControls
} from "./canvas-action-runner.js"
import { actionHelpTarget } from "./canvas-help.js"
import { Glyph } from "./glyph.js"

export function CanvasCommentPin({
  authorName,
  active,
  color,
  threadId,
  onOpen,
  xRatio,
  yRatio
}: {
  readonly authorName: string
  readonly active: boolean
  readonly color: string
  readonly threadId: string
  readonly onOpen: () => Effect.Effect<unknown, unknown>
  readonly xRatio: number
  readonly yRatio: number
}) {
  const controls = useCanvasControls(["canvas"], true)
  const runner = useCanvasActionRunner()
  const action = controls.action({
    id: "open-comment",
    target: {
      kind: "comment-thread",
      id: threadId,
      label: `comment by ${authorName}`
    }
  })
  return (
    <button
      aria-label={action.label}
      aria-expanded={active}
      className="crit-comment-pin"
      data-active={active || undefined}
      disabled={action.availability !== "enabled"}
      {...actionHelpTarget(action)}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        runner.run(controls, action, onOpen())
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
