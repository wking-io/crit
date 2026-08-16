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
  type ContextMenuItem
} from "./canvas-context-menu.js"
import { useCanvasControls } from "./canvas-action-runner.js"
import type { CanvasControlsInstance } from "./canvas-controls.js"
import { canvasItemStyle } from "./canvas-item-style.js"
import { informationalHelpTarget } from "./canvas-help.js"
import { Glyph } from "./glyph.js"
import {
  NOTE_COLOR_DEFINITIONS,
  noteColorStyle
} from "./note-color.js"
import {
  createNoteEditingSession,
  type NoteCommandCommit
} from "./note-editing.js"
import { noteFrameClearance } from "./note-frame-clearance.js"
import {
  activateNotePresentation,
  DEFAULT_NOTE_PRESENTATION_THRESHOLDS,
  dismissNotePresentation,
  initialNotePresentationState,
  notePresentation,
  NOTE_COLLAPSED_SIZE,
  NOTE_EXPANDED_MAXIMUM_HEIGHT,
  type NotePresentationThresholds
} from "./note-presentation.js"

export const NOTE_MINIMUM_ROWS = 3
const NOTE_BORDER_HEIGHT = 2
const NOTE_MINIMUM_TEXTAREA_HEIGHT = 84
export const NOTE_INTERACTION_BAND_HEIGHT = 28.5

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

export const noteHeightForContent = (scrollHeight: number, zoom = 1) =>
  Math.ceil(
    scrollHeight +
    (NOTE_BORDER_HEIGHT + NOTE_INTERACTION_BAND_HEIGHT) / zoom
  )

const noteTextareaHeight = (noteHeight: number, zoom: number) =>
  noteHeight - (NOTE_BORDER_HEIGHT + NOTE_INTERACTION_BAND_HEIGHT) / zoom

export interface NotePresentationSize {
  readonly width: number
  readonly height: number
}

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
}): ReadonlyArray<ContextMenuItem> => {
  const colors: ContextMenuItem = {
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
  const items: Array<ContextMenuItem> = [colors, ...ordering]
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
  clearanceAnchor = note.geometry,
  developerTools = false,
  frameGeometries = [],
  cameraOffset = { x: 0, y: 0 },
  selectMode = true,
  selected,
  viewport = null,
  zoom,
  thresholds = DEFAULT_NOTE_PRESENTATION_THRESHOLDS,
  topZIndex,
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
  readonly clearanceAnchor?: CanvasGeometry
  readonly developerTools?: boolean
  readonly frameGeometries?: ReadonlyArray<CanvasGeometry>
  readonly cameraOffset?: { readonly x: number; readonly y: number }
  readonly selectMode?: boolean
  readonly selected: boolean
  readonly viewport?: {
    readonly width: number
    readonly height: number
  } | null
  readonly zoom: number
  readonly thresholds?: NotePresentationThresholds
  readonly topZIndex?: number
  readonly onBringToFront: () => Effect.Effect<unknown, unknown>
  readonly onMove: (
    event: ReactPointerEvent,
    item: CanvasNote,
    onTap?: () => void
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
  const [view, setView] = useState(() => initialNotePresentationState(
    note.text,
    zoom,
    selected && selectMode && note.text.length === 0,
    thresholds
  ))
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
  const projected = notePresentation(text, zoom, view, thresholds)
  const visibleView = !selected || !selectMode
    ? dismissNotePresentation(projected.state)
    : projected.state
  const presentation = notePresentation(text, zoom, visibleView, thresholds)
  const expandedScreenWidth = viewport === null
    ? presentation.displayedWidth
    : Math.min(
        presentation.displayedWidth,
        Math.max(NOTE_COLLAPSED_SIZE, viewport.width - 32)
      )
  const displayedScreenWidth = presentation.mode === "expanded"
    ? expandedScreenWidth
    : presentation.displayedWidth
  const worldWidth = displayedScreenWidth / zoom
  const [measuredHeight, setMeasuredHeight] = useState(
    () => noteHeightForContent(NOTE_MINIMUM_TEXTAREA_HEIGHT, zoom)
  )
  const maximumExpandedScreenHeight = viewport === null
    ? NOTE_EXPANDED_MAXIMUM_HEIGHT
    : Math.min(
        NOTE_EXPANDED_MAXIMUM_HEIGHT,
        Math.max(NOTE_COLLAPSED_SIZE, viewport.height - 32)
      )
  const worldHeight = presentation.mode === "collapsed"
    ? NOTE_COLLAPSED_SIZE / zoom
    : presentation.mode === "expanded"
      ? Math.min(measuredHeight, maximumExpandedScreenHeight / zoom)
      : measuredHeight
  const naturalScreenLeft = geometry.x * zoom + cameraOffset.x
  const naturalScreenTop = geometry.y * zoom + cameraOffset.y
  const screenLeft = presentation.mode === "expanded" && viewport !== null
    ? Math.max(16, Math.min(
        viewport.width - displayedScreenWidth - 16,
        naturalScreenLeft
      ))
    : naturalScreenLeft
  const screenTop = presentation.mode === "expanded" && viewport !== null
    ? Math.max(16, Math.min(
        viewport.height - worldHeight * zoom - 16,
        naturalScreenTop
      ))
    : naturalScreenTop
  const presentedGeometry = noteFrameClearance({
    anchor: clearanceAnchor,
    geometry: {
      ...geometry,
      x: (screenLeft - cameraOffset.x) / zoom,
      y: (screenTop - cameraOffset.y) / zoom,
      width: worldWidth,
      height: worldHeight
    },
    frames: frameGeometries,
    zoom
  })

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
    setView((current) => {
      const next = notePresentation(text, zoom, current, thresholds).state
      const selectedView = selected && selectMode
        ? next
        : dismissNotePresentation(next)
      const resolved =
        selected && selectMode && text.length === 0
          ? activateNotePresentation(selectedView)
          : selectedView
      return resolved.automaticMode === current.automaticMode &&
        resolved.expanded === current.expanded
        ? current
        : resolved
    })
  }, [selectMode, selected, text, thresholds, zoom])

  useLayoutEffect(() => {
    if (presentation.mode === "collapsed") return
    const frame = globalThis.requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (textarea === null) return
      textarea.style.height = "auto"
      const nextHeight = noteHeightForContent(textarea.scrollHeight, zoom)
      textarea.style.height = `${noteTextareaHeight(nextHeight, zoom)}px`
      setMeasuredHeight((current) => current === nextHeight ? current : nextHeight)
    })
    return () => globalThis.cancelAnimationFrame(frame)
  }, [presentation.displayedWidth, presentation.mode, text, zoom])

  useLayoutEffect(() => {
    onPresentationSize?.(note.id, { width: worldWidth, height: worldHeight })
  }, [note.id, onPresentationSize, worldHeight, worldWidth])

  useLayoutEffect(() => {
    if (presentation.mode !== "expanded") return
    textareaRef.current?.focus()
  }, [presentation.mode])

  const measureAndFlush = () => {
    const textarea = textareaRef.current
    if (textarea !== null) {
      textarea.style.height = "auto"
      const nextHeight = noteHeightForContent(textarea.scrollHeight, zoom)
      textarea.style.height = `${noteTextareaHeight(nextHeight, zoom)}px`
      setMeasuredHeight(nextHeight)
    }
    editing.flush({ text: textRef.current })
  }

  const activate = () => setView((current) => activateNotePresentation(
    notePresentation(textRef.current, zoom, current, thresholds).state
  ))
  const dismiss = () => setView((current) => dismissNotePresentation(
    notePresentation(textRef.current, zoom, current, thresholds).state
  ))

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
        data-mode={presentation.mode}
        data-selected={selected || undefined}
        onKeyDownCapture={(event) => {
          if (event.key !== "Escape" || presentation.mode !== "expanded") return
          event.preventDefault()
          event.stopPropagation()
          dismiss()
        }}
        onPointerDown={(event) => onSelect(
          event.shiftKey || event.metaKey || event.ctrlKey
        )}
        ref={noteRef}
        style={cssVariableStyle({
          ...canvasItemStyle(
            presentedGeometry,
            presentation.mode === "expanded"
              ? topZIndex ?? note.zIndex
              : note.zIndex
          ),
          ...noteColorStyle(note.color),
          "--crit-ui": 1 / zoom,
          pointerEvents: selectMode ? "auto" : "none"
        })}
      >
        {presentation.mode === "collapsed" ? (
          <Button
            aria-label="Expand note"
            className="crit-note__collapsed"
            {...informationalHelpTarget({
              name: "Expand note",
              description: "Click to read this collapsed note or drag to reposition it."
            })}
            onClick={(event) => {
              if (event.detail !== 0) return
              onSelect()
              activate()
            }}
            onPointerDown={(event) => {
              event.stopPropagation()
              onSelect(event.shiftKey || event.metaKey || event.ctrlKey)
              onMove(event, { ...note, geometry: presentedGeometry }, activate)
            }}
            type="button"
          ><Glyph name="note" /></Button>
        ) : (
          <>
            {presentation.mode === "expanded" ? (
              <Button
                aria-label="Collapse note"
                className="crit-note__close"
                onClick={dismiss}
                onPointerDown={(event) => event.stopPropagation()}
                type="button"
              ><Glyph name="close" /></Button>
            ) : null}
            <textarea
              aria-label="Note"
              {...informationalHelpTarget({
                name: canEdit ? "Edit note" : `Note by ${note.author.name}`,
                description: canEdit
                  ? "Write review feedback. The note sizes itself to its content."
                  : "Only the Author can edit this note. You can select and move it."
              })}
              onBlur={() => {
                stopListeningForEditorBlurRef.current?.()
                stopListeningForEditorBlurRef.current = null
                measureAndFlush()
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
          </>
        )}
      </article>
    </CritContextActions>
  )
}
