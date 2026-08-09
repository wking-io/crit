import { useEffect, useState, type FormEvent } from "react"
import type { CanvasCommentThread, CommentAuthor, CommentMessage } from "../core/index.js"
import { IconCommentPin } from "./frame-chrome.js"

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
  readonly owner: CommentAuthor | null
  readonly point: { readonly x: number; readonly y: number }
  readonly statusColor: string
  readonly thread?: CanvasCommentThread
  readonly onClose: () => void
  readonly onCreate: (body: string) => void
  readonly onEdit: (message: CommentMessage, expected: string, body: string) => void
  readonly onReply: (body: string) => void
  readonly onResolve: (resolved: boolean) => void
}) {
  const [body, setBody] = useState("")
  const submit = (event: FormEvent) => { event.preventDefault(); const next = body.trim(); if (!next) return; props.thread === undefined ? props.onCreate(next) : props.onReply(next); setBody("") }
  const canResolve = props.thread !== undefined && (props.owner?.id === props.author.id || props.thread.opening.author.id === props.author.id)
  const left = Math.max(12, Math.min(props.point.x + 12, globalThis.innerWidth - 344))
  const top = Math.max(12, Math.min(props.point.y + 12, globalThis.innerHeight - 460))
  return <aside aria-label={props.thread === undefined ? "New comment" : "Comment thread"} className="crit-comment-popover" onPointerDown={(event) => event.stopPropagation()} style={{ color: props.statusColor, left, top }}>
    <header className="crit-comment-popover__header"><span><IconCommentPin />{props.thread === undefined ? "New comment" : "Comment"}</span><button aria-label="Close comment" onClick={props.onClose} type="button">×</button></header>
    {props.thread === undefined ? null : <div className="crit-comment__messages">{[props.thread.opening, ...props.thread.replies].map((message) => <Message actor={props.author} key={message.id} message={message} onEdit={(expected, next) => props.onEdit(message, expected, next)} />)}</div>}
    <form className="crit-comment__composer" onSubmit={submit}>
      <textarea aria-label={props.thread === undefined ? "Comment" : "Reply"} autoFocus onChange={(event) => setBody(event.currentTarget.value)} placeholder={props.thread === undefined ? "Leave feedback…" : "Reply…"} value={body} />
      <div className="crit-comment__actions">{canResolve && props.thread ? <button onClick={() => props.onResolve(props.thread!.resolvedAt === null)} type="button">{props.thread.resolvedAt === null ? "Resolve" : "Reopen"}</button> : <span />}<button disabled={!body.trim()} type="submit">{props.thread === undefined ? "Comment" : "Reply"}</button></div>
    </form>
  </aside>
}
