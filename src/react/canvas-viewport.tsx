import { Popover } from "@base-ui/react/popover"
import { useHotkeys } from "@tanstack/react-hotkeys"
import { Effect, Match, Option, Schema } from "effect"
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
  CanvasCommandFailed,
  canManageCommentThread,
  type CanvasDocument,
  type CanvasFrame,
  type CanvasGeometry,
  type CanvasNote,
  type Author,
  type CanvasCommand as CanvasCommandValue
} from "../core/index.js"
import {
  CritClientErrorSchema,
  critClientErrorMessage
} from "../runtime/canvas-failure.js"
import { runtimeId } from "../runtime/runtime-capabilities.js"
import {
  connectCanvasInput,
  type FrameInputIntent
} from "../frame-bridge/index.js"
import { cssVariableStyle } from "./css-variable-style.js"
import {
  CritContextActions,
  CritContextMenuDismissalScope,
  type ContextMenuItem
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
import { canvasArrangementFootprint } from "./canvas-arrangement-footprint.js"
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
import {
  CanvasToolbar,
  type CanvasChoice
} from "./canvas-toolbar.js"
import {
  FrameCard,
  frameContentProjection,
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
import {
  NoteCard,
  type NotePresentationSize
} from "./note-card.js"
import {
  DEFAULT_NOTE_PRESENTATION_THRESHOLDS,
  type NotePresentationThresholds
} from "./note-presentation.js"
import { NotePresentationControls } from "./note-presentation-controls.js"
import {
  CommentPopover,
  type CommentDraftClear
} from "./comment-popover.js"
import { commentPopoverTriggerId } from "./canvas-comment-pin.js"
import {
  confirmedEffect,
  ConfirmationProvider,
  useConfirmation,
  type ConfirmationDetails
} from "./confirmation-dialog.js"
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
type NotePresentationSizes = Readonly<Record<string, NotePresentationSize>>
type WheelInput = Omit<
  Extract<FrameInputIntent, { readonly type: "wheel" }>,
  "type"
>

type CanvasZoomDirection = -1 | 0 | 1

const EMPTY_FRAME_SELECTION: ReadonlySet<string> = new Set()


export interface CanvasViewportProps {
  readonly document: CanvasDocument
  readonly canvasChoices?: ReadonlyArray<CanvasChoice> | undefined
  readonly author?: Author | null
  readonly dispatch: (
    ...commands: ReadonlyArray<CanvasCommandValue>
  ) => Effect.Effect<unknown, CanvasCommandFailed>
  readonly iframeAllow?: string | undefined
  readonly iframeSandbox?: string | undefined
  readonly frameLoading?: FrameLoadingPolicy | undefined
  readonly onCommandError?: ((message: string) => void) | undefined
  readonly onCanvasSelect?: ((canvasId: string) => void) | undefined
  readonly snapshotFrame?: (
    frameId: string
  ) => Effect.Effect<unknown, unknown>
  readonly frameChrome?: Partial<FrameChromeSettings> | undefined
  readonly cameraOptions?: Partial<CanvasCameraOptions> | undefined
  readonly developerTools?: boolean | undefined
}

const CanvasActionFailure = Schema.Union([
  CanvasCommandFailed,
  CritClientErrorSchema,
  Schema.ErrorInstance()
])

const messageOf = (cause: unknown) => {
  const decoded = Schema.decodeUnknownOption(CanvasActionFailure)(cause)
  const failure = Option.getOrElse(decoded, () => new Error(String(cause)))
  if (Schema.is(CanvasCommandFailed)(failure)) return failure.detail
  if (Schema.is(CritClientErrorSchema)(failure)) {
    return critClientErrorMessage(failure)
  }
  return failure.message
}

const localId = (prefix: string) =>
  runtimeId(prefix)

export const frameRemovalConfirmationDetails = (
  frames: ReadonlyArray<Pick<CanvasFrame, "title">>
): ConfirmationDetails => frames.length === 1
  ? {
      confirmLabel: "Delete frame",
      description: "This frame will be removed from the canvas. This cannot be undone.",
      title: `Delete “${frames[0]!.title}”?`
    }
  : {
      confirmLabel: `Delete ${frames.length} frames`,
      description: `The ${frames.length} selected frames will be removed from the canvas. This cannot be undone.`,
      title: `Delete ${frames.length} frames?`
    }

export const noteRemovalConfirmationDetails: ConfirmationDetails = {
  confirmLabel: "Delete note",
  description: "This note will be removed from the canvas. This cannot be undone.",
  title: "Delete note?"
}

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
    <ConfirmationProvider>
      <CanvasActionRunnerProvider
        onError={(cause) => props.onCommandError?.(messageOf(cause))}
      >
        <CanvasViewportContent {...props} />
      </CanvasActionRunnerProvider>
    </ConfirmationProvider>
  )
}

function CanvasViewportContent({
  document,
  canvasChoices,
  author = null,
  developerTools = false,
  dispatch,
  iframeAllow = "clipboard-read; clipboard-write; fullscreen",
  iframeSandbox,
  frameLoading,
  onCommandError,
  onCanvasSelect,
  snapshotFrame,
  frameChrome,
  cameraOptions
}: CanvasViewportProps) {
  const controls = useCanvasControls(["canvas"], author !== null)
  const actionRunner = useCanvasActionRunner()
  const requestConfirmation = useConfirmation()
  const rootRef = useRef<HTMLDivElement>(null)
  const panShieldRef = useRef<HTMLDivElement>(null)
  const addFrameButtonRef = useRef<HTMLButtonElement>(null)
  const initialCameraState = useMemo(() => initialCanvasCameraState(), [])
  const [camera, setCamera] = useState<Camera>(initialCameraState.camera)
  const cameraStateRef = useRef(initialCameraState)
  const cameraOptionsRef = useRef(cameraOptions)
  cameraOptionsRef.current = cameraOptions
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [preview, setPreview] = useState<Preview>({})
  const [notePresentationSizes, setNotePresentationSizes] =
    useState<NotePresentationSizes>({})
  const [notePresentationThresholds, setNotePresentationThresholds] =
    useState<NotePresentationThresholds>(DEFAULT_NOTE_PRESENTATION_THRESHOLDS)
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
  const canvasActionPointRef = useRef<{
    readonly worldX: number
    readonly worldY: number
  } | null>(null)
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

  useEffect(() => {
    const noteIds = new Set(document.notes.map((note) => note.id))
    setNotePresentationSizes((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([id]) => noteIds.has(id))
      )
      return Object.keys(next).length === Object.keys(current).length
        ? current
        : next
    })
  }, [document.notes])

  const reportNotePresentationSize = useCallback((
    noteId: string,
    size: NotePresentationSize
  ) => {
    setNotePresentationSizes((current) => {
      const previous = current[noteId]
      return previous?.width === size.width && previous.height === size.height
        ? current
        : { ...current, [noteId]: size }
    })
  }, [])

  const frameClearanceGeometries = useMemo(
    () => document.frames.map((frame) => {
      const geometry = preview[frame.id] ?? frame.geometry
      return {
        ...geometry,
        height: frameContentProjection(
          geometry.width,
          geometry.height,
          camera.zoom
        ).shellHeight
      }
    }),
    [camera.zoom, document.frames, preview]
  )

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
      Match.value(next).pipe(
        Match.discriminatorsExhaustive("type")({
          changed: (change) => {
            if (change.clearDraft === undefined) return
            commentDraftClearVersion.current += 1
            setCommentDraftClear({
              version: commentDraftClearVersion.current,
              scope: change.clearDraft
            })
          },
          blocked: () => undefined,
          dispatch: () => undefined
        })
      )
    }

    return Effect.sync(() => adopt(transition)).pipe(
      Effect.flatMap(() => Match.value(transition).pipe(
        Match.discriminatorsExhaustive("type")({
          changed: () => Effect.void,
          blocked: () => Effect.void,
          dispatch: (pending) => dispatch(...pending.commands).pipe(
            Effect.tapError((cause) => Effect.sync(() => adopt(
              commentReviewRef.current!.settle(pending.key, {
                type: "rejected",
                cause
              })
            ))),
            Effect.tap(() => Effect.sync(() => adopt(
              commentReviewRef.current!.settle(pending.key, {
                type: "accepted"
              })
            )))
          )
        })
      ))
    )
  }, [dispatch])

  const focusCommentReview = useCallback((
    target: CommentThreadReviewTarget | null
  ) => {
    const transition = commentReviewRef.current!.focus(target, {
      draft: commentDraftDirty ? "dirty" : "clean"
    })

    const presentOrReport = (next: CommentThreadReviewTransition) => {
      return Match.value(next).pipe(
        Match.discriminatorsExhaustive("type")({
          changed: presentCommentReview,
          dispatch: presentCommentReview,
          blocked: (blocked) => {
            if (blocked.reason === "dirty-draft") {
              return presentCommentReview(blocked)
            }
            const detail = blocked.reason === "current-author-required"
              ? "Configure Git user.name and user.email to leave comments"
              : blocked.reason === "archived-frame"
                ? "Archived Frames do not support comments"
                : blocked.reason === "dispatch-pending"
                  ? "Wait for the current Comment action to finish"
                  : "The Comment target is no longer available"
            return Effect.sync(() => onCommandError?.(detail))
          }
        })
      )
    }

    if (
      transition.type === "blocked" &&
      transition.reason === "dirty-draft"
    ) {
      return Effect.promise(() => requestConfirmation({
        confirmLabel: "Discard",
        description: "Your unfinished comment or edit will be lost.",
        title: "Discard unfinished comment?"
      })).pipe(
        Effect.flatMap((discardDraft) => presentOrReport(
          discardDraft
            ? commentReviewRef.current!.focus(target, {
                draft: "dirty",
                discardDraft: true
              })
            : transition
        ))
      )
    }
    return presentOrReport(transition)
  }, [
    commentDraftDirty,
    onCommandError,
    presentCommentReview,
    requestConfirmation
  ])

  useEffect(() => {
    Effect.runFork(presentCommentReview(
      commentReviewRef.current!.reconcile(document, author)
    ).pipe(Effect.catch(() => Effect.void)))
  }, [author, document, presentCommentReview])

  const geometryOf = useCallback(
    (item: CanvasFrame | CanvasNote) => {
      const geometry = preview[item.id] ?? item.geometry
      if ("url" in item) return geometry
      const size = notePresentationSizes[item.id]
      return size === undefined ? geometry : { ...geometry, ...size }
    },
    [notePresentationSizes, preview]
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
      items: selectedItems.map((item) => canvasArrangementFootprint({
        id: item.id,
        geometry: item.geometry,
        kind: "url" in item ? "frame" : "note",
        zoom: camera.zoom
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
    ), [camera.zoom, dispatch, selectedItems])

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

  const removeFrames = useCallback((
    frames: ReadonlyArray<CanvasFrame>,
    clearSelection: boolean
  ) => confirmedEffect(
    requestConfirmation,
    frameRemovalConfirmationDetails(frames),
    () => {
      const removal = dispatch(...frames.map((frame) =>
        CanvasCommand.removeFrame({ id: frame.id })
      ))
      return clearSelection
        ? removal.pipe(Effect.tap(() => Effect.sync(() =>
            setSelectedIds(new Set())
          )))
        : removal
    }
  ), [dispatch, requestConfirmation])

  const removeNote = useCallback((
    note: CanvasNote,
    clearSelection: boolean
  ) => author === null
    ? Effect.void
    : confirmedEffect(
        requestConfirmation,
        noteRemovalConfirmationDetails,
        () => {
          const removal = dispatch(CanvasCommand.removeNote({
            id: note.id,
            actorId: author.id
          }))
          return clearSelection
            ? removal.pipe(Effect.tap(() => Effect.sync(() =>
                setSelectedIds(new Set())
              )))
            : removal
        }
      ), [author, dispatch, requestConfirmation])

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
      ? removeFrames(selectedFramesForRemoval, true)
      : selectedNoteForRemoval !== undefined
        ? removeNote(selectedNoteForRemoval, true)
        : Effect.void
    actionRunner.run(
      controls,
      removeSelectionAction,
      effect,
      (cause) => onCommandError?.(messageOf(cause))
    )
  }, [
    actionRunner,
    controls,
    onCommandError,
    removeFrames,
    removeNote,
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
    selectedFrameIds: ReadonlySet<string> = EMPTY_FRAME_SELECTION,
    onTap?: () => void
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
      selectedFrameIds
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
      if (
        onTap !== undefined &&
        Math.hypot(pointer.x - start.pointer.x, pointer.y - start.pointer.y) < 6
      ) {
        onTap()
        return
      }
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
      geometryOverrides: preview,
      selectedFrameIds: EMPTY_FRAME_SELECTION
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
      geometries: items.map(geometryOf),
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
  const topCanvasZIndex = sortedItems.reduce(
    (highest, item) => Math.max(highest, item.zIndex),
    0
  ) + 1
  const activeComments = useMemo(() => document.comments.filter((thread) => thread.resolvedAt === null), [document.comments])
  const commentThread = commentReview.kind === "thread"
    ? commentReview.thread
    : undefined
  const commentFrame = commentReview.kind === "idle"
    ? undefined
    : document.frames.find((frame) => frame.id === commentReview.frameId)
  const commentGeometry = commentFrame === undefined ? undefined : geometryOf(commentFrame)
  const commentStatusColor = frameStatus(commentFrame?.status ?? "archived").ink
  const commentPopoverOpen =
    commentReview.kind !== "idle" &&
    commentFrame?.snapshot === undefined &&
    commentGeometry !== undefined &&
    (commentReview.kind === "composing" || commentThread !== undefined)
  const commentPopoverAnchor = useMemo(() => {
    if (commentGeometry === undefined) return null
    return {
      getBoundingClientRect: () => {
        const canvasRect = rootRef.current?.getBoundingClientRect()
        return new DOMRect(
          (canvasRect?.left ?? 0) + camera.x + commentGeometry.x * camera.zoom,
          (canvasRect?.top ?? 0) + camera.y + commentGeometry.y * camera.zoom,
          commentGeometry.width * camera.zoom,
          commentGeometry.height * camera.zoom
        )
      }
    }
  }, [camera, commentGeometry])
  const commentPopoverClosePending = useRef(false)
  const requestCommentPopoverClose = useCallback(() => {
    if (commentPopoverClosePending.current) return
    commentPopoverClosePending.current = true
    Effect.runFork(
      focusCommentReview(null).pipe(
        Effect.catch((cause) =>
          Effect.sync(() => onCommandError?.(messageOf(cause)))
        ),
        Effect.ensuring(Effect.sync(() => {
          commentPopoverClosePending.current = false
        }))
      )
    )
  }, [focusCommentReview, onCommandError])

  const rememberCanvasActionPoint = useCallback((
    clientX: number,
    clientY: number
  ) => {
    const rect = rootRef.current?.getBoundingClientRect()
    if (rect === undefined) return
    canvasActionPointRef.current = {
      worldX: (clientX - rect.left - camera.x) / camera.zoom,
      worldY: (clientY - rect.top - camera.y) / camera.zoom
    }
  }, [camera])

  const canvasContextItems: ReadonlyArray<ContextMenuItem> = [
    {
      action: controls.action({ id: "open-new-frame" }),
      execute: Effect.sync(() => {
        const point = canvasActionPointRef.current
        if (point === null) openNewFrameAtCenter()
        else setNewFrameTarget({ x: point.worldX, y: point.worldY })
      })
    },
    {
      action: controls.action({ id: "create-note" }),
      execute: Effect.suspend(() => {
        const point = canvasActionPointRef.current
        return point === null
          ? addNoteAtCenter()
          : addNoteAt(point.worldX, point.worldY)
      }),
      onFailure: (cause: unknown) => onCommandError?.(messageOf(cause))
    },
    {
      action: controls.action({ id: "zoom-to-fit" }),
      execute: Effect.sync(fit)
    }
  ]
  return (
    <CritContextMenuDismissalScope signal={camera.zoom}>
    <Popover.Root
      onOpenChange={(open, details) => {
        if (open || details.reason === "trigger-press") return
        details.cancel()
        requestCommentPopoverClose()
      }}
      open={commentPopoverOpen}
      triggerId={commentReview.kind === "thread"
        ? commentPopoverTriggerId(commentReview.threadId)
        : null}
    >
    <CritContextActions
      ariaLabel="Canvas actions"
      items={canvasContextItems}
      onOpenChange={(open, details) => {
        if (!open) return
        const target = details.event.target
        if (target !== rootRef.current && target !== panShieldRef.current) {
          details.cancel()
        }
      }}
    >
    <div
      className="crit-canvas"
      ref={rootRef}
      onContextMenu={(event) => {
        if (event.target !== event.currentTarget) return
        rememberCanvasActionPoint(event.clientX, event.clientY)
      }}
      data-canvas-tool={tool}
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget) return
        rememberCanvasActionPoint(event.clientX, event.clientY)
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
              frameChrome={frameChrome}
              shortId={shortIdForIndex(
                document.frames.findIndex((frame) => frame.id === item.id)
              )}
              topZIndex={topCanvasZIndex}
              geometry={geometryOf(item)}
              zoom={camera.zoom}
              iframeAllow={iframeAllow}
              iframeUrl={frameIframeUrl(document.id, item, frameLoading)}
              iframeSandbox={iframeSandbox}
              iframeVisible={intersectsViewport(
                geometryOf(item), camera, viewport.width, viewport.height
              )}
              selected={selectedIds.has(item.id)}
              commentMode={tool === "comment"}
              commentThreads={activeComments.filter((thread) => thread.frameId === item.id)}
              openCommentId={
                commentReview.kind === "thread" && commentReview.frameId === item.id
                  ? commentReview.threadId
                  : null
              }
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
                Match.value(intent).pipe(
                  Match.discriminatorsExhaustive("type")({
                    select: (selection) =>
                      selectFrame(item.id, selection.additive),
                    delete: () => {
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
                          label: ids.length === 1
                            ? ids[0]!.title
                            : `${ids.length} frames`
                        }
                      })
                      actionRunner.run(
                        controls,
                        action,
                        removeFrames(ids, true),
                        (cause) => onCommandError?.(messageOf(cause))
                      )
                    },
                    tool: (toolIntent) => {
                      const action = controls.action({
                        id: toolIntent.tool === "select"
                          ? "select-tool"
                          : "hand-tool"
                      })
                      actionRunner.run(
                        controls,
                        action,
                        Effect.sync(() => setTool(toolIntent.tool))
                      )
                    },
                    "zoom-step": (zoomIntent) => {
                      const action = controls.action({
                        id: zoomIntent.direction > 0 ? "zoom-in" : "zoom-out"
                      })
                      actionRunner.run(
                        controls,
                        action,
                        Effect.sync(() => applyZoomStep(zoomIntent.direction))
                      )
                    },
                    pinch: (pinchIntent) =>
                      applyPinchScale(
                        pinchIntent.scaleFactor,
                        pinchIntent.clientX,
                        pinchIntent.clientY,
                        pinchIntent.deltaX,
                        pinchIntent.deltaY
                      ),
                    wheel: (wheelIntent) => {
                      const { type: _type, ...wheel } = wheelIntent
                      applyWheel(wheel)
                    }
                  })
                )
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
              onRemove={() => removeFrames([item], false)}
              onFitContent={(height) =>
                dispatch(
                  CanvasCommand.setFrameDisplay({
                    id: item.id,
                    display: { heightMode: "fit-page" }
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
                  CanvasCommand.setFrameDisplay({
                    id: item.id,
                    display: { heightMode: "viewport" }
                  }),
                  CanvasCommand.resizeFrame({ id: item.id, width, height })
                )
              }
              onResize={startResize}
              onSnapshot={snapshotFrame === undefined
                ? undefined
                : () => snapshotFrame(item.id)}
              onSnapshotError={(cause) => onCommandError?.(messageOf(cause))}
              onSendToBack={() =>
                dispatch(CanvasCommand.sendFrameToBack({ id: item.id }))
              }
              onStatus={(status) =>
                dispatch(CanvasCommand.setFrameStatus({ id: item.id, status }))
              }
              onTitle={(title) =>
                dispatch(CanvasCommand.setFrameTitle({ id: item.id, title }))
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
              clearanceAnchor={preview[item.id] ?? item.geometry}
              developerTools={developerTools}
              frameGeometries={frameClearanceGeometries}
              cameraOffset={camera}
              selectMode={tool === "select"}
              selected={selectedIds.has(item.id)}
              viewport={viewport}
              zoom={camera.zoom}
              thresholds={notePresentationThresholds}
              topZIndex={topCanvasZIndex}
              onSelect={(additive = false) => setSelectedIds((current) =>
                selectCanvasFrame(current, item.id, additive)
              )}
              onBringToFront={() =>
                dispatch(CanvasCommand.bringNoteToFront({ id: item.id }))
              }
              onMove={(event, note, onTap) =>
                startMove(event, note, EMPTY_FRAME_SELECTION, onTap)
              }
              onPresentationSize={reportNotePresentationSize}
              onRemove={() => removeNote(item, false)}
              onSendToBack={() =>
                dispatch(CanvasCommand.sendNoteToBack({ id: item.id }))
              }
            />
          )
        )}
        {commentPopoverOpen ? (
          <CommentPopover
            anchor={commentPopoverAnchor}
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
            thread={commentThread}
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
          onContextMenu={(event) =>
            rememberCanvasActionPoint(event.clientX, event.clientY)}
          onPointerDown={(event) => {
            rememberCanvasActionPoint(event.clientX, event.clientY)
            startPan(event)
          }}
          ref={panShieldRef}
        />
      ) : null}
      <NotePresentationControls
        onChange={setNotePresentationThresholds}
        onZoomChange={(zoom) => applyCameraInput({
          type: "zoom-to",
          zoom,
          viewport
        })}
        thresholds={notePresentationThresholds}
        zoom={camera.zoom}
      />
      <CanvasToolbar
        addFrameButtonRef={addFrameButtonRef}
        canvasId={document.id}
        canvasChoices={canvasChoices}
        commentAvailable={author !== null}
        noteAvailable={author !== null}
        onArrange={arrangeSelection}
        onTitleChange={(title) =>
          dispatch(CanvasCommand.renameCanvas({ title }))}
        onAction={(action) => {
          if (action === "select") setTool("select")
          else if (action === "pan") setTool("pan")
          else if (action === "add-frame") openNewFrameAtCenter()
          else if (action === "add-note") addNoteAtCenter()
          else if (action === "comment") setTool("comment")
        }}
        onCanvasSelect={onCanvasSelect}
        title={document.title}
        tool={tool}
        selectedItemCount={selectedItems.length}
      />
      <NewFrameDialog
        finalFocus={addFrameButtonRef}
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
    </CritContextActions>
    </Popover.Root>
    </CritContextMenuDismissalScope>
  )
}
