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
import { Glyph } from "./glyph.js"

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
            <button
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
            >{cancelEdit.label}</button>
            <button
              aria-keyshortcuts={saveEdit.ariaKeyShortcuts}
              disabled={pending || saveEdit.availability !== "enabled"}
              {...actionHelpTarget(saveEdit)}
              type="submit"
            >
              {saveEdit.label}
            </button>
          </div>
        </form>
      ) : (
        <>
          <p>{message.body}</p>
          {beginEdit.availability === "hidden" ? null : (
            <button
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
            </button>
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
  readonly pending: boolean
  readonly threadManageable: boolean
  readonly statusColor: string
  readonly thread?: CanvasCommentThread
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
  const [body, setBody] = useState("")
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
  const placement = props.inline || props.frameGeometry === undefined || props.zoom === undefined
    ? undefined
    : commentPopoverProjection(props.frameGeometry, props.zoom)
  return <aside aria-label={props.thread === undefined ? "New comment" : "Comment thread"} className="crit-comment-popover" data-inline={props.inline || undefined} onPointerDown={(event) => event.stopPropagation()} style={{
    color: props.statusColor,
    ...(placement === undefined ? {} : {
      left: placement.left,
      top: placement.top,
      transform: `scale(${placement.scale})`
    })
  }}>
    <header className="crit-comment-popover__header"><span><Glyph name="commentPin" />{props.thread === undefined ? "New comment" : "Comment"}</span><button aria-label={close.label} disabled={close.availability !== "enabled"} {...actionHelpTarget(close)} onClick={() => runner.run(controls, close, props.onClose(), props.onActionError)} type="button"><Glyph name="close" /></button></header>
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
            <button
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
            </button>
          ) : <span />}
          <button
            aria-keyshortcuts={submitAction.ariaKeyShortcuts}
            disabled={props.pending || submitAction.availability !== "enabled"}
            {...actionHelpTarget(submitAction)}
            type="submit"
          >
            {submitAction.label}
          </button>
        </div>
      </form>
    ) : null}
  </aside>
}
