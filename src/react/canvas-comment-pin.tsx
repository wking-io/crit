import { Button } from "@base-ui/react/button"
import { Popover } from "@base-ui/react/popover"
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
  popoverTrigger = false,
  threadId,
  onOpen,
  xRatio,
  yRatio
}: {
  readonly authorName: string
  readonly active: boolean
  readonly color: string
  readonly popoverTrigger?: boolean
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
  const pin = (
    <Button
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
      }}
      type="button"
    ><Glyph name="commentPin" /></Button>
  )
  return popoverTrigger
    ? <Popover.Trigger id={commentPopoverTriggerId(threadId)} render={pin} />
    : pin
}

export const commentPopoverTriggerId = (threadId: string) =>
  `crit-comment-trigger-${threadId}`
