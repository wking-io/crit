import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from "react"
import { Effect } from "effect"

import {
  CanvasCommand,
  type Author,
  type CanvasCommand as CanvasCommandValue,
  type CanvasGeometry,
  type CanvasNote
} from "../core/index.js"
import {
  CritContextMenu,
  type ContextMenuItem,
  type ContextMenuPosition
} from "./canvas-context-menu.js"
import { useCanvasControls } from "./canvas-action-runner.js"
import type { CanvasControlsInstance } from "./canvas-controls.js"
import { canvasItemStyle } from "./canvas-item-style.js"
import { informationalHelpTarget } from "./canvas-help.js"
import {
  CanvasSelection,
  type ResizeHandlePosition
} from "./canvas-selection.js"
import { frameStatus } from "./frame-chrome.js"
import {
  createNoteEditingSession,
  type NoteCommandCommit
} from "./note-editing.js"

export const NOTE_MINIMUM_ROWS = 3
const NOTE_BORDER_HEIGHT = 2
const NOTE_RESIZE_HANDLES = ["west", "east"] as const

export const noteHeightForContent = (scrollHeight: number) =>
  Math.ceil(scrollHeight + NOTE_BORDER_HEIGHT)

export const noteContextMenuItems = (actions: {
  readonly controls: CanvasControlsInstance
  readonly target: {
    readonly kind: "note"
    readonly id: string
    readonly label: string
  }
  readonly currentAuthorIsTargetAuthor: boolean
  readonly onBringToFront: () => Effect.Effect<unknown, unknown>
  readonly onRemove: () => Effect.Effect<unknown, unknown>
  readonly onSendToBack: () => Effect.Effect<unknown, unknown>
}): ReadonlyArray<ContextMenuItem> => {
  const ordering: ReadonlyArray<ContextMenuItem> = [{
    action: actions.controls.action({
      id: "bring-item-to-front",
      target: actions.target
    }),
    execute: actions.onBringToFront()
  }, {
    action: actions.controls.action({
      id: "send-item-to-back",
      target: actions.target
    }),
    execute: actions.onSendToBack()
  }]
  return [...ordering, {
    action: actions.controls.action({
      id: "remove-item",
      target: actions.target,
      currentAuthorIsTargetAuthor: actions.currentAuthorIsTargetAuthor
    }),
    execute: actions.onRemove()
  }]
}

export function NoteCard({
  author,
  commit,
  execute,
  note,
  geometry,
  selected,
  zoom,
  onBringToFront,
  onMove,
  onResize,
  onSelect,
  onSendToBack
}: {
  readonly author: Author | null
  readonly commit: (...commands: ReadonlyArray<CanvasCommandValue>) => void
  readonly execute: (...commands: ReadonlyArray<CanvasCommandValue>) => Effect.Effect<unknown, unknown>
  readonly note: CanvasNote
  readonly geometry: CanvasGeometry
  readonly selected: boolean
  readonly zoom: number
  readonly onBringToFront: () => Effect.Effect<unknown, unknown>
  readonly onMove: (event: ReactPointerEvent, item: CanvasNote) => void
  readonly onResize: (
    event: ReactPointerEvent,
    item: CanvasNote,
    handle: ResizeHandlePosition
  ) => void
  readonly onSelect: (additive?: boolean) => void
  readonly onSendToBack: () => Effect.Effect<unknown, unknown>
}) {
  const controls = useCanvasControls(["canvas"], author !== null)
  const [contextMenu, setContextMenu] = useState<ContextMenuPosition | null>(null)
  const [height, setHeight] = useState(geometry.height)
  const [text, setText] = useState(note.text)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const textRef = useRef(note.text)
  const commitRef = useRef<NoteCommandCommit>(commit)
  commitRef.current = commit
  const canEdit = author?.id === note.author.id
  const target = {
    kind: "note" as const,
    id: note.id,
    label: "note"
  }
  const editing = useMemo(() => createNoteEditingSession({
    actorId: author?.id ?? null,
    commit: (...commands) => commitRef.current(...commands),
    note
  }), [author?.id, note.id])

  useEffect(() => () => editing.dispose(), [editing])

  useLayoutEffect(() => {
    const wasDirty = editing.isTextDirty(textRef.current)
    editing.synchronize(note, textRef.current)
    if (wasDirty && note.text !== textRef.current) return
    textRef.current = note.text
    setText(note.text)
  }, [editing, note])

  useLayoutEffect(() => {
    const frame = globalThis.requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (textarea === null) return
      textarea.style.height = "auto"
      const nextHeight = noteHeightForContent(textarea.scrollHeight)
      textarea.style.height = `${nextHeight - NOTE_BORDER_HEIGHT}px`
      setHeight((current) => current === nextHeight ? current : nextHeight)
      editing.schedule({
        text: textRef.current,
        width: geometry.width,
        height: nextHeight
      })
    })
    return () => globalThis.cancelAnimationFrame(frame)
  }, [editing, geometry.height, geometry.width, text])

  const measureAndFlush = () => {
    const textarea = textareaRef.current
    if (textarea === null) return
    textarea.style.height = "auto"
    const nextHeight = noteHeightForContent(textarea.scrollHeight)
    textarea.style.height = `${nextHeight - NOTE_BORDER_HEIGHT}px`
    setHeight(nextHeight)
    editing.flush({
      text: textRef.current,
      width: geometry.width,
      height: nextHeight
    })
  }

  const remove = () => canEdit
    ? execute(CanvasCommand.removeNote({
        id: note.id,
        actorId: author.id
      }))
    : Effect.fail(new Error("Only the Note Author may remove it"))

  return (
    <article
      className="crit-note"
      data-selected={selected || undefined}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        setContextMenu({ x: event.clientX, y: event.clientY })
        onSelect()
      }}
      onPointerDown={(event) => onSelect(
        event.shiftKey || event.metaKey || event.ctrlKey
      )}
      style={{
        ...canvasItemStyle({ ...geometry, height }, note.zIndex),
        "--crit-ui": 1
      } as CSSProperties}
    >
      <textarea
        aria-label="Note"
        {...informationalHelpTarget({
          name: canEdit ? "Edit note" : `Note by ${note.author.name}`,
          description: canEdit
            ? "Write review feedback. The note grows to keep every line visible."
            : "Only the Author can edit this note. You can select, move, and resize its width."
        })}
        onBlur={measureAndFlush}
        onChange={(event) => {
          textRef.current = event.currentTarget.value
          setText(event.currentTarget.value)
        }}
        readOnly={!canEdit}
        ref={textareaRef}
        rows={NOTE_MINIMUM_ROWS}
        value={text}
      />
      {!selected ? (
        <button
          aria-label="Select and move note"
          className="crit-note__select-shield"
          {...informationalHelpTarget({
            name: "Select and move note",
            description: "Click to select this note or drag to reposition it."
          })}
          onPointerDown={(event) => {
            onSelect(event.shiftKey || event.metaKey || event.ctrlKey)
            onMove(event, note)
          }}
          type="button"
        />
      ) : null}
      {selected ? (
        <CanvasSelection
          handles={NOTE_RESIZE_HANDLES}
          handleStyle="sides"
          ink={frameStatus("archived").ink}
          label="note"
          onResize={(event, handle) => onResize(event, note, handle)}
          shell={frameStatus("archived").shell}
          zoom={zoom}
        />
      ) : null}
      <CritContextMenu
        ariaLabel="Note actions"
        items={noteContextMenuItems({
          controls,
          target,
          currentAuthorIsTargetAuthor: canEdit,
          onBringToFront,
          onRemove: remove,
          onSendToBack
        })}
        onClose={() => setContextMenu(null)}
        position={contextMenu}
      />
    </article>
  )
}
