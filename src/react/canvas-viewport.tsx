import {
  useHotkeys,
  type RegisterableHotkey
} from "@tanstack/react-hotkeys"
import { Effect } from "effect"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from "react"

import {
  CanvasCommand,
  type CanvasCommandFailed,
  type CanvasDocument,
  type CanvasFrame,
  type CanvasGeometry,
  type CanvasNote,
  type CommentAnchor,
  type CommentAuthor,
  type CommentMessage,
  type CanvasCommand as CanvasCommandValue
} from "../core/index.js"
import {
  connectCanvasInput,
  type FrameInputIntent
} from "../frame-bridge/index.js"
import {
  CritContextMenu,
  type ContextMenuPosition
} from "./canvas-context-menu.js"
import { critStyles } from "./crit-styles.js"
import {
  canvasCursor,
  type CanvasTool
} from "./canvas-cursors.js"
import type { ResizeHandlePosition } from "./canvas-selection.js"
import { beginCanvasInteraction } from "./canvas-interaction.js"
import { CanvasToolbar } from "./canvas-toolbar.js"
import {
  FrameCard,
  type FrameChromeSettings
} from "./frame-card.js"
import { frameStatus, shortIdForIndex } from "./frame-chrome.js"
import {
  initialCanvasCameraState,
  updateCanvasCamera,
  type CanvasCamera,
  type CanvasCameraInput,
  type CanvasCameraOptions
} from "./canvas-camera.js"
import { NewFrameDialog } from "./new-frame-dialog.js"
import { NoteCard } from "./note-card.js"
import { CommentPopover } from "./comment-popover.js"

export {
  DEFAULT_FRAME_CHROME_SETTINGS,
  FRAME_SIZE_PRESETS,
  frameChromeLayout,
  frameChromeMetrics,
  frameUiScale,
  frameToolbarMode,
  type FrameChromeAction,
  type FrameChromeLayout,
  type FrameChromeMetrics,
  type FrameChromeSettings,
  type FrameToolbarMode
} from "./frame-card.js"

type Camera = CanvasCamera
type Preview = Readonly<Record<string, CanvasGeometry>>
type WheelInput = Omit<
  Extract<FrameInputIntent, { readonly type: "wheel" }>,
  "type"
>

type CanvasZoomDirection = -1 | 0 | 1

const CRIT_HOTKEYS = {
  selectTool: "V",
  handTool: "H",
  addFrame: "F",
  addNote: "N",
  deleteSelection: "Backspace",
  zoomIn: [
    { key: "=", mod: true },
    { key: "=", mod: true, shift: true }
  ],
  zoomOut: [
    { key: "-", mod: true },
    { key: "-", mod: true, shift: true }
  ]
} as const satisfies {
  readonly selectTool: RegisterableHotkey
  readonly handTool: RegisterableHotkey
  readonly addFrame: RegisterableHotkey
  readonly addNote: RegisterableHotkey
  readonly deleteSelection: RegisterableHotkey
  readonly zoomIn: ReadonlyArray<RegisterableHotkey>
  readonly zoomOut: ReadonlyArray<RegisterableHotkey>
}


export interface CanvasViewportProps {
  readonly document: CanvasDocument
  readonly author?: CommentAuthor | null
  readonly dispatch: (
    ...commands: ReadonlyArray<CanvasCommandValue>
  ) => Effect.Effect<unknown, CanvasCommandFailed>
  readonly iframeAllow?: string
  readonly iframeSandbox?: string
  readonly onCommandError?: (message: string) => void
  readonly snapshotFrame?: (
    frameId: string
  ) => Effect.Effect<unknown, unknown>
  readonly frameChrome?: Partial<FrameChromeSettings>
  readonly cameraOptions?: Partial<CanvasCameraOptions>
}

const messageOf = (cause: unknown) =>
  typeof cause === "object" && cause !== null && "detail" in cause
    ? String(cause.detail)
    : cause instanceof Error
      ? cause.message
      : String(cause)

const localId = (prefix: string) =>
  `${prefix}-${
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  }`

const intersectsViewport = (
  geometry: CanvasGeometry,
  camera: Camera,
  width: number,
  height: number
) => {
  const margin = 500
  const left = geometry.x * camera.zoom + camera.x
  const top = geometry.y * camera.zoom + camera.y
  const right = left + geometry.width * camera.zoom
  const bottom = top + geometry.height * camera.zoom
  return (
    right >= -margin &&
    bottom >= -margin &&
    left <= width + margin &&
    top <= height + margin
  )
}

export function CanvasViewport({
  document,
  author = null,
  dispatch,
  iframeAllow = "clipboard-read; clipboard-write; fullscreen",
  iframeSandbox,
  onCommandError,
  snapshotFrame,
  frameChrome,
  cameraOptions
}: CanvasViewportProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const initialCameraState = useMemo(() => initialCanvasCameraState(), [])
  const [camera, setCamera] = useState<Camera>(initialCameraState.camera)
  const cameraStateRef = useRef(initialCameraState)
  const cameraOptionsRef = useRef(cameraOptions)
  cameraOptionsRef.current = cameraOptions
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [preview, setPreview] = useState<Preview>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tool, setTool] = useState<CanvasTool>("select")
  const [panning, setPanning] = useState(false)
  const [canvasMenu, setCanvasMenu] = useState<
    (ContextMenuPosition & { readonly worldX: number; readonly worldY: number }) | null
  >(null)
  const [newFrameTarget, setNewFrameTarget] = useState<{
    readonly x: number
    readonly y: number
  } | null>(null)
  const [commentTarget, setCommentTarget] = useState<{
    readonly frameId: string
    readonly anchor?: CommentAnchor
    readonly threadId?: string
  } | null>(null)
  const commitCameraState = useCallback(
    (next: ReturnType<typeof initialCanvasCameraState>) => {
      cameraStateRef.current = next
      setCamera(next.camera)
    },
    []
  )

  const applyCameraInput = useCallback((input: CanvasCameraInput) => {
    commitCameraState(updateCanvasCamera(
      cameraStateRef.current,
      input,
      cameraOptionsRef.current
    ))
  }, [commitCameraState])

  useEffect(() => {
    const root = rootRef.current
    if (root === null) return
    const update = () =>
      setViewport({ width: root.clientWidth, height: root.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (
      selectedId !== null &&
      !document.frames.some((frame) => frame.id === selectedId) &&
      !document.notes.some((note) => note.id === selectedId)
    ) {
      setSelectedId(null)
    }
  }, [document.frames, document.notes, selectedId])

  const run = useCallback(
    (...commands: ReadonlyArray<CanvasCommandValue>) => {
      Effect.runFork(
        dispatch(...commands).pipe(
          Effect.catch((cause) =>
            Effect.sync(() => onCommandError?.(messageOf(cause)))
          )
        )
      )
    },
    [dispatch, onCommandError]
  )

  const geometryOf = useCallback(
    (item: CanvasFrame | CanvasNote) => preview[item.id] ?? item.geometry,
    [preview]
  )

  const addNoteAt = useCallback((x: number, y: number) => {
    const id = localId("note")
    run(CanvasCommand.addNote({ id, text: "", x, y }))
    setSelectedId(id)
  }, [run])

  const addFrameAt = useCallback((url: string, title: string, x: number, y: number) => {
    const id = localId("frame")
    run(
      CanvasCommand.addFrame({
        id,
        url,
        title,
        provenance: { kind: "manual", sourceId: "browser" }
      }),
      CanvasCommand.moveFrame({ id, x, y })
    )
    setSelectedId(id)
  }, [run])

  const startPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    setSelectedId(null)
    setPanning(true)
    const start = { x: event.clientX, y: event.clientY, camera }
    event.currentTarget.setPointerCapture(event.pointerId)
    const move = (next: PointerEvent) =>
      commitCameraState(initialCanvasCameraState({
        ...start.camera,
        x: start.camera.x + next.clientX - start.x,
        y: start.camera.y + next.clientY - start.y
      }))
    const end = () => {
      setPanning(false)
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", end)
      window.removeEventListener("pointercancel", end)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", end, { once: true })
    window.addEventListener("pointercancel", end, { once: true })
  }

  const applyWheel = useCallback((event: WheelInput) => {
    const rect = rootRef.current?.getBoundingClientRect()
    if (rect === undefined) return
    applyCameraInput({ type: "wheel", ...event, origin: rect })
  }, [applyCameraInput])

  const applyPinchScale = useCallback((
    scaleFactor: number,
    clientX: number,
    clientY: number,
    deltaX: number,
    deltaY: number
  ) => {
    const rect = rootRef.current?.getBoundingClientRect()
    if (rect === undefined) return
    applyCameraInput({
      type: "pinch",
      scaleFactor,
      point: { x: clientX - rect.left, y: clientY - rect.top },
      deltaX,
      deltaY
    })
  }, [applyCameraInput])

  const applyZoomStep = useCallback((direction: CanvasZoomDirection) => {
    applyCameraInput({ type: "zoom-step", direction, viewport })
  }, [applyCameraInput, viewport])

  const openNewFrameAtCenter = useCallback(() => {
    setNewFrameTarget({
      x: (viewport.width / 2 - camera.x) / camera.zoom - 600,
      y: (viewport.height / 2 - camera.y) / camera.zoom - 400
    })
  }, [camera, viewport])

  const addNoteAtCenter = useCallback(() => {
    addNoteAt(
      (viewport.width / 2 - camera.x) / camera.zoom - 140,
      (viewport.height / 2 - camera.y) / camera.zoom - 80
    )
  }, [addNoteAt, camera, viewport])

  const deleteSelection = useCallback(() => {
    if (selectedId === null) return
    if (document.frames.some((frame) => frame.id === selectedId)) {
      run(CanvasCommand.removeFrame({ id: selectedId }))
    } else if (document.notes.some((note) => note.id === selectedId)) {
      run(CanvasCommand.removeNote({ id: selectedId }))
    }
    setSelectedId(null)
  }, [document.frames, document.notes, run, selectedId])

  useHotkeys([
    {
      hotkey: CRIT_HOTKEYS.selectTool,
      callback: () => setTool("select"),
      options: { ignoreInputs: true }
    },
    {
      hotkey: CRIT_HOTKEYS.handTool,
      callback: () => setTool("pan"),
      options: { ignoreInputs: true }
    },
    {
      hotkey: CRIT_HOTKEYS.addFrame,
      callback: openNewFrameAtCenter,
      options: { ignoreInputs: true }
    },
    {
      hotkey: CRIT_HOTKEYS.addNote,
      callback: addNoteAtCenter,
      options: { ignoreInputs: true }
    },
    {
      hotkey: CRIT_HOTKEYS.deleteSelection,
      callback: deleteSelection,
      options: { ignoreInputs: true }
    },
    ...CRIT_HOTKEYS.zoomIn.map((hotkey) => ({
      hotkey,
      callback: () => applyZoomStep(1),
      options: { ignoreInputs: false }
    })),
    ...CRIT_HOTKEYS.zoomOut.map((hotkey) => ({
      hotkey,
      callback: () => applyZoomStep(-1),
      options: { ignoreInputs: false }
    }))
  ], {
    preventDefault: true,
    stopPropagation: true
  })

  useEffect(() => {
    const root = rootRef.current
    if (root === null) return
    return connectCanvasInput({
      target: window,
      root,
      onIntent: (intent) => {
        if (intent.type === "wheel") {
          const { type: _type, ...wheel } = intent
          applyWheel(wheel)
        } else if (intent.type === "pinch") {
          applyPinchScale(
            intent.scaleFactor,
            intent.clientX,
            intent.clientY,
            intent.deltaX,
            intent.deltaY
          )
        }
      }
    })
  }, [applyPinchScale, applyWheel])

  useEffect(() => {
    const html = globalThis.document.documentElement
    const body = globalThis.document.body
    const previousHtml = html.style.overscrollBehaviorX
    const previousBody = body.style.overscrollBehaviorX
    html.style.overscrollBehaviorX = "none"
    body.style.overscrollBehaviorX = "none"
    return () => {
      html.style.overscrollBehaviorX = previousHtml
      body.style.overscrollBehaviorX = previousBody
    }
  }, [])

  const startMove = (
    event: ReactPointerEvent,
    item: CanvasFrame | CanvasNote
  ) => {
    event.preventDefault()
    event.stopPropagation()
    const start = { x: event.clientX, y: event.clientY, geometry: geometryOf(item) }
    const interaction = beginCanvasInteraction({
      document,
      itemId: item.id,
      startGeometry: start.geometry,
      kind: { type: "move" },
      geometryOverrides: preview
    })
    const deltaAt = (clientX: number, clientY: number) => ({
      x: (clientX - start.x) / camera.zoom,
      y: (clientY - start.y) / camera.zoom
    })
    const move = (next: PointerEvent) => {
      setPreview((current) => ({
        ...current,
        ...interaction.preview(deltaAt(next.clientX, next.clientY))
      }))
    }
    const end = (next: PointerEvent) => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", end)
      setPreview((current) => {
        const removedIds = new Set(interaction.affectedIds)
        return Object.fromEntries(
          Object.entries(current).filter(([id]) => !removedIds.has(id))
        )
      })
      run(...interaction.finish(deltaAt(next.clientX, next.clientY)))
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", end, { once: true })
  }

  const startResize = (
    event: ReactPointerEvent,
    item: CanvasFrame | CanvasNote,
    handle: ResizeHandlePosition
  ) => {
    event.preventDefault()
    event.stopPropagation()
    const start = { x: event.clientX, y: event.clientY, geometry: geometryOf(item) }
    const interaction = beginCanvasInteraction({
      document,
      itemId: item.id,
      startGeometry: start.geometry,
      kind: { type: "resize", handle },
      geometryOverrides: preview
    })
    const deltaAt = (clientX: number, clientY: number) => ({
      x: (clientX - start.x) / camera.zoom,
      y: (clientY - start.y) / camera.zoom
    })
    const move = (next: PointerEvent) => {
      setPreview((current) => ({
        ...current,
        ...interaction.preview(deltaAt(next.clientX, next.clientY))
      }))
    }
    const end = (next: PointerEvent) => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", end)
      setPreview((current) => {
        const removedIds = new Set(interaction.affectedIds)
        return Object.fromEntries(
          Object.entries(current).filter(([id]) => !removedIds.has(id))
        )
      })
      run(...interaction.finish(deltaAt(next.clientX, next.clientY)))
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", end, { once: true })
  }

  const fit = () => {
    const items = [...document.frames, ...document.notes]
    applyCameraInput({
      type: "fit",
      geometries: items.map((item) => item.geometry),
      viewport
    })
  }

  const sortedItems = useMemo(
    () =>
      [...document.frames, ...document.notes].sort(
        (left, right) => left.zIndex - right.zIndex
      ),
    [document]
  )
  const activeComments = useMemo(() => document.comments.filter((thread) => thread.resolvedAt === null), [document.comments])
  const commentThread = commentTarget?.threadId === undefined ? undefined : document.comments.find((thread) => thread.id === commentTarget.threadId)
  const commentFrame = commentTarget === null ? undefined : document.frames.find((frame) => frame.id === commentTarget.frameId)
  const commentGeometry = commentFrame === undefined ? undefined : geometryOf(commentFrame)
  const commentStatusColor = frameStatus(commentFrame?.status ?? "archived").ink
  const makeCommentMessage = (body: string): CommentMessage => ({ id: localId("comment"), body, author: author!, createdAt: new Date().toISOString(), editedAt: null })

  return (
    <div
      className="crit-canvas"
      ref={rootRef}
      onContextMenu={(event) => {
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        const rect = event.currentTarget.getBoundingClientRect()
        setCanvasMenu({
          x: event.clientX,
          y: event.clientY,
          worldX: (event.clientX - rect.left - camera.x) / camera.zoom,
          worldY: (event.clientY - rect.top - camera.y) / camera.zoom
        })
      }}
      data-canvas-tool={tool}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) setSelectedId(null)
      }}
      style={{
        "--crit-canvas-cursor": canvasCursor(tool, panning),
        height: "100%",
        minHeight: 420,
        overflow: "clip",
        overscrollBehavior: "none",
        overscrollBehaviorX: "none",
        position: "relative",
        touchAction: "none",
        width: "100%"
      } as CSSProperties}
    >
      <style data-crit-styles="">{critStyles}</style>
      <div
        className="crit-canvas__plane"
        style={{
          transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`
        }}
      >
        {sortedItems.map((item) =>
          "url" in item ? (
            <FrameCard
              key={item.id}
              frame={item}
              {...(frameChrome === undefined ? {} : { frameChrome })}
              shortId={shortIdForIndex(
                document.frames.findIndex((frame) => frame.id === item.id)
              )}
              geometry={geometryOf(item)}
              zoom={camera.zoom}
              iframeAllow={iframeAllow}
              {...(iframeSandbox === undefined ? {} : { iframeSandbox })}
              iframeVisible={intersectsViewport(
                geometryOf(item), camera, viewport.width, viewport.height
              )}
              selected={selectedId === item.id}
              commentMode={tool === "comment"}
              commentThreads={activeComments.filter((thread) => thread.frameId === item.id)}
              {...(commentTarget?.frameId === item.id && commentTarget.threadId !== undefined
                ? { openCommentId: commentTarget.threadId }
                : {})}
              onCommentAnchor={(anchor) => {
                if (author === null) return onCommandError?.("Configure Git user.name and user.email to leave comments")
                setCommentTarget({ frameId: item.id, anchor })
              }}
              onOpenComment={(threadId) => setCommentTarget({ frameId: item.id, threadId })}
              onSelect={() => setSelectedId(item.id)}
              onInputIntent={(intent) => {
                if (intent.type === "select") {
                  setSelectedId(item.id)
                } else if (intent.type === "delete") {
                  run(CanvasCommand.removeFrame({ id: item.id }))
                  setSelectedId(null)
                } else if (intent.type === "tool") {
                  setTool(intent.tool)
                } else if (intent.type === "zoom-step") {
                  applyZoomStep(intent.direction)
                } else if (intent.type === "pinch") {
                  applyPinchScale(
                    intent.scaleFactor,
                    intent.clientX,
                    intent.clientY,
                    intent.deltaX,
                    intent.deltaY
                  )
                } else if (intent.type === "wheel") {
                  const { type: _type, ...wheel } = intent
                  applyWheel(wheel)
                }
              }}
              onMove={(event, frame) => {
                setSelectedId(frame.id)
                startMove(event, frame)
              }}
              onBringToFront={() =>
                run(CanvasCommand.bringFrameToFront({ id: item.id }))
              }
              onRemove={() => run(CanvasCommand.removeFrame({ id: item.id }))}
              onFitContent={(height) =>
                run(
                  CanvasCommand.updateFrame({
                    id: item.id,
                    changes: { display: { heightMode: "fit-page" } }
                  }),
                  CanvasCommand.resizeFrame({
                    id: item.id,
                    width: geometryOf(item).width,
                    height
                  })
                )
              }
              onSetSize={(width, height) =>
                run(
                  CanvasCommand.updateFrame({
                    id: item.id,
                    changes: { display: { heightMode: "viewport" } }
                  }),
                  CanvasCommand.resizeFrame({ id: item.id, width, height })
                )
              }
              onResize={startResize}
              {...(snapshotFrame === undefined
                ? {}
                : { onSnapshot: () => snapshotFrame(item.id) })}
              onSnapshotError={(cause) => onCommandError?.(messageOf(cause))}
              onSendToBack={() =>
                run(CanvasCommand.sendFrameToBack({ id: item.id }))
              }
              onStatus={(status) =>
                run(CanvasCommand.setFrameStatus({ id: item.id, status }))
              }
              onTitle={(title) =>
                run(CanvasCommand.updateFrame({ id: item.id, changes: { title } }))
              }
            />
          ) : (
            <NoteCard
              key={item.id}
              note={item}
              geometry={geometryOf(item)}
              selected={selectedId === item.id}
              zoom={camera.zoom}
              onSelect={() => setSelectedId(item.id)}
              onBringToFront={() =>
                run(CanvasCommand.bringNoteToFront({ id: item.id }))
              }
              onMove={startMove}
              onRemove={() => run(CanvasCommand.removeNote({ id: item.id }))}
              onResize={startResize}
              onSendToBack={() =>
                run(CanvasCommand.sendNoteToBack({ id: item.id }))
              }
              onText={(expectedText, text) =>
                run(CanvasCommand.updateNote({ id: item.id, expectedText, text }))
              }
            />
          )
        )}
        {commentTarget !== null &&
        author !== null &&
        commentFrame?.snapshot === undefined &&
        commentGeometry !== undefined &&
        (commentTarget.anchor !== undefined || commentThread !== undefined) ? (
          <CommentPopover
            key={commentTarget.threadId ?? "new-comment"}
            author={author}
            frameGeometry={commentGeometry}
            owner={document.owner}
            statusColor={commentStatusColor}
            {...(commentThread === undefined ? {} : { thread: commentThread })}
            zoom={camera.zoom}
            onClose={() => setCommentTarget(null)}
            onCreate={(body) => {
              if (commentTarget.anchor === undefined) return
              run(CanvasCommand.addCommentThread({
                id: localId("thread"),
                frameId: commentTarget.frameId,
                anchor: commentTarget.anchor,
                opening: makeCommentMessage(body)
              }))
              setCommentTarget(null)
            }}
            onEdit={(message, expectedBody, body) => {
              if (commentThread === undefined) return
              run(CanvasCommand.editComment({
                id: commentThread.id,
                commentId: message.id,
                actorId: author.id,
                expectedBody,
                body,
                editedAt: new Date().toISOString()
              }))
            }}
            onReply={(body) => {
              if (commentThread === undefined) return
              run(CanvasCommand.replyToCommentThread({
                id: commentThread.id,
                reply: makeCommentMessage(body)
              }))
            }}
            onResolve={(resolved) => {
              if (commentThread === undefined) return
              run(CanvasCommand.setCommentThreadResolved({
                id: commentThread.id,
                actor: author,
                resolved,
                at: new Date().toISOString()
              }))
            }}
          />
        ) : null}
      </div>
      {tool === "pan" ? (
        <div
          aria-hidden="true"
          className="crit-canvas__pan-shield"
          data-panning={panning ? "true" : "false"}
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={startPan}
        />
      ) : null}
      <CanvasToolbar
        commentAvailable={author !== null}
        onAction={(action) => {
          if (action === "select") setTool("select")
          else if (action === "pan") setTool("pan")
          else if (action === "add-frame") openNewFrameAtCenter()
          else if (action === "add-note") addNoteAtCenter()
          else if (action === "comment") setTool("comment")
        }}
        title={document.title}
        tool={tool}
      />
      <CritContextMenu
        ariaLabel="Canvas actions"
        items={canvasMenu === null ? [] : [
          {
            help: "Add a live web page at the point where the canvas menu opened.",
            label: "New frame",
            onSelect: () => setNewFrameTarget({
              x: canvasMenu.worldX,
              y: canvasMenu.worldY
            })
          },
          {
            help: "Add an editable note at the point where the canvas menu opened.",
            label: "New note",
            onSelect: () => addNoteAt(canvasMenu.worldX, canvasMenu.worldY)
          },
          {
            help: "Adjust the view so every frame and note is visible.",
            label: "Zoom to fit",
            onSelect: fit
          }
        ]}
        onClose={() => setCanvasMenu(null)}
        position={canvasMenu}
      />
      <NewFrameDialog
        onCancel={() => setNewFrameTarget(null)}
        onCreate={(url, title) => {
          if (newFrameTarget === null) return
          addFrameAt(url, title, newFrameTarget.x, newFrameTarget.y)
          setNewFrameTarget(null)
        }}
        onError={(message) => onCommandError?.(message)}
        open={newFrameTarget !== null}
      />
    </div>
  )
}
