import { useEffect, useState, type FormEvent } from "react"
import type { CanvasCommentThread, CanvasGeometry, CommentAuthor, CommentMessage } from "../core/index.js"
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

const Message = ({ actor, message, onEdit }: { readonly actor: CommentAuthor; readonly message: CommentMessage; readonly onEdit: (expected: string, body: string) => void }) => {
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useState(message.body)
  useEffect(() => setBody(message.body), [message.body])
  return <article className="crit-comment__message">
    <div className="crit-comment__message-header"><strong>{message.author.name}</strong><span>{message.editedAt === null ? "" : "Edited"}</span></div>
    {editing ? <form onSubmit={(event) => { event.preventDefault(); const next = body.trim(); if (next) { onEdit(message.body, next); setEditing(false) } }}>
      <textarea autoFocus onChange={(event) => setBody(event.currentTarget.value)} value={body} />
      <div className="crit-comment__actions"><button onClick={() => setEditing(false)} type="button">Cancel</button><button type="submit">Save</button></div>
    </form> : <><p>{message.body}</p>{message.author.id === actor.id ? <button className="crit-comment__text-action" onClick={() => setEditing(true)} type="button">Edit</button> : null}</>}
  </article>
}

export function CommentPopover(props: {
  readonly author: CommentAuthor
  readonly frameGeometry?: CanvasGeometry
  readonly inline?: boolean
  readonly owner: CommentAuthor | null
  readonly statusColor: string
  readonly thread?: CanvasCommentThread
  readonly zoom?: number
  readonly onClose: () => void
  readonly onCreate: (body: string) => void
  readonly onEdit: (message: CommentMessage, expected: string, body: string) => void
  readonly onReply: (body: string) => void
  readonly onResolve: (resolved: boolean) => void
}) {
  const [body, setBody] = useState("")
  const submit = (event: FormEvent) => { event.preventDefault(); const next = body.trim(); if (!next) return; props.thread === undefined ? props.onCreate(next) : props.onReply(next); setBody("") }
  const canResolve = props.thread !== undefined && (props.owner?.id === props.author.id || props.thread.opening.author.id === props.author.id)
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
    {props.thread === undefined ? null : <div className="crit-comment__messages">{[props.thread.opening, ...props.thread.replies].map((message) => <Message actor={props.author} key={message.id} message={message} onEdit={(expected, next) => props.onEdit(message, expected, next)} />)}</div>}
    <form className="crit-comment__composer" onSubmit={submit}>
      <textarea aria-label={props.thread === undefined ? "Comment" : "Reply"} autoFocus={!props.inline} onChange={(event) => setBody(event.currentTarget.value)} placeholder={props.thread === undefined ? "Leave feedback…" : "Reply…"} value={body} />
      <div className="crit-comment__actions">{canResolve && props.thread ? <button onClick={() => props.onResolve(props.thread!.resolvedAt === null)} type="button">{props.thread.resolvedAt === null ? "Resolve" : "Reopen"}</button> : <span />}<button disabled={!body.trim()} type="submit">{props.thread === undefined ? "Comment" : "Reply"}</button></div>
    </form>
  </aside>
}
