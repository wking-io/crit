import { Button } from "@base-ui/react/button"
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from "react"
import { Effect } from "effect"

import {
  CanvasCommand,
  type Author,
  type CanvasCommand as CanvasCommandValue,
  type CanvasGeometry,
  type CanvasNote,
  type NoteColorFamily
} from "../core/index.js"
import { cssVariableStyle } from "./css-variable-style.js"
import {
  CritContextActions,
  type BoundContextMenuItem
} from "./canvas-context-menu.js"
import { useCanvasControls } from "./canvas-action-runner.js"
import type { CanvasControlsInstance } from "./canvas-controls.js"
import { canvasItemStyle } from "./canvas-item-style.js"
import { informationalHelpTarget } from "./canvas-help.js"
import {
  NOTE_COLOR_DEFINITIONS,
  noteColorStyle
} from "./note-color.js"
import {
  createNoteEditingSession,
  type NoteCommandCommit
} from "./note-editing.js"
import {
  NOTE_CARD_HEIGHT,
  NOTE_CARD_WIDTH,
  NOTE_MINIMUM_ROWS,
  NOTE_TEXTAREA_MIN_HEIGHT,
  measureNoteTextareaHeight,
  notePresentedSize,
  type NotePresentationSize
} from "./note-presentation.js"

export {
  NOTE_CARD_HEIGHT,
  NOTE_CARD_WIDTH,
  NOTE_INTERACTION_BAND_HEIGHT,
  NOTE_MINIMUM_ROWS,
  notePlacementOrigin,
  type NotePresentationSize
} from "./note-presentation.js"

type NoteEditorFocusTarget = EventTarget & { readonly blur: () => void }

export const blurNoteEditorOnSurfacePress = (
  editor: NoteEditorFocusTarget | null,
  target: EventTarget | null
) => {
  if (editor !== null && target !== editor) editor.blur()
}

export const listenForNoteEditorBlur = (
  pointerSource: EventTarget,
  editor: NoteEditorFocusTarget
) => {
  const listenerOptions = { capture: true } as const
  const onPointerDown = (event: Event) => {
    blurNoteEditorOnSurfacePress(editor, event.target)
  }
  pointerSource.addEventListener("pointerdown", onPointerDown, listenerOptions)
  return () => pointerSource.removeEventListener(
    "pointerdown",
    onPointerDown,
    listenerOptions
  )
}

const NoteCorner = () => (
  <svg
    aria-hidden="true"
    className="crit-note__corner"
    focusable="false"
    viewBox="0 0 28.5 28.5"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M26.96,2.83S2.93,26.85,2.93,26.85c.74-.73,1.19-1.73,1.19-2.85v-12c0-4.42,3.58-8,8-8h12c1.1,0,2.1-.45,2.83-1.17Z"
      fill="var(--crit-note-surface)"
    />
    <path
      d="M0,28c2.21,0,4-1.79,4-4v-12c0-4.42,3.58-8,8-8h12c2.21,0,4-1.79,4-4"
      fill="none"
      stroke="var(--crit-note-outline)"
      strokeMiterlimit="10"
    />
    <path
      d="M20.73,5.35h-8.39c-3.86,0-7,3.14-7,7v8.39l-.84.87v-9.61c0-4.14,3.36-7.5,7.5-7.5h9.61l-.88.85Z"
      fill="var(--crit-note-pure)"
    />
    <polygon
      fill="var(--crit-note-shade)"
      opacity=".2"
      points="4.58 25.08 4.21 24.83 4.21 21.88 21.88 4.21 24.71 4.21 25.08 4.58 4.58 25.08"
    />
    <path
      d="M26.83,2.83S2.81,26.85,2.81,26.85c.74-.73,1.19-1.73,1.19-2.85v-12c0-4.42,3.58-8,8-8h12c1.1,0,2.1-.45,2.83-1.17Z"
      fill="none"
      stroke="var(--crit-note-outline)"
      strokeMiterlimit="10"
    />
  </svg>
)

export const noteContextMenuItems = (actions: {
  readonly controls: CanvasControlsInstance
  readonly target: {
    readonly kind: "note"
    readonly id: string
    readonly label: string
  }
  readonly currentAuthorIsTargetAuthor: boolean
  readonly onBringToFront: () => Effect.Effect<unknown, unknown>
  readonly copyNodeId: Effect.Effect<unknown, unknown> | undefined
  readonly color: NoteColorFamily
  readonly onColor: (color: NoteColorFamily) => Effect.Effect<unknown, unknown>
  readonly onRemove: () => Effect.Effect<unknown, unknown>
  readonly onSendToBack: () => Effect.Effect<unknown, unknown>
}): ReadonlyArray<BoundContextMenuItem> => {
  const colors: BoundContextMenuItem = {
    action: actions.controls.action({
      id: "set-note-color",
      target: actions.target,
      currentAuthorIsTargetAuthor: actions.currentAuthorIsTargetAuthor
    }),
    swatches: NOTE_COLOR_DEFINITIONS.map((definition) => ({
      label: definition.label,
      color: definition.swatch,
      selected: definition.family === actions.color,
      selectedShadowColor: definition.text,
      execute: actions.onColor(definition.family)
    }))
  }
  const ordering: ReadonlyArray<BoundContextMenuItem> = [{
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
  const items: Array<BoundContextMenuItem> = [colors, ...ordering]
  if (actions.copyNodeId !== undefined) {
    items.push({
      action: actions.controls.action({
        id: "copy-node-id",
        target: actions.target
      }),
      execute: actions.copyNodeId
    })
  }
  items.push({
    action: actions.controls.action({
      id: "remove-item",
      target: actions.target,
      currentAuthorIsTargetAuthor: actions.currentAuthorIsTargetAuthor
    }),
    execute: actions.onRemove()
  })
  return items
}

export function NoteCard({
  author,
  commit,
  execute,
  note,
  geometry,
  developerTools = false,
  selectMode = true,
  selected,
  onBringToFront,
  onMove,
  onPresentationSize,
  onRemove,
  onSelect,
  onSendToBack
}: {
  readonly author: Author | null
  readonly commit: (...commands: ReadonlyArray<CanvasCommandValue>) => void
  readonly execute: (...commands: ReadonlyArray<CanvasCommandValue>) => Effect.Effect<unknown, unknown>
  readonly note: CanvasNote
  readonly geometry: CanvasGeometry
  readonly developerTools?: boolean
  readonly selectMode?: boolean
  readonly selected: boolean
  readonly onBringToFront: () => Effect.Effect<unknown, unknown>
  readonly onMove: (
    event: ReactPointerEvent,
    item: CanvasNote
  ) => void
  readonly onPresentationSize?: (
    noteId: string,
    size: NotePresentationSize
  ) => void
  /** Overrides deletion so a parent can interpose confirmation UI. */
  readonly onRemove?: () => Effect.Effect<unknown, unknown>
  readonly onSelect: (additive?: boolean) => void
  readonly onSendToBack: () => Effect.Effect<unknown, unknown>
}) {
  const controls = useCanvasControls(["canvas"], author !== null)
  const [text, setText] = useState(note.text)
  const [textareaHeight, setTextareaHeight] = useState(NOTE_TEXTAREA_MIN_HEIGHT)
  const noteRef = useRef<HTMLElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const stopListeningForEditorBlurRef = useRef<null | (() => void)>(null)
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
  const presentedGeometry = {
    ...geometry,
    ...notePresentedSize(textareaHeight)
  }

  useEffect(() => () => editing.dispose(), [editing])

  useEffect(() => () => {
    stopListeningForEditorBlurRef.current?.()
  }, [])

  useLayoutEffect(() => {
    const wasDirty = editing.isTextDirty(textRef.current)
    editing.synchronize(note, textRef.current)
    if (wasDirty && note.text !== textRef.current) return
    textRef.current = note.text
    setText(note.text)
  }, [editing, note])

  useLayoutEffect(() => {
    const editor = textareaRef.current
    if (editor === null) return
    const next = measureNoteTextareaHeight(editor)
    setTextareaHeight((current) => current === next ? current : next)
  }, [text])

  useLayoutEffect(() => {
    onPresentationSize?.(note.id, notePresentedSize(textareaHeight))
  }, [note.id, onPresentationSize, textareaHeight])

  const remove = onRemove ?? (() => canEdit
    ? execute(CanvasCommand.removeNote({
        id: note.id,
        actorId: author.id
      }))
    : Effect.fail(new Error("Only the Note Author may remove it")))
  const copyNodeId = developerTools
    ? Effect.tryPromise({
        try: () => {
          const clipboard = noteRef.current?.ownerDocument.defaultView
            ?.navigator.clipboard
          return clipboard === undefined
            ? Promise.reject(new Error("Clipboard access is unavailable"))
            : clipboard.writeText(note.id)
        },
        catch: (cause) => cause
      })
    : undefined
  const menuItems = noteContextMenuItems({
    controls,
    target,
    currentAuthorIsTargetAuthor: canEdit,
    copyNodeId,
    color: note.color,
    onColor: (color) => canEdit
      ? execute(CanvasCommand.setNoteColor({
          id: note.id,
          actorId: author.id,
          color
        }))
      : Effect.fail(new Error("Only the Note Author may change its color")),
    onBringToFront,
    onRemove: remove,
    onSendToBack
  })

  return (
    <CritContextActions
      ariaLabel="Note actions"
      items={menuItems}
      onOpenChange={(open) => {
        if (open) onSelect()
      }}
    >
      <article
        className="crit-note"
        data-selected={selected || undefined}
        onPointerDown={(event) => onSelect(
          event.shiftKey || event.metaKey || event.ctrlKey
        )}
        ref={noteRef}
        style={cssVariableStyle({
          ...canvasItemStyle(presentedGeometry, note.zIndex),
          ...noteColorStyle(note.color),
          "--crit-ui": 1,
          pointerEvents: selectMode ? "auto" : "none"
        })}
      >
        <textarea
          aria-label="Note"
          {...informationalHelpTarget({
            name: canEdit ? "Edit note" : `Note by ${note.author.name}`,
            description: canEdit
              ? "Write review feedback."
              : "Only the Author can edit this note. You can select and move it."
          })}
          onBlur={() => {
            stopListeningForEditorBlurRef.current?.()
            stopListeningForEditorBlurRef.current = null
            editing.flush({ text: textRef.current })
          }}
          onChange={(event) => {
            const nextText = event.currentTarget.value
            textRef.current = nextText
            setText(nextText)
            editing.schedule({ text: nextText })
          }}
          onContextMenu={(event) => event.stopPropagation()}
          onFocus={() => {
            const editor = textareaRef.current
            if (editor === null) return
            stopListeningForEditorBlurRef.current?.()
            stopListeningForEditorBlurRef.current =
              listenForNoteEditorBlur(editor.ownerDocument, editor)
          }}
          onPointerDown={(event) => {
            event.stopPropagation()
            onSelect(event.shiftKey || event.metaKey || event.ctrlKey)
          }}
          onTouchStart={(event) => event.stopPropagation()}
          readOnly={!canEdit}
          ref={textareaRef}
          rows={NOTE_MINIMUM_ROWS}
          style={{ height: textareaHeight }}
          value={text}
        />
        <div
          aria-hidden="true"
          className="crit-note__interaction-band"
          onPointerDown={(event) => {
            if (event.button !== 0) return
            onSelect(event.shiftKey || event.metaKey || event.ctrlKey)
            onMove(event, { ...note, geometry: presentedGeometry })
          }}
        />
        <NoteCorner />
        {!selected ? (
          <Button
            aria-label="Select and move note"
            className="crit-note__select-shield"
            {...informationalHelpTarget({
              name: "Select and move note",
              description: "Click to select this note or drag to reposition it."
            })}
            onClick={(event) => {
              if (event.detail === 0) onSelect()
            }}
            onPointerDown={(event) => {
              if (event.button !== 0) return
              onSelect(event.shiftKey || event.metaKey || event.ctrlKey)
              onMove(event, { ...note, geometry: presentedGeometry })
            }}
            type="button"
          />
        ) : null}
      </article>
    </CritContextActions>
  )
}

export function NotePlacementPhantom({
  x,
  y,
  zIndex
}: {
  readonly x: number
  readonly y: number
  readonly zIndex: number
}) {
  return (
    <article
      aria-hidden="true"
      className="crit-note"
      data-phantom=""
      style={cssVariableStyle({
        ...canvasItemStyle(
          {
            x,
            y,
            width: NOTE_CARD_WIDTH,
            height: NOTE_CARD_HEIGHT
          },
          zIndex
        ),
        ...noteColorStyle("blue"),
        "--crit-ui": 1,
        pointerEvents: "none"
      })}
    >
      <div aria-hidden="true" className="crit-note__interaction-band" />
      <NoteCorner />
    </article>
  )
}
