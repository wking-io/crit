import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent
} from "react"
import type {
  CanvasCommentThread,
  CanvasGeometry,
  CommentMessage
} from "../core/index.js"
import { frameUiScale } from "./frame-card.js"
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
  onDirty,
  onEdit
}: {
  readonly clearDraft: CommentDraftClear | null
  readonly editable: boolean
  readonly message: CommentMessage
  readonly pending: boolean
  readonly onDirty: (messageId: string, dirty: boolean) => void
  readonly onEdit: (expected: string, body: string) => void
}) => {
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

  return (
    <article className="crit-comment__message">
      <div className="crit-comment__message-header">
        <strong>{message.author.name}</strong>
        <span>{message.editedAt === null ? "" : "Edited"}</span>
      </div>
      {editing ? (
        <form onSubmit={(event) => {
          event.preventDefault()
          const next = body.trim()
          if (next.length > 0) onEdit(message.body, next)
        }}>
          <textarea
            autoFocus
            disabled={pending}
            onChange={(event) => setBody(event.currentTarget.value)}
            value={body}
          />
          <div className="crit-comment__actions">
            <button onClick={() => {
              setEditing(false)
              setBody(message.body)
            }} type="button">Cancel</button>
            <button disabled={pending || body.trim().length === 0} type="submit">
              Save
            </button>
          </div>
        </form>
      ) : (
        <>
          <p>{message.body}</p>
          {editable ? (
            <button
              className="crit-comment__text-action"
              disabled={pending}
              onClick={() => setEditing(true)}
              type="button"
            >
              Edit
            </button>
          ) : null}
        </>
      )}
    </article>
  )
}

export function CommentPopover(props: {
  readonly canSubmit: boolean
  readonly clearDraft: CommentDraftClear | null
  readonly editableCommentIds: ReadonlySet<string>
  readonly frameGeometry?: CanvasGeometry
  readonly inline?: boolean
  readonly pending: boolean
  readonly resolution: "resolve" | "reopen" | null
  readonly statusColor: string
  readonly thread?: CanvasCommentThread
  readonly zoom?: number
  readonly onClose: () => void
  readonly onDraftStatus: (dirty: boolean) => void
  readonly onEdit: (commentId: string, expected: string, body: string) => void
  readonly onResolve: (resolved: boolean) => void
  readonly onSubmit: (body: string) => void
}) {
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
    if (next.length > 0) props.onSubmit(next)
  }
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
    <header className="crit-comment-popover__header"><span><Glyph name="commentPin" />{props.thread === undefined ? "New comment" : "Comment"}</span><button aria-label="Close comment" onClick={props.onClose} type="button"><Glyph name="close" /></button></header>
    {props.thread === undefined ? null : (
      <div className="crit-comment__messages">
        {[props.thread.opening, ...props.thread.replies].map((message) => (
          <Message
            clearDraft={props.clearDraft}
            editable={props.editableCommentIds.has(message.id)}
            key={message.id}
            message={message}
            pending={props.pending}
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
          onChange={(event) => {
            const next = event.currentTarget.value
            setBody(next)
            composerDirty.current = next.trim().length > 0
            reportDraftStatus()
          }}
          placeholder={props.thread === undefined ? "Leave feedback…" : "Reply…"}
          value={body}
        />
        <div className="crit-comment__actions">
          {props.resolution !== null && props.thread ? (
            <button
              disabled={props.pending}
              onClick={() => props.onResolve(props.resolution === "resolve")}
              type="button"
            >
              {props.resolution === "resolve" ? "Resolve" : "Reopen"}
            </button>
          ) : <span />}
          <button disabled={props.pending || body.trim().length === 0} type="submit">
            {props.thread === undefined ? "Comment" : "Reply"}
          </button>
        </div>
      </form>
    ) : null}
  </aside>
}
