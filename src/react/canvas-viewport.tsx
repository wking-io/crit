import { useHotkeys } from "@tanstack/react-hotkeys"
import { Effect } from "effect"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from "react"

import {
  CanvasCommand,
  canManageCommentThread,
  type CanvasCommandFailed,
  type CanvasDocument,
  type CanvasFrame,
  type CanvasGeometry,
  type CanvasNote,
  type Author,
  type CanvasCommand as CanvasCommandValue
} from "../core/index.js"
import {
  connectCanvasInput,
  type FrameInputIntent
} from "../frame-bridge/index.js"
import { cssVariableStyle } from "./css-variable-style.js"
import {
  CritContextMenu,
  type ContextMenuPosition
} from "./canvas-context-menu.js"
import {
  CanvasActionRunnerProvider,
  useCanvasActionRunner,
  useCanvasControls
} from "./canvas-action-runner.js"
import { tanStackHotkeysForAction } from "./canvas-controls.js"
import {
  CanvasArrangement,
  type CanvasArrangementOperation
} from "./canvas-arrangement.js"
import { critStyles } from "./crit-styles.js"
import {
  canvasCursor,
  type CanvasTool
} from "./canvas-cursors.js"
import {
  frameIdsIntersectingSelectionBox,
  isAdditiveFrameSelection,
  selectCanvasFrame,
  selectCanvasFrameForMove,
  selectCanvasFramesInBox,
  selectionBoxBetween,
  type CanvasSelectionBox
} from "./canvas-frame-selection.js"
import type { ResizeHandlePosition } from "./canvas-selection.js"
import {
  beginCanvasInteraction,
  canvasDragDelta,
  canvasEdgePanVelocity,
  captureCanvasInteractionPointer
} from "./canvas-interaction.js"
import { CanvasToolbar } from "./canvas-toolbar.js"
import {
  FrameCard,
  type FrameChromeSettings
} from "./frame-card.js"
import {
  frameIframeUrl,
  type FrameLoadingPolicy
} from "./frame-loading.js"
import { frameStatus, shortIdForIndex } from "./frame-chrome.js"
import {
  completeFrameBreakpointSet,
  duplicateFrameAtPreset,
  type FrameSizePreset
} from "./frame-breakpoints.js"
import {
  initialCanvasCameraState,
  updateCanvasCamera,
  type CanvasCamera,
  type CanvasCameraInput,
  type CanvasCameraOptions
} from "./canvas-camera.js"
import { NewFrameDialog } from "./new-frame-dialog.js"
import { NoteCard } from "./note-card.js"
import {
  CommentPopover,
  type CommentDraftClear
} from "./comment-popover.js"
import {
  makeCommentThreadReview,
  type CommentThreadReviewTarget,
  type CommentThreadReviewTransition
} from "../session/comment-thread-review.js"

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


export interface CanvasViewportProps {
  readonly document: CanvasDocument
  readonly author?: Author | null
  readonly dispatch: (
    ...commands: ReadonlyArray<CanvasCommandValue>
  ) => Effect.Effect<unknown, CanvasCommandFailed>
  readonly iframeAllow?: string
  readonly iframeSandbox?: string
  readonly frameLoading?: FrameLoadingPolicy
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

export function CanvasViewport(props: CanvasViewportProps) {
  return (
    <CanvasActionRunnerProvider
      onError={(cause) => props.onCommandError?.(messageOf(cause))}
    >
      <CanvasViewportContent {...props} />
    </CanvasActionRunnerProvider>
  )
}

function CanvasViewportContent({
  document,
  author = null,
  dispatch,
  iframeAllow = "clipboard-read; clipboard-write; fullscreen",
  iframeSandbox,
  frameLoading,
  onCommandError,
  snapshotFrame,
  frameChrome,
  cameraOptions
}: CanvasViewportProps) {
  const controls = useCanvasControls(["canvas"], author !== null)
  const actionRunner = useCanvasActionRunner()
  const rootRef = useRef<HTMLDivElement>(null)
  const initialCameraState = useMemo(() => initialCanvasCameraState(), [])
  const [camera, setCamera] = useState<Camera>(initialCameraState.camera)
  const cameraStateRef = useRef(initialCameraState)
  const cameraOptionsRef = useRef(cameraOptions)
  cameraOptionsRef.current = cameraOptions
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [preview, setPreview] = useState<Preview>({})
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const frameIds = useMemo(
    () => new Set(document.frames.map((frame) => frame.id)),
    [document.frames]
  )
  const selectedFrameIds = useMemo(
    () => new Set([...selectedIds].filter((id) => frameIds.has(id))),
    [frameIds, selectedIds]
  )
  const [selectionMarquee, setSelectionMarquee] =
    useState<CanvasSelectionBox | null>(null)
  const [tool, setTool] = useState<CanvasTool>("select")
  const [panning, setPanning] = useState(false)
  const [canvasMenu, setCanvasMenu] = useState<
    (ContextMenuPosition & { readonly worldX: number; readonly worldY: number }) | null
  >(null)
  const [newFrameTarget, setNewFrameTarget] = useState<{
    readonly x: number
    readonly y: number
  } | null>(null)
  const commentReviewRef = useRef<ReturnType<typeof makeCommentThreadReview> | null>(null)
  commentReviewRef.current ??= makeCommentThreadReview({
    document,
    currentAuthor: author,
    clock: { now: () => new Date().toISOString() },
    ids: {
      commentThreadId: () => localId("thread"),
      commentId: () => localId("comment")
    }
  })
  const [commentReview, setCommentReview] = useState(
    commentReviewRef.current.state()
  )
  const [commentDraftDirty, setCommentDraftDirty] = useState(false)
  const [commentDraftClear, setCommentDraftClear] =
    useState<CommentDraftClear | null>(null)
  const commentDraftClearVersion = useRef(0)
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
    const validIds = new Set([
      ...document.frames.map((frame) => frame.id),
      ...document.notes.map((note) => note.id)
    ])
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => validIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [document.frames, document.notes])

  const selectFrame = useCallback((frameId: string, additive: boolean) => {
    setSelectedIds((current) => selectCanvasFrame(current, frameId, additive))
  }, [])

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

  const presentCommentReview = useCallback((
    transition: CommentThreadReviewTransition
  ) => {
    const adopt = (next: CommentThreadReviewTransition) => {
      setCommentReview(next.state)
      if (next.type === "changed" && next.clearDraft !== undefined) {
        commentDraftClearVersion.current += 1
        setCommentDraftClear({
          version: commentDraftClearVersion.current,
          scope: next.clearDraft
        })
      }
    }

    return Effect.sync(() => adopt(transition)).pipe(
      Effect.flatMap(() => transition.type !== "dispatch"
        ? Effect.void
        : dispatch(...transition.commands).pipe(
            Effect.tapError((cause) => Effect.sync(() => adopt(
              commentReviewRef.current!.settle(transition.key, {
                type: "rejected",
                cause
              })
            ))),
            Effect.tap(() => Effect.sync(() => adopt(
              commentReviewRef.current!.settle(transition.key, {
                type: "accepted"
              })
            )))
          ))
    )
  }, [dispatch])

  const focusCommentReview = useCallback((
    target: CommentThreadReviewTarget | null
  ) => {
    let transition = commentReviewRef.current!.focus(target, {
      draft: commentDraftDirty ? "dirty" : "clean"
    })
    if (
      transition.type === "blocked" &&
      transition.reason === "dirty-draft" &&
      typeof globalThis.confirm === "function" &&
      globalThis.confirm("Discard the unfinished comment?")
    ) {
      transition = commentReviewRef.current!.focus(target, {
        draft: "dirty",
        discardDraft: true
      })
    }
    if (transition.type !== "blocked" || transition.reason === "dirty-draft") {
      return presentCommentReview(transition)
    }
    const detail = transition.reason === "current-author-required"
      ? "Configure Git user.name and user.email to leave comments"
      : transition.reason === "archived-frame"
        ? "Archived Frames do not support comments"
        : transition.reason === "dispatch-pending"
          ? "Wait for the current Comment action to finish"
          : "The Comment target is no longer available"
    return Effect.sync(() => onCommandError?.(detail))
  }, [commentDraftDirty, onCommandError, presentCommentReview])

  useEffect(() => {
    Effect.runFork(presentCommentReview(
      commentReviewRef.current!.reconcile(document, author)
    ).pipe(Effect.catch(() => Effect.void)))
  }, [author, document, presentCommentReview])

  const geometryOf = useCallback(
    (item: CanvasFrame | CanvasNote) => preview[item.id] ?? item.geometry,
    [preview]
  )

  const selectedItems = useMemo(
    () => [...document.frames, ...document.notes]
      .filter((item) => selectedIds.has(item.id))
      .map((item) => ({ ...item, geometry: geometryOf(item) })),
    [document.frames, document.notes, geometryOf, selectedIds]
  )

  const arrangeSelection = useCallback((operation: CanvasArrangementOperation) =>
    CanvasArrangement.plan({
      operation,
      items: selectedItems.map((item) => ({
        id: item.id,
        ...item.geometry
      }))
    }).pipe(
      Effect.flatMap((plan) => {
        const moves = new Map(plan.moves.map((move) => [move.id, move]))
        const changed = (item: (typeof selectedItems)[number]) => {
          const move = moves.get(item.id)!
          return Math.abs(move.x - item.geometry.x) > Number.EPSILON ||
            Math.abs(move.y - item.geometry.y) > Number.EPSILON
        }
        const frameCommands = selectedItems
          .filter((item): item is CanvasFrame & { readonly geometry: CanvasGeometry } =>
            "url" in item && changed(item)
          )
          .map((frame) => {
            const move = moves.get(frame.id)!
            return CanvasCommand.moveFrame({ id: frame.id, x: move.x, y: move.y })
          })
        const noteCommands = selectedItems
          .filter((item): item is CanvasNote & { readonly geometry: CanvasGeometry } =>
            !("url" in item) && changed(item)
          )
          .map((note) => {
            const move = moves.get(note.id)!
            return CanvasCommand.moveNote({ id: note.id, x: move.x, y: move.y })
          })
        const commands = [...frameCommands, ...noteCommands]
        return commands.length === 0 ? Effect.void : dispatch(...commands)
      })
    ), [dispatch, selectedItems])

  const addNoteAt = useCallback((x: number, y: number) => {
    if (author === null) {
      return Effect.fail(new Error(
        "Configure Git user.name and user.email to add notes"
      ))
    }
    const id = localId("note")
    return dispatch(CanvasCommand.addNote({ id, text: "", author, x, y })).pipe(
      Effect.tap(() => Effect.sync(() => setSelectedIds(new Set([id]))))
    )
  }, [author, dispatch])

  const addFrameAt = useCallback((url: string, title: string, x: number, y: number) => {
    const id = localId("frame")
    return dispatch(
      CanvasCommand.addFrame({
        id,
        url,
        title,
        provenance: { kind: "manual", sourceId: "browser" }
      }),
      CanvasCommand.moveFrame({ id, x, y })
    ).pipe(Effect.tap(() => Effect.sync(() => setSelectedIds(new Set([id])))))
  }, [dispatch])

  const duplicateFrame = useCallback((
    frameId: string,
    preset?: FrameSizePreset
  ) => {
    const commands = preset === undefined
      ? completeFrameBreakpointSet({
          document,
          sourceId: frameId,
          createId: () => localId("frame")
        })
      : duplicateFrameAtPreset({
          document,
          sourceId: frameId,
          preset,
          createId: () => localId("frame")
        })
    return commands.length > 0 ? dispatch(...commands) : Effect.void
  }, [dispatch, document])

  const startSelectionMarquee = (
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    if (event.button !== 0) return
    event.preventDefault()
    captureCanvasInteractionPointer(event)
    const rect = event.currentTarget.getBoundingClientRect()
    const start = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    }
    const additive = isAdditiveFrameSelection(event)
    const initialSelection = additive
      ? selectedIds
      : new Set<string>()
    const itemTargets = [...document.frames, ...document.notes].map((item) => ({
      id: item.id,
      geometry: geometryOf(item)
    }))
    let dragged = false
    if (!additive) setSelectedIds(initialSelection)

    const move = (next: PointerEvent) => {
      const current = {
        x: next.clientX - rect.left,
        y: next.clientY - rect.top
      }
      if (!dragged && Math.hypot(current.x - start.x, current.y - start.y) < 3) {
        return
      }
      dragged = true
      setSelectionMarquee(selectionBoxBetween(start, current))
      const worldBox = selectionBoxBetween(
        {
          x: (start.x - camera.x) / camera.zoom,
          y: (start.y - camera.y) / camera.zoom
        },
        {
          x: (current.x - camera.x) / camera.zoom,
          y: (current.y - camera.y) / camera.zoom
        }
      )
      setSelectedIds(selectCanvasFramesInBox(
        initialSelection,
        frameIdsIntersectingSelectionBox(itemTargets, worldBox),
        additive
      ))
    }
    const cleanup = () => {
      setSelectionMarquee(null)
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", end)
      window.removeEventListener("pointercancel", cancel)
    }
    const end = () => cleanup()
    const cancel = () => {
      setSelectedIds(initialSelection)
      cleanup()
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", end, { once: true })
    window.addEventListener("pointercancel", cancel, { once: true })
  }

  const startPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    setSelectedIds(new Set())
    setPanning(true)
    const start = { x: event.clientX, y: event.clientY, camera }
    captureCanvasInteractionPointer(event)
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
    return addNoteAt(
      (viewport.width / 2 - camera.x) / camera.zoom - 140,
      (viewport.height / 2 - camera.y) / camera.zoom - 80
    )
  }, [addNoteAt, camera, viewport])

  const selectedFramesForRemoval = document.frames.filter((frame) =>
    selectedFrameIds.has(frame.id)
  )
  const selectedNoteForRemoval = document.notes.find((candidate) =>
    selectedIds.has(candidate.id)
  )
  const removalTarget = selectedFramesForRemoval.length > 0
    ? {
        kind: "frame" as const,
        id: selectedFramesForRemoval.map((frame) => frame.id).sort().join(","),
        label: selectedFramesForRemoval.length === 1
          ? selectedFramesForRemoval[0]!.title
          : `${selectedFramesForRemoval.length} frames`
      }
    : selectedNoteForRemoval === undefined
      ? { kind: "note" as const, id: "none", label: "note" }
      : { kind: "note" as const, id: selectedNoteForRemoval.id, label: "note" }
  const removeSelectionAction = removalTarget.kind === "frame"
    ? controls.action({ id: "remove-item", target: removalTarget })
    : controls.action({
        id: "remove-item",
        target: removalTarget,
        currentAuthorIsTargetAuthor:
          selectedNoteForRemoval !== undefined &&
          author?.id === selectedNoteForRemoval.author.id
      })
  const deleteSelection = useCallback(() => {
    const effect = selectedFramesForRemoval.length > 0
      ? dispatch(...selectedFramesForRemoval.map((frame) =>
          CanvasCommand.removeFrame({ id: frame.id })
        ))
      : selectedNoteForRemoval !== undefined && author !== null
        ? dispatch(CanvasCommand.removeNote({
            id: selectedNoteForRemoval.id,
            actorId: author.id
          }))
        : Effect.void
    actionRunner.run(
      controls,
      removeSelectionAction,
      effect.pipe(Effect.tap(() => Effect.sync(() => setSelectedIds(new Set())))),
      (cause) => onCommandError?.(messageOf(cause))
    )
  }, [
    actionRunner,
    author,
    controls,
    dispatch,
    onCommandError,
    removeSelectionAction,
    selectedFramesForRemoval,
    selectedNoteForRemoval
  ])

  const selectAction = controls.action({ id: "select-tool" })
  const handAction = controls.action({ id: "hand-tool" })
  const openFrameAction = controls.action({ id: "open-new-frame" })
  const createNoteAction = controls.action({ id: "create-note" })
  const zoomInAction = controls.action({ id: "zoom-in" })
  const zoomOutAction = controls.action({ id: "zoom-out" })
  const hotkeys = (
    action: typeof selectAction,
    callback: () => void,
    ignoreInputs: boolean
  ) => tanStackHotkeysForAction(action).map((hotkey) => ({
    hotkey,
    callback,
    options: {
      enabled: action.availability === "enabled",
      ignoreInputs
    }
  }))

  useHotkeys([
    ...hotkeys(selectAction, () => actionRunner.run(
      controls,
      selectAction,
      Effect.sync(() => setTool("select"))
    ), true),
    ...hotkeys(handAction, () => actionRunner.run(
      controls,
      handAction,
      Effect.sync(() => setTool("pan"))
    ), true),
    ...hotkeys(openFrameAction, () => actionRunner.run(
      controls,
      openFrameAction,
      Effect.sync(openNewFrameAtCenter)
    ), true),
    ...hotkeys(createNoteAction, () => actionRunner.run(
      controls,
      createNoteAction,
      addNoteAtCenter(),
      (cause) => onCommandError?.(messageOf(cause))
    ), true),
    ...hotkeys(removeSelectionAction, deleteSelection, true),
    ...hotkeys(zoomInAction, () => actionRunner.run(
      controls,
      zoomInAction,
      Effect.sync(() => applyZoomStep(1))
    ), false),
    ...hotkeys(zoomOutAction, () => actionRunner.run(
      controls,
      zoomOutAction,
      Effect.sync(() => applyZoomStep(-1))
    ), false)
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
    item: CanvasFrame | CanvasNote,
    selectedFrameIds?: ReadonlySet<string>
  ) => {
    event.preventDefault()
    event.stopPropagation()
    captureCanvasInteractionPointer(event)
    const start = {
      pointer: { x: event.clientX, y: event.clientY },
      camera: cameraStateRef.current.camera,
      geometry: geometryOf(item)
    }
    const pointer = { ...start.pointer }
    const interaction = beginCanvasInteraction({
      document,
      itemId: item.id,
      startGeometry: start.geometry,
      kind: { type: "move" },
      geometryOverrides: preview,
      ...(selectedFrameIds === undefined ? {} : { selectedFrameIds })
    })
    const deltaAt = () => canvasDragDelta({
      pointer,
      startPointer: start.pointer,
      camera: cameraStateRef.current.camera,
      startCamera: start.camera,
      zoom: start.camera.zoom
    })
    const updatePreview = () => {
      setPreview((current) => ({
        ...current,
        ...interaction.preview(deltaAt())
      }))
    }
    const move = (next: PointerEvent) => {
      pointer.x = next.clientX
      pointer.y = next.clientY
      updatePreview()
    }
    let animationFrame = 0
    let previousFrameTime: number | undefined
    const autoPan = (time: number) => {
      const bounds = rootRef.current?.getBoundingClientRect()
      if (bounds !== undefined && previousFrameTime !== undefined) {
        const elapsed = Math.min(time - previousFrameTime, 32) / 1_000
        const velocity = canvasEdgePanVelocity(pointer, bounds)
        if (velocity.x !== 0 || velocity.y !== 0) {
          applyCameraInput({
            type: "pan",
            deltaX: velocity.x * elapsed,
            deltaY: velocity.y * elapsed
          })
          updatePreview()
        }
      }
      previousFrameTime = time
      animationFrame = window.requestAnimationFrame(autoPan)
    }
    animationFrame = window.requestAnimationFrame(autoPan)
    const cleanUp = () => {
      window.cancelAnimationFrame(animationFrame)
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", end)
      window.removeEventListener("pointercancel", cancel)
      setPreview((current) => {
        const removedIds = new Set(interaction.affectedIds)
        return Object.fromEntries(
          Object.entries(current).filter(([id]) => !removedIds.has(id))
        )
      })
    }
    const end = (next: PointerEvent) => {
      pointer.x = next.clientX
      pointer.y = next.clientY
      cleanUp()
      run(...interaction.finish(deltaAt()))
    }
    const cancel = () => cleanUp()
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", end, { once: true })
    window.addEventListener("pointercancel", cancel, { once: true })
  }

  const startResize = (
    event: ReactPointerEvent,
    item: CanvasFrame | CanvasNote,
    handle: ResizeHandlePosition
  ) => {
    event.preventDefault()
    event.stopPropagation()
    captureCanvasInteractionPointer(event)
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
  const commentThread = commentReview.kind === "thread"
    ? commentReview.thread
    : undefined
  const commentFrame = commentReview.kind === "idle"
    ? undefined
    : document.frames.find((frame) => frame.id === commentReview.frameId)
  const commentGeometry = commentFrame === undefined ? undefined : geometryOf(commentFrame)
  const commentStatusColor = frameStatus(commentFrame?.status ?? "archived").ink

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
        if (event.target !== event.currentTarget) return
        if (tool === "select") startSelectionMarquee(event)
        else if (!isAdditiveFrameSelection(event)) setSelectedIds(new Set())
      }}
      style={cssVariableStyle({
        "--crit-canvas-cursor": canvasCursor(tool, panning),
        height: "100%",
        minHeight: 420,
        overflow: "clip",
        overscrollBehavior: "none",
        overscrollBehaviorX: "none",
        position: "relative",
        touchAction: "none",
        width: "100%"
      })}
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
              iframeUrl={frameIframeUrl(document.id, item, frameLoading)}
              {...(iframeSandbox === undefined ? {} : { iframeSandbox })}
              iframeVisible={intersectsViewport(
                geometryOf(item), camera, viewport.width, viewport.height
              )}
              selected={selectedIds.has(item.id)}
              commentMode={tool === "comment"}
              commentThreads={activeComments.filter((thread) => thread.frameId === item.id)}
              {...(commentReview.kind === "thread" && commentReview.frameId === item.id
                ? { openCommentId: commentReview.threadId }
                : {})}
              onCommentAnchor={(anchor) => {
                return focusCommentReview({ kind: "new", frameId: item.id, anchor })
              }}
              onCompleteBreakpoints={() => duplicateFrame(item.id)}
              onDuplicateAt={(preset) => duplicateFrame(item.id, preset)}
              onOpenComment={(threadId) => {
                return focusCommentReview({ kind: "thread", threadId })
              }}
              onSelect={(additive = false) =>
                selectFrame(item.id, additive)}
              onInputIntent={(intent) => {
                if (intent.type === "select") {
                  selectFrame(item.id, intent.additive)
                } else if (intent.type === "delete") {
                  const ids = selectedFrameIds.has(item.id)
                    ? document.frames.filter((frame) =>
                        selectedFrameIds.has(frame.id)
                      )
                    : [item]
                  const action = controls.action({
                    id: "remove-item",
                    target: {
                      kind: "frame",
                      id: ids.map((frame) => frame.id).sort().join(","),
                      label: ids.length === 1 ? ids[0]!.title : `${ids.length} frames`
                    }
                  })
                  actionRunner.run(
                    controls,
                    action,
                    dispatch(...ids.map((frame) =>
                      CanvasCommand.removeFrame({ id: frame.id })
                    )).pipe(Effect.tap(() => Effect.sync(() => setSelectedIds(new Set())))),
                    (cause) => onCommandError?.(messageOf(cause))
                  )
                } else if (intent.type === "tool") {
                  const action = controls.action({
                    id: intent.tool === "select" ? "select-tool" : "hand-tool"
                  })
                  actionRunner.run(
                    controls,
                    action,
                    Effect.sync(() => setTool(intent.tool))
                  )
                } else if (intent.type === "zoom-step") {
                  const action = controls.action({
                    id: intent.direction > 0 ? "zoom-in" : "zoom-out"
                  })
                  actionRunner.run(
                    controls,
                    action,
                    Effect.sync(() => applyZoomStep(intent.direction))
                  )
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
                const selection = selectCanvasFrameForMove(
                  selectedIds,
                  frame.id,
                  isAdditiveFrameSelection(event)
                )
                setSelectedIds(selection)
                startMove(
                  event,
                  frame,
                  new Set([...selection].filter((id) => frameIds.has(id)))
                )
              }}
              onBringToFront={() =>
                dispatch(CanvasCommand.bringFrameToFront({ id: item.id }))
              }
              onRemove={() => dispatch(CanvasCommand.removeFrame({ id: item.id }))}
              onFitContent={(height) =>
                dispatch(
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
                dispatch(
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
                dispatch(CanvasCommand.sendFrameToBack({ id: item.id }))
              }
              onStatus={(status) =>
                dispatch(CanvasCommand.setFrameStatus({ id: item.id, status }))
              }
              onTitle={(title) =>
                dispatch(CanvasCommand.updateFrame({ id: item.id, changes: { title } }))
              }
            />
          ) : (
            <NoteCard
              author={author}
              commit={run}
              execute={dispatch}
              key={item.id}
              note={item}
              geometry={geometryOf(item)}
              selected={selectedIds.has(item.id)}
              zoom={camera.zoom}
              onSelect={(additive = false) => setSelectedIds((current) =>
                selectCanvasFrame(current, item.id, additive)
              )}
              onBringToFront={() =>
                dispatch(CanvasCommand.bringNoteToFront({ id: item.id }))
              }
              onMove={startMove}
              onResize={startResize}
              onSendToBack={() =>
                dispatch(CanvasCommand.sendNoteToBack({ id: item.id }))
              }
            />
          )
        )}
        {commentReview.kind !== "idle" &&
        commentFrame?.snapshot === undefined &&
        commentGeometry !== undefined &&
        (commentReview.kind === "composing" || commentThread !== undefined) ? (
          <CommentPopover
            key={commentReview.kind === "thread"
              ? commentReview.threadId
              : "new-comment"}
            canSubmit={commentReview.kind === "composing"
              ? commentReview.canCreate
              : commentReview.canReply}
            clearDraft={commentDraftClear}
            currentAuthorId={author?.id ?? null}
            frameGeometry={commentGeometry}
            frameId={commentReview.frameId}
            pending={commentReview.pending !== null}
            statusColor={commentStatusColor}
            threadManageable={
              author !== null &&
              commentThread !== undefined &&
              canManageCommentThread(document.owner, commentThread, author.id)
            }
            {...(commentThread === undefined ? {} : { thread: commentThread })}
            zoom={camera.zoom}
            onClose={() => focusCommentReview(null)}
            onActionError={(cause) => onCommandError?.(messageOf(cause))}
            onDraftStatus={setCommentDraftDirty}
            onEdit={(commentId, expectedBody, body) => {
              return presentCommentReview(commentReviewRef.current!.perform({
                type: "edit",
                commentId,
                expectedBody,
                body
              }))
            }}
            onResolve={(resolved) => {
              return presentCommentReview(commentReviewRef.current!.perform({
                type: "set-resolved",
                resolved
              }))
            }}
            onSubmit={(body) => {
              return presentCommentReview(commentReviewRef.current!.perform({
                type: "submit",
                body
              }))
            }}
          />
        ) : null}
      </div>
      {selectionMarquee === null ? null : (
        <div
          aria-hidden="true"
          className="crit-canvas__selection-marquee"
          style={{
            height: selectionMarquee.height,
            left: selectionMarquee.x,
            top: selectionMarquee.y,
            width: selectionMarquee.width
          }}
        />
      )}
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
        noteAvailable={author !== null}
        onArrange={arrangeSelection}
        onAction={(action) => {
          if (action === "select") setTool("select")
          else if (action === "pan") setTool("pan")
          else if (action === "add-frame") openNewFrameAtCenter()
          else if (action === "add-note") addNoteAtCenter()
          else if (action === "comment") setTool("comment")
        }}
        title={document.title}
        tool={tool}
        selectedItemCount={selectedItems.length}
      />
      <CritContextMenu
        ariaLabel="Canvas actions"
        items={canvasMenu === null ? [] : [
          {
            action: controls.action({ id: "open-new-frame" }),
            execute: Effect.sync(() => setNewFrameTarget({
              x: canvasMenu.worldX,
              y: canvasMenu.worldY
            }))
          },
          {
            action: controls.action({ id: "create-note" }),
            execute: addNoteAt(
              canvasMenu.worldX,
              canvasMenu.worldY
            ),
            onFailure: (cause: unknown) => onCommandError?.(messageOf(cause))
          },
          {
            action: controls.action({ id: "zoom-to-fit" }),
            execute: Effect.sync(fit)
          }
        ]}
        onClose={() => setCanvasMenu(null)}
        position={canvasMenu}
      />
      <NewFrameDialog
        onCancel={() => setNewFrameTarget(null)}
        onCreate={(url, title) => {
          if (newFrameTarget === null) return Effect.void
          return addFrameAt(
            url,
            title,
            newFrameTarget.x,
            newFrameTarget.y
          ).pipe(Effect.tap(() => Effect.sync(() => setNewFrameTarget(null))))
        }}
        onError={(message) => onCommandError?.(message)}
        open={newFrameTarget !== null}
      />
    </div>
  )
}
