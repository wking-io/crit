import { Button } from "@base-ui/react/button"
import { Popover } from "@base-ui/react/popover"
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent
} from "react"
import { Effect } from "effect"
import type {
  CanvasCommentThread,
  CanvasGeometry,
  CommentMessage
} from "../core/index.js"
import { frameUiScale } from "./frame-card.js"
import {
  useCanvasActionRunner,
  useCanvasControls
} from "./canvas-action-runner.js"
import {
  actionHelpTarget,
  informationalHelpTarget
} from "./canvas-help.js"
import { cssVariableStyle } from "./css-variable-style.js"
import { Glyph } from "./glyph.js"
import { useCritOverlayContainer } from "./overlay-container.js"

export const COMMENT_POPOVER_WIDTH = 332
export const COMMENT_POPOVER_GAP = 12

export const commentPopoverProjection = (
  frame: CanvasGeometry,
  zoom: number
) => {
  const scale = frameUiScale(zoom)
  return {
    left: frame.x - (COMMENT_POPOVER_WIDTH + COMMENT_POPOVER_GAP) * scale,
    top: frame.y,
    scale
  }
}

const commentPopoverStickyStyle = (
  frame: CanvasGeometry,
  zoom: number
) => {
  const projection = commentPopoverProjection(frame, zoom)
  return cssVariableStyle({
    "--crit-comment-left": `${projection.left - frame.x}px`,
    "--crit-comment-scale": projection.scale,
    "--crit-comment-top": `${projection.top - frame.y}px`
  })
}

export type CommentDraftClear = {
  readonly version: number
  readonly scope: "composer" | "editing" | "all"
}

const Message = ({
  clearDraft,
  editable,
  message,
  pending,
  onActionError,
  onDirty,
  onEdit
}: {
  readonly clearDraft: CommentDraftClear | null
  readonly editable: boolean
  readonly message: CommentMessage
  readonly pending: boolean
  readonly onActionError?: (cause: unknown) => void
  readonly onDirty: (messageId: string, dirty: boolean) => void
  readonly onEdit: (expected: string, body: string) => Effect.Effect<unknown, unknown>
}) => {
  const controls = useCanvasControls(["canvas", "comment-edit"], true)
  const runner = useCanvasActionRunner()
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useState(message.body)
  useEffect(() => {
    if (!editing) setBody(message.body)
  }, [editing, message.body])
  useEffect(() => {
    if (
      clearDraft !== null &&
      (clearDraft.scope === "editing" || clearDraft.scope === "all")
    ) {
      setEditing(false)
      setBody(message.body)
    }
  }, [clearDraft, message.body])
  useEffect(() => {
    onDirty(message.id, editing && body !== message.body)
  }, [body, editing, message.body, message.id, onDirty])
  const target = {
    kind: "comment" as const,
    id: message.id,
    label: "comment"
  }
  const beginEdit = controls.action({
    id: "begin-comment-edit",
    target,
    editable
  })
  const cancelEdit = controls.action({
    id: "cancel-comment-edit",
    target,
    editable
  })
  const saveEdit = controls.action({
    id: "save-comment-edit",
    target,
    editable,
    bodyPresent: body.trim().length > 0
  })
  const save = () => {
    const next = body.trim()
    if (next.length === 0) return
    runner.run(
      controls,
      saveEdit,
      onEdit(message.body, next),
      onActionError
    )
  }

  return (
    <article className="crit-comment__message">
      <div className="crit-comment__message-header">
        <strong>{message.author.name}</strong>
        <span>{message.editedAt === null ? "" : "Edited"}</span>
      </div>
      {editing ? (
        <form onSubmit={(event) => {
          event.preventDefault()
          save()
        }}>
          <textarea
            autoFocus
            disabled={pending}
            {...informationalHelpTarget({
              name: "Comment text",
              description: "Edit this comment message."
            })}
            onChange={(event) => setBody(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                save()
              }
            }}
            value={body}
          />
          <div className="crit-comment__actions">
            <Button
              disabled={pending || cancelEdit.availability !== "enabled"}
              {...actionHelpTarget(cancelEdit)}
              onClick={() => runner.run(
                controls,
                cancelEdit,
                Effect.sync(() => {
                  setEditing(false)
                  setBody(message.body)
                })
              )}
              type="button"
            >{cancelEdit.label}</Button>
            <Button
              aria-keyshortcuts={saveEdit.ariaKeyShortcuts ?? undefined}
              disabled={pending || saveEdit.availability !== "enabled"}
              {...actionHelpTarget(saveEdit)}
              type="submit"
            >
              {saveEdit.label}
            </Button>
          </div>
        </form>
      ) : (
        <>
          <p>{message.body}</p>
          {beginEdit.availability === "hidden" ? null : (
            <Button
              className="crit-comment__text-action"
              disabled={pending || beginEdit.availability !== "enabled"}
              {...actionHelpTarget(beginEdit)}
              onClick={() => runner.run(
                controls,
                beginEdit,
                Effect.sync(() => setEditing(true))
              )}
              type="button"
            >
              Edit
            </Button>
          )}
        </>
      )}
    </article>
  )
}

export function CommentPopover(props: {
  readonly frameId: string
  readonly canSubmit: boolean
  readonly clearDraft: CommentDraftClear | null
  readonly currentAuthorId: string | null
  readonly frameGeometry?: CanvasGeometry
  readonly inline?: boolean
  readonly anchor?: Popover.Positioner.Props["anchor"]
  readonly pending: boolean
  readonly threadManageable: boolean
  readonly statusColor: string
  readonly thread?: CanvasCommentThread | undefined
  readonly zoom?: number
  readonly onClose: () => Effect.Effect<unknown, unknown>
  readonly onActionError?: (cause: unknown) => void
  readonly onDraftStatus: (dirty: boolean) => void
  readonly onEdit: (commentId: string, expected: string, body: string) => Effect.Effect<unknown, unknown>
  readonly onResolve: (resolved: boolean) => Effect.Effect<unknown, unknown>
  readonly onSubmit: (body: string) => Effect.Effect<unknown, unknown>
}) {
  const controls = useCanvasControls(["canvas", "comment-compose"], true)
  const runner = useCanvasActionRunner()
  const overlayContainer = useCritOverlayContainer()
  const [body, setBody] = useState("")
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const composerDirty = useRef(false)
  const editingDirty = useRef(new Set<string>())
  const reportDraftStatus = useCallback(() => {
    props.onDraftStatus(
      composerDirty.current || editingDirty.current.size > 0
    )
  }, [props.onDraftStatus])
  const onEditingDirty = useCallback((messageId: string, dirty: boolean) => {
    if (dirty) editingDirty.current.add(messageId)
    else editingDirty.current.delete(messageId)
    reportDraftStatus()
  }, [reportDraftStatus])
  useEffect(() => {
    if (props.clearDraft === null) return
    if (
      props.clearDraft.scope === "composer" ||
      props.clearDraft.scope === "all"
    ) {
      composerDirty.current = false
      setBody("")
    }
    if (
      props.clearDraft.scope === "editing" ||
      props.clearDraft.scope === "all"
    ) {
      editingDirty.current.clear()
    }
    reportDraftStatus()
  }, [props.clearDraft, reportDraftStatus])
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const next = body.trim()
    if (next.length === 0) return
    runner.run(
      controls,
      submitAction,
      props.onSubmit(next),
      props.onActionError
    )
  }
  const frameTarget = { kind: "frame" as const, id: props.frameId, label: "frame" }
  const threadTarget = props.thread === undefined
    ? undefined
    : { kind: "comment-thread" as const, id: props.thread.id, label: "comment" }
  const close = controls.action({
    id: "close-comment",
    target: threadTarget ?? frameTarget
  })
  const submitAction = props.thread === undefined
    ? controls.action({
        id: "submit-comment",
        target: frameTarget,
        bodyPresent: body.trim().length > 0
      })
    : controls.action({
        id: "submit-reply",
        target: threadTarget!,
        bodyPresent: body.trim().length > 0
      })
  const resolutionAction = props.thread === undefined
    ? null
    : props.thread.resolvedAt === null ? controls.action({
        id: "resolve-comment-thread",
        target: { kind: "comment-thread", id: props.thread.id, label: "comment" },
        manageable: props.threadManageable
      })
      : controls.action({
          id: "reopen-comment-thread",
          target: { kind: "comment-thread", id: props.thread.id, label: "comment" },
          manageable: props.threadManageable
        })
  const title = props.thread === undefined ? "New comment" : "Comment"
  const contents = <>
    <header className="crit-comment-popover__header">
      {props.inline ? (
        <span><Glyph name="commentPin" />{title}</span>
      ) : (
        <Popover.Title render={<span />}>
          <Glyph name="commentPin" />{title}
        </Popover.Title>
      )}
      {props.inline ? (
        <Button
          aria-label={close.label}
          disabled={close.availability !== "enabled"}
          {...actionHelpTarget(close)}
          onClick={() => runner.run(
            controls,
            close,
            props.onClose(),
            props.onActionError
          )}
          type="button"
        ><Glyph name="close" /></Button>
      ) : (
        <Popover.Close
          aria-label={close.label}
          disabled={close.availability !== "enabled"}
          {...actionHelpTarget(close)}
        ><Glyph name="close" /></Popover.Close>
      )}
    </header>
    {props.thread === undefined ? null : (
      <div className="crit-comment__messages">
        {[props.thread.opening, ...props.thread.replies].map((message) => (
          <Message
            clearDraft={props.clearDraft}
            editable={props.currentAuthorId === message.author.id}
            key={message.id}
            message={message}
            pending={props.pending}
            {...(props.onActionError === undefined
              ? {}
              : { onActionError: props.onActionError })}
            onDirty={onEditingDirty}
            onEdit={(expected, next) => props.onEdit(message.id, expected, next)}
          />
        ))}
      </div>
    )}
    {props.canSubmit ? (
      <form className="crit-comment__composer" onSubmit={submit}>
        <textarea
          aria-label={props.thread === undefined ? "Comment" : "Reply"}
          autoFocus={!props.inline}
          disabled={props.pending}
          ref={composerRef}
          {...informationalHelpTarget({
            name: props.thread === undefined ? "Comment text" : "Reply text",
            description: props.thread === undefined
              ? "Write feedback for this frame."
              : "Write a reply to this comment thread."
          })}
          onChange={(event) => {
            const next = event.currentTarget.value
            setBody(next)
            composerDirty.current = next.trim().length > 0
            reportDraftStatus()
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }}
          placeholder={props.thread === undefined ? "Leave feedback…" : "Reply…"}
          value={body}
        />
        <div className="crit-comment__actions">
          {resolutionAction !== null && props.thread ? (
            <Button
              disabled={props.pending || resolutionAction.availability !== "enabled"}
              {...actionHelpTarget(resolutionAction)}
              onClick={() => runner.run(
                controls,
                resolutionAction,
                props.onResolve(resolutionAction.id === "resolve-comment-thread"),
                props.onActionError
              )}
              type="button"
            >
              {resolutionAction.label}
            </Button>
          ) : <span />}
          <Button
            aria-keyshortcuts={submitAction.ariaKeyShortcuts ?? undefined}
            disabled={props.pending || submitAction.availability !== "enabled"}
            {...actionHelpTarget(submitAction)}
            type="submit"
          >
            {submitAction.label}
          </Button>
        </div>
      </form>
    ) : null}
  </>

  const label = props.thread === undefined ? "New comment" : "Comment thread"
  const frameGeometry = props.frameGeometry
  const zoom = props.zoom
  if (props.inline) {
    return (
      <aside
        aria-label={label}
        className="crit-comment-popover"
        data-inline="true"
        onPointerDown={(event) => event.stopPropagation()}
        style={{ color: props.statusColor }}
      >
        {contents}
      </aside>
    )
  }
  if (frameGeometry !== undefined && zoom !== undefined) {
    return (
      <Popover.Positioner
        className="crit-comment-popover-positioner"
        collisionAvoidance={{
          align: "none",
          fallbackAxisSide: "none",
          side: "none"
        }}
        data-sticky="true"
        style={commentPopoverStickyStyle(frameGeometry, zoom)}
      >
        <Popover.Popup
          aria-label={label}
          className="crit-comment-popover"
          initialFocus={props.canSubmit ? composerRef : true}
          onPointerDown={(event) => event.stopPropagation()}
          render={<aside />}
          style={{ color: props.statusColor }}
        >
          {contents}
        </Popover.Popup>
      </Popover.Positioner>
    )
  }

  return (
    <Popover.Portal container={overlayContainer}>
      <Popover.Positioner
        align="start"
        anchor={props.anchor}
        className="crit-comment-popover-positioner"
        collisionAvoidance={{
          align: "none",
          fallbackAxisSide: "none",
          side: "none"
        }}
        positionMethod="fixed"
        side="left"
        sideOffset={COMMENT_POPOVER_GAP}
      >
        <Popover.Popup
          aria-label={label}
          className="crit-comment-popover"
          initialFocus={props.canSubmit ? composerRef : true}
          onPointerDown={(event) => event.stopPropagation()}
          render={<aside />}
          style={{ color: props.statusColor }}
        >
          {contents}
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  )
}
