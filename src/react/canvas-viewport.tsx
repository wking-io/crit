import { Tooltip } from "@base-ui/react/tooltip"
import {
  useHotkey,
  useHotkeys,
  type RegisterableHotkey
} from "@tanstack/react-hotkeys"
import { Effect } from "effect"
import { AnimatePresence, motion } from "motion/react"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type PointerEvent as ReactPointerEvent
} from "react"
import { createPortal } from "react-dom"

import {
  CanvasCommand,
  type CanvasCommandFailed,
  type CanvasDocument,
  type CanvasFrame,
  type CanvasGeometry,
  type CanvasNote,
  type CanvasCommand as CanvasCommandValue,
  type FrameReviewStatus
} from "../core/index.js"
import {
  connectBridgedFrameInput,
  connectCanvasInput,
  connectSameOriginFrameInput,
  type FrameInputIntent
} from "../frame-bridge/index.js"
import { critStyles } from "./crit-styles.js"
import {
  canvasCursor,
  type CanvasTool
} from "./canvas-cursors.js"
import {
  CanvasSelection,
  type ResizeHandlePosition
} from "./canvas-selection.js"
import { beginCanvasInteraction } from "./canvas-interaction.js"
import { CritTooltipPopup } from "./crit-tooltip.js"
import {
  FRAME_STATUSES,
  IconAddFrame,
  IconFullscreen,
  IconMinimize,
  IconEditTitle,
  IconNote,
  IconOpenExternal,
  IconPan,
  IconPointer,
  IconRedo,
  IconSnapshot,
  IconSwitcher,
  IconTrash,
  IconUndo,
  STATUS_PILL_HEIGHT,
  STATUS_PILL_MOTION,
  STATUS_PILL_STEP,
  calculateStatusPillLayout,
  frameStatus,
  measureStatusPillWidth,
  shortIdForIndex
} from "./frame-chrome.js"
import {
  canvasUiScale,
  initialCanvasCameraState,
  updateCanvasCamera,
  type CanvasCamera,
  type CanvasCameraInput,
  type CanvasCameraOptions
} from "./canvas-camera.js"

type Camera = CanvasCamera
type Preview = Readonly<Record<string, CanvasGeometry>>
type WheelInput = Omit<
  Extract<FrameInputIntent, { readonly type: "wheel" }>,
  "type"
>

type CanvasZoomDirection = -1 | 0 | 1

export const CRIT_HOTKEYS = {
  selectTool: "V",
  handTool: "H",
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
  readonly zoomIn: ReadonlyArray<RegisterableHotkey>
  readonly zoomOut: ReadonlyArray<RegisterableHotkey>
}

export type FrameToolbarMode = "full" | "compact" | "minimal"
export type FrameChromeAction =
  | "snapshot"
  | "open"
  | "fullscreen"
  | "delete"

export interface FrameChromeSettings {
  readonly titleMinimumCharacters: number
  readonly snapshotMinimumWidth: number
  readonly openMinimumWidth: number
  readonly fullscreenMinimumWidth: number
  readonly deleteMinimumWidth: number
}

export const DEFAULT_FRAME_CHROME_SETTINGS: FrameChromeSettings = {
  titleMinimumCharacters: 10,
  snapshotMinimumWidth: 148,
  openMinimumWidth: 82,
  fullscreenMinimumWidth: 104,
  deleteMinimumWidth: 60
}

const FRAME_CHROME_HEIGHT = 28
const FRAME_ACTION_SIZE = 16
const FRAME_ACTION_GAP = 6
const FRAME_TITLE_CHARACTER_WIDTH = 7

const frameChromeFixedWidth = (actionCount: number) => {
  const actionsWidth =
    actionCount * FRAME_ACTION_SIZE +
    Math.max(0, actionCount - 1) * FRAME_ACTION_GAP
  return 16 + 16 + 6 + 12 + actionsWidth + 20
}

export const frameToolbarMode = (
  screenWidth: number,
  actionCount = 4,
  titleMinimumCharacters = DEFAULT_FRAME_CHROME_SETTINGS.titleMinimumCharacters
): FrameToolbarMode => {
  const fixedWidth = frameChromeFixedWidth(actionCount)
  const titleMinimumWidth =
    FRAME_TITLE_CHARACTER_WIDTH * titleMinimumCharacters
  return screenWidth - fixedWidth > titleMinimumWidth
    ? "full"
    : screenWidth >= fixedWidth
      ? "compact"
      : "minimal"
}

export const frameUiScale = (zoom: number) => canvasUiScale(zoom)

export interface FrameChromeMetrics {
  readonly screenHeight: number
  readonly titleVisible: boolean
  readonly toolbarMode: FrameToolbarMode
}

export interface FrameChromeLayout extends FrameChromeMetrics {
  readonly actions: Readonly<Record<FrameChromeAction, boolean>>
}

const resolveFrameChromeSettings = (
  settings: Partial<FrameChromeSettings> | undefined
): FrameChromeSettings => ({
  ...DEFAULT_FRAME_CHROME_SETTINGS,
  ...settings
})

export const frameChromeMetrics = (
  worldWidth: number,
  zoom: number,
  actionCount = 4,
  settings?: Partial<FrameChromeSettings>
): FrameChromeMetrics => {
  const resolved = resolveFrameChromeSettings(settings)
  const toolbarMode = frameToolbarMode(
    worldWidth * zoom,
    actionCount,
    resolved.titleMinimumCharacters
  )
  return {
    screenHeight: FRAME_CHROME_HEIGHT,
    titleVisible: toolbarMode === "full",
    toolbarMode
  }
}

export const frameChromeLayout = (
  worldWidth: number,
  zoom: number,
  snapshotAvailable: boolean,
  settings?: Partial<FrameChromeSettings>
): FrameChromeLayout => {
  const resolved = resolveFrameChromeSettings(settings)
  const screenWidth = worldWidth * zoom
  const actions = {
    snapshot:
      snapshotAvailable && screenWidth >= resolved.snapshotMinimumWidth,
    open: screenWidth >= resolved.openMinimumWidth,
    fullscreen: screenWidth >= resolved.fullscreenMinimumWidth,
    delete: screenWidth >= resolved.deleteMinimumWidth
  }
  const actionCount = Object.values(actions).filter(Boolean).length
  const metrics = frameChromeMetrics(worldWidth, zoom, actionCount, resolved)
  return { ...metrics, actions }
}

type ContextMenuPosition = {
  readonly x: number
  readonly y: number
}

type ContextMenuActionItem =
  | {
      readonly detail?: string
      readonly label: string
      readonly onSelect: () => void
      readonly tone?: "danger"
    }
  | {
      readonly detail?: string
      readonly href: string
      readonly label: string
    }

type ContextMenuItem =
  | ContextMenuActionItem
  | {
      readonly items: ReadonlyArray<ContextMenuActionItem>
      readonly label: string
    }

export const FRAME_SIZE_PRESETS = [
  { id: "mobile", label: "Mobile", width: 402, height: 874 },
  { id: "tablet", label: "Tablet", width: 832, height: 1194 },
  { id: "laptop", label: "Laptop", width: 1280, height: 832 },
  { id: "desktop", label: "Desktop", width: 1512, height: 982 },
  { id: "widescreen", label: "Widescreen", width: 2560, height: 1440 }
] as const

export interface CanvasViewportProps {
  readonly document: CanvasDocument
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

const itemStyle = (geometry: CanvasGeometry, zIndex: number): CSSProperties => ({
  height: geometry.height,
  left: geometry.x,
  position: "absolute",
  top: geometry.y,
  width: geometry.width,
  zIndex
})

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
  const toolbarTooltip = useMemo(() => Tooltip.createHandle<string>(), [])

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
              onSelect={() => setSelectedId(item.id)}
              onInputIntent={(intent) => {
                if (intent.type === "select") {
                  setSelectedId(item.id)
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
                } else {
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
      <div
        className="crit-toolbar"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <span className="crit-toolbar__title" title={document.title}>
          <span>{document.title}</span>
          <IconSwitcher />
        </span>
        <span aria-hidden="true" className="crit-toolbar__divider" />
        <Tooltip.Provider delay={450} closeDelay={80}>
          <span className="crit-toolbar__group">
            <Tooltip.Trigger
              aria-disabled="true"
              aria-label="Undo"
              className="crit-icon-button"
              handle={toolbarTooltip}
              payload="Undo"
              type="button"
            ><IconUndo /></Tooltip.Trigger>
            <Tooltip.Trigger
              aria-disabled="true"
              aria-label="Redo"
              className="crit-icon-button"
              handle={toolbarTooltip}
              payload="Redo"
              type="button"
            ><IconRedo /></Tooltip.Trigger>
          </span>
          <span aria-hidden="true" className="crit-toolbar__divider" />
          <span className="crit-toolbar__group">
            <Tooltip.Trigger
              aria-keyshortcuts="V"
              aria-label="Select"
              aria-pressed={tool === "select"}
              className="crit-icon-button"
              handle={toolbarTooltip}
              onClick={() => setTool("select")}
              payload="Select · V"
              type="button"
            ><IconPointer /></Tooltip.Trigger>
            <Tooltip.Trigger
              aria-keyshortcuts="H"
              aria-label="Hand"
              aria-pressed={tool === "pan"}
              className="crit-icon-button"
              handle={toolbarTooltip}
              onClick={() => setTool("pan")}
              payload="Hand · H"
              type="button"
            ><IconPan /></Tooltip.Trigger>
            <Tooltip.Trigger
              aria-label="Add frame"
              className="crit-icon-button"
              handle={toolbarTooltip}
              onClick={() => setNewFrameTarget({
                x: (viewport.width / 2 - camera.x) / camera.zoom - 600,
                y: (viewport.height / 2 - camera.y) / camera.zoom - 400
              })}
              payload="Add frame"
              type="button"
            ><IconAddFrame /></Tooltip.Trigger>
            <Tooltip.Trigger
              aria-label="Add note"
              className="crit-icon-button"
              handle={toolbarTooltip}
              onClick={() => {
                addNoteAt(
                  (viewport.width / 2 - camera.x) / camera.zoom - 140,
                  (viewport.height / 2 - camera.y) / camera.zoom - 80
                )
              }}
              payload="Add note"
              type="button"
            ><IconNote /></Tooltip.Trigger>
          </span>
          <CritTooltipPopup
            handle={toolbarTooltip}
            ink={frameStatus("archived").ink}
          />
        </Tooltip.Provider>
      </div>
      <CritContextMenu
        ariaLabel="Canvas actions"
        items={canvasMenu === null ? [] : [
          {
            label: "New frame",
            onSelect: () => setNewFrameTarget({
              x: canvasMenu.worldX,
              y: canvasMenu.worldY
            })
          },
          {
            label: "New note",
            onSelect: () => addNoteAt(canvasMenu.worldX, canvasMenu.worldY)
          },
          { label: "Zoom to fit", onSelect: fit }
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

function FrameCard({
  frame,
  frameChrome,
  geometry,
  iframeAllow,
  iframeSandbox,
  iframeVisible,
  selected,
  shortId,
  zoom,
  onBringToFront,
  onFitContent,
  onMove,
  onRemove,
  onResize,
  onSelect,
  onInputIntent,
  onSnapshot,
  onSnapshotError,
  onSendToBack,
  onSetSize,
  onStatus,
  onTitle
}: {
  readonly frame: CanvasFrame
  readonly frameChrome?: Partial<FrameChromeSettings>
  readonly geometry: CanvasGeometry
  readonly iframeAllow: string
  readonly iframeSandbox?: string
  readonly iframeVisible: boolean
  readonly selected: boolean
  readonly shortId: string
  readonly zoom: number
  readonly onBringToFront: () => void
  readonly onFitContent: (height: number) => void
  readonly onMove: (event: ReactPointerEvent, item: CanvasFrame) => void
  readonly onRemove: () => void
  readonly onResize: (
    event: ReactPointerEvent,
    item: CanvasFrame,
    handle: ResizeHandlePosition
  ) => void
  readonly onSelect: () => void
  readonly onInputIntent: (intent: FrameInputIntent) => void
  readonly onSnapshot?: () => Effect.Effect<unknown, unknown>
  readonly onSnapshotError: (cause: unknown) => void
  readonly onSendToBack: () => void
  readonly onSetSize: (width: number, height: number) => void
  readonly onStatus: (status: FrameReviewStatus) => void
  readonly onTitle: (title: string) => void
}) {
  const frameRef = useRef<HTMLElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const actionTooltip = useMemo(() => Tooltip.createHandle<string>(), [])
  const [contextMenu, setContextMenu] = useState<ContextMenuPosition | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [snapshotting, setSnapshotting] = useState(false)
  const [statusMenuOpen, setStatusMenuOpen] = useState(false)
  const [titleDraft, setTitleDraft] = useState(frame.title)
  const [titleEditing, setTitleEditing] = useState(false)
  useEffect(() => setTitleDraft(frame.title), [frame.title])
  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === frameRef.current)
    document.addEventListener("fullscreenchange", update)
    update()
    return () => document.removeEventListener("fullscreenchange", update)
  }, [])
  const { actions, titleVisible, toolbarMode } = frameChromeLayout(
    geometry.width,
    zoom,
    frame.snapshot === undefined && onSnapshot !== undefined,
    frameChrome
  )
  const status = frameStatus(frame.status)
  const StatusIcon = status.icon
  const availableStatuses = FRAME_STATUSES.filter(
    (option) => option.id !== status.id
  )
  const statusPillLayout = calculateStatusPillLayout(
    availableStatuses.map((option) => measureStatusPillWidth(option.label))
  ).map((layout, index) => ({
    ...layout,
    option: availableStatuses[index]!
  }))
  const rotatedBottomHalfHeight =
    statusPillLayout.at(-1)?.verticalHalfExtent ?? STATUS_PILL_HEIGHT / 2
  const statusFrameGap =
    STATUS_PILL_MOTION.frameGap +
    Math.max(0, rotatedBottomHalfHeight - STATUS_PILL_HEIGHT / 2)
  const uiScale = frameUiScale(zoom)
  const frameStyle = {
    ...itemStyle(geometry, frame.zIndex),
    "--crit-ui": uiScale,
    "--frame-ink": status.ink,
    "--frame-shell": status.shell,
    "--frame-stroke": status.stroke
  } as CSSProperties

  const measureContentHeight = useCallback((force = false) => {
    const iframe = iframeRef.current
    if (iframe === null) {
      onSnapshotError(new Error("Frame content is not currently loaded"))
      return
    }
    try {
      const contentDocument = iframe.contentDocument
      if (contentDocument === null) {
        throw new Error("Frame content is not available")
      }
      const root = contentDocument.documentElement
      const body = contentDocument.body
      const contentHeight = Math.max(
        root.scrollHeight,
        root.offsetHeight,
        root.clientHeight,
        body?.scrollHeight ?? 0,
        body?.offsetHeight ?? 0,
        body?.clientHeight ?? 0
      )
      const nextHeight = Math.ceil(contentHeight + FRAME_CHROME_HEIGHT)
      if (force || Math.abs(nextHeight - geometry.height) > 1) {
        onFitContent(nextHeight)
      }
    } catch {
      onSnapshotError(new Error(
        "Fit content requires a same-origin frame or a Crit height bridge"
      ))
    }
  }, [geometry.height, onFitContent, onSnapshotError])

  useEffect(() => {
    const iframe = iframeRef.current
    if (iframe === null) return
    let disconnect = () => {}
    const connect = () => {
      disconnect()
      try {
        const iframeWindow = iframe.contentWindow
        if (iframeWindow === null) return
        const disconnectInput = connectSameOriginFrameInput({
          target: iframeWindow,
          frameElement: iframe,
          onIntent: onInputIntent
        })
        const openContextMenu = (event: MouseEvent) => {
          event.preventDefault()
          event.stopPropagation()
          const rect = iframe.getBoundingClientRect()
          setContextMenu({
            x: rect.left + event.clientX,
            y: rect.top + event.clientY
          })
          onSelect()
        }
        iframeWindow.addEventListener("contextmenu", openContextMenu, true)
        const resizeObserver = frame.display.heightMode === "fit-page"
          ? new ResizeObserver(() => measureContentHeight())
          : null
        const contentDocument = iframe.contentDocument
        if (resizeObserver !== null && contentDocument !== null) {
          resizeObserver.observe(contentDocument.documentElement)
          if (contentDocument.body !== null) resizeObserver.observe(contentDocument.body)
          measureContentHeight()
        }
        disconnect = () => {
          try {
            iframeWindow.removeEventListener("contextmenu", openContextMenu, true)
            disconnectInput()
          } catch {
            // A navigation may make the former WindowProxy cross-origin first.
          }
          resizeObserver?.disconnect()
        }
      } catch {
        disconnect = () => {}
      }
    }
    const disconnectBridge = connectBridgedFrameInput({
      target: window,
      frameElement: iframe,
      onIntent: onInputIntent
    })
    iframe.addEventListener("load", connect)
    connect()
    return () => {
      iframe.removeEventListener("load", connect)
      disconnectBridge()
      disconnect()
    }
  }, [
    frame.display.heightMode,
    frame.url,
    measureContentHeight,
    onInputIntent,
    onSelect
  ])
  const takeSnapshot = () => {
    if (onSnapshot === undefined || snapshotting) return
    setSnapshotting(true)
    Effect.runFork(
      onSnapshot().pipe(
        Effect.tapError((cause) => Effect.sync(() => onSnapshotError(cause))),
        Effect.ensuring(Effect.sync(() => setSnapshotting(false))),
        Effect.catch(() => Effect.void)
      )
    )
  }
  const commitTitle = () => {
    const title = titleDraft.trim()
    if (title.length > 0 && title !== frame.title) onTitle(title)
    else setTitleDraft(frame.title)
    setTitleEditing(false)
  }
  const toggleFullscreen = () => {
    if (document.fullscreenElement === frameRef.current) {
      void document.exitFullscreen()
    } else {
      void frameRef.current?.requestFullscreen()
    }
  }

  return (
    <section
      className="crit-frame"
      data-frame-status={frame.status}
      data-selected={selected || undefined}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        setContextMenu({ x: event.clientX, y: event.clientY })
        onSelect()
      }}
      onPointerDown={onSelect}
      ref={frameRef}
      style={frameStyle}
    >
      {frame.snapshot === undefined ? (
        <div
          aria-label={`Set status for ${frame.title}`}
          className="crit-status-menu"
          onPointerDown={(event) => event.stopPropagation()}
          role="menu"
          style={{
            bottom: `calc(100% + ${statusFrameGap * uiScale}px)`,
            pointerEvents: statusMenuOpen ? "all" : "none"
          }}
        >
          <AnimatePresence>
            {statusMenuOpen
              ? statusPillLayout.map(({
                  option,
                  distanceFromFrame,
                  finalX,
                  finalY,
                  finalRotate
                }) => {
                  const OptionIcon = option.icon
                  const startY =
                    (distanceFromFrame * STATUS_PILL_STEP +
                    STATUS_PILL_MOTION.originOffset) * uiScale
                  const selectStatus = () => {
                    if (option.id === "archived") takeSnapshot()
                    else onStatus(option.id)
                    setStatusMenuOpen(false)
                  }
                  return (
                    <motion.button
                      aria-checked={false}
                      className="crit-status-option"
                      disabled={option.id === "archived" && onSnapshot === undefined}
                      key={option.id}
                      onClick={(event) => {
                        if (event.detail === 0) selectStatus()
                      }}
                      onPointerDown={(event) => {
                        event.currentTarget.setPointerCapture(event.pointerId)
                      }}
                      onPointerUp={(event) => {
                        if (!event.isPrimary || event.button !== 0) return
                        selectStatus()
                      }}
                      role="menuitemradio"
                      style={{
                        ["--status-ink" as string]: option.ink,
                        ["--status-shell" as string]: option.shell,
                        ["--status-stroke" as string]: option.stroke
                      }}
                      initial={{
                        opacity: 0,
                        scale: STATUS_PILL_MOTION.initialScale,
                        y: startY,
                        rotate: 0
                      }}
                      animate={{
                        opacity: 1,
                        scale: 1,
                        x: finalX * uiScale,
                        y: finalY * uiScale,
                        rotate: [0, finalRotate]
                      }}
                      exit={{
                        opacity: 0,
                        scale: STATUS_PILL_MOTION.initialScale,
                        y: startY,
                        rotate: 0
                      }}
                      transition={{
                        ...STATUS_PILL_MOTION.spring,
                        opacity: { duration: 0.12 }
                      }}
                      type="button"
                    >
                      <OptionIcon />
                      <span>{option.label}</span>
                    </motion.button>
                  )
                })
              : null}
          </AnimatePresence>
        </div>
      ) : null}
      <header
        className="crit-frame__chrome"
        data-toolbar-mode={toolbarMode}
        onPointerDown={(event) => onMove(event, frame)}
      >
        <div className="crit-frame__identity">
          <button
            aria-expanded={statusMenuOpen}
            aria-haspopup="menu"
            aria-label={`Status: ${status.label}. Change status`}
            className="crit-frame__mark"
            disabled={frame.snapshot !== undefined}
            onClick={() => setStatusMenuOpen((open) => !open)}
            onPointerDown={(event) => event.stopPropagation()}
            type="button"
          >
            <StatusIcon />
          </button>
          {titleVisible ? (
            <span className="crit-frame__title-mask" title={`${shortId}: ${frame.title}`}>
              {titleEditing ? (
                <input
                  aria-label="Frame title"
                  autoFocus
                  onBlur={commitTitle}
                  onChange={(event) => setTitleDraft(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    event.stopPropagation()
                    if (event.key === "Enter") commitTitle()
                    if (event.key === "Escape") {
                      setTitleDraft(frame.title)
                      setTitleEditing(false)
                    }
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                  value={titleDraft}
                />
              ) : (
                <button
                  aria-label={`Edit frame title: ${frame.title}`}
                  className="crit-frame__title-button"
                  onClick={() => setTitleEditing(true)}
                  onPointerDown={(event) => event.stopPropagation()}
                  type="button"
                >
                  <span className="crit-frame__title-track">
                    <strong>{shortId}: {frame.title}</strong>
                    <strong>{status.label}</strong>
                  </span>
                  <IconEditTitle className="crit-frame__title-edit-icon" />
                </button>
              )}
            </span>
          ) : null}
        </div>
        <div className="crit-frame__actions" onPointerDown={(event) => event.stopPropagation()}>
          <Tooltip.Provider delay={450} closeDelay={80}>
            {frame.snapshot === undefined && onSnapshot !== undefined && actions.snapshot ? (
              <Tooltip.Trigger
                aria-label={snapshotting ? "Taking snapshot" : "Take snapshot"}
                className="crit-frame__action"
                data-snapshotting={snapshotting || undefined}
                disabled={snapshotting}
                handle={actionTooltip}
                onClick={takeSnapshot}
                payload={snapshotting ? "Taking snapshot…" : "Take snapshot"}
                type="button"
              >
                <IconSnapshot />
              </Tooltip.Trigger>
            ) : null}
            {actions.open ? <Tooltip.Trigger
              aria-label={`Open ${frame.title}`}
              className="crit-frame__action"
              handle={actionTooltip}
              payload="Open in a new tab"
              render={<a href={frame.url} rel="noreferrer" target="_blank" />}
            >
              <IconOpenExternal />
            </Tooltip.Trigger> : null}
            {actions.fullscreen ? <Tooltip.Trigger
              aria-label={fullscreen ? `Collapse ${frame.title} to canvas` : `Enter ${frame.title} fullscreen`}
              className="crit-frame__action"
              handle={actionTooltip}
              onClick={toggleFullscreen}
              payload={fullscreen ? "Collapse to canvas" : "Enter fullscreen"}
              type="button"
            >
              {fullscreen ? <IconMinimize /> : <IconFullscreen />}
            </Tooltip.Trigger> : null}
            {actions.delete ? <Tooltip.Trigger
              aria-label={`Delete ${frame.title}`}
              className="crit-frame__action"
              handle={actionTooltip}
              onClick={onRemove}
              payload="Remove from canvas"
              type="button"
            ><IconTrash /></Tooltip.Trigger> : null}
            <CritTooltipPopup handle={actionTooltip} ink={status.ink} />
          </Tooltip.Provider>
        </div>
      </header>
      <div className="crit-frame__viewport">
        {iframeVisible ? (
          <iframe
            allow={iframeAllow}
            ref={iframeRef}
            referrerPolicy="no-referrer"
            // Snapshot Artifacts are captured foreign pages with their CSP
            // stripped, served from the dev-server origin — never let their
            // scripts run same-origin with the host app and the Crit API.
            sandbox={
              iframeSandbox ??
              (frame.snapshot === undefined ? undefined : "allow-scripts")
            }
            src={frame.url}
            title={frame.title}
          />
        ) : <div className="crit-frame__paused">Frame paused while offscreen</div>}
      </div>
      {selected ? (
        <CanvasSelection
          ink={status.ink}
          label={frame.title}
          onResize={(event, handle) => onResize(event, frame, handle)}
          zoom={zoom}
        />
      ) : null}
      <CritContextMenu
        ariaLabel={`Actions for ${frame.title}`}
        items={[
          { label: "Delete", onSelect: onRemove, tone: "danger" },
          {
            label: fullscreen ? "Collapse to canvas" : "Fullscreen",
            onSelect: toggleFullscreen
          },
          { href: frame.url, label: "Open in new tab" },
          { label: "Bring to front", onSelect: onBringToFront },
          { label: "Send to back", onSelect: onSendToBack },
          {
            label: "Set size to...",
            items: FRAME_SIZE_PRESETS.map((preset) => ({
              detail: `${preset.width} × ${preset.height}`,
              label: preset.label,
              onSelect: () => onSetSize(preset.width, preset.height)
            }))
          },
          { label: "Fit content", onSelect: () => measureContentHeight(true) }
        ]}
        onClose={() => setContextMenu(null)}
        position={contextMenu}
      />
    </section>
  )
}

function CritContextMenu({
  ariaLabel,
  items,
  onClose,
  position
}: {
  readonly ariaLabel: string
  readonly items: ReadonlyArray<ContextMenuItem>
  readonly onClose: () => void
  readonly position: ContextMenuPosition | null
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const submenuRef = useRef<HTMLDivElement>(null)
  const [submenu, setSubmenu] = useState<{
    readonly items: ReadonlyArray<ContextMenuActionItem>
    readonly label: string
    readonly position: ContextMenuPosition
  } | null>(null)

  const close = useCallback(() => {
    setSubmenu(null)
    onClose()
  }, [onClose])

  useHotkey("Escape", close, {
    conflictBehavior: "allow",
    enabled: position !== null,
    ignoreInputs: false
  })

  const openSubmenu = (
    item: Extract<ContextMenuItem, { readonly items: unknown }>,
    trigger: HTMLButtonElement,
    focusFirst = false
  ) => {
    const rect = trigger.getBoundingClientRect()
    const menuWidth = 208
    const submenuHeight = item.items.length * 34 + 8
    const opensRight = rect.right + 4 + menuWidth <= window.innerWidth - 8
    setSubmenu({
      items: item.items,
      label: item.label,
      position: {
        x: opensRight ? rect.right + 4 : rect.left - menuWidth - 4,
        y: Math.max(8, Math.min(rect.top, window.innerHeight - submenuHeight - 8))
      }
    })
    if (focusFirst) {
      window.requestAnimationFrame(() => {
        submenuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus()
      })
    }
  }

  useEffect(() => {
    if (position === null) return
    const closeFromOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        (menuRef.current?.contains(event.target) === true ||
          submenuRef.current?.contains(event.target) === true)
      ) return
      close()
    }
    window.addEventListener("pointerdown", closeFromOutside, true)
    window.addEventListener("blur", close)
    window.addEventListener("resize", close)
    return () => {
      window.removeEventListener("pointerdown", closeFromOutside, true)
      window.removeEventListener("blur", close)
      window.removeEventListener("resize", close)
    }
  }, [close, position])

  useEffect(() => {
    if (position !== null) {
      menuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus()
    }
  }, [position])

  if (position === null || typeof document === "undefined") return null
  const menuWidth = 208
  const menuHeight = items.length * 34 + 8
  const left = Math.max(8, Math.min(position.x, window.innerWidth - menuWidth - 8))
  const top = Math.max(8, Math.min(position.y, window.innerHeight - menuHeight - 8))

  return createPortal(
    <>
      <div
        aria-label={ariaLabel}
        className="crit-context-menu"
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onPointerDown={(event) => event.stopPropagation()}
        ref={menuRef}
        role="menu"
        style={{ left, top }}
      >
        {items.map((item) =>
          "items" in item ? (
            <button
              aria-expanded={submenu?.label === item.label}
              aria-haspopup="menu"
              data-submenu-trigger=""
              key={item.label}
              onClick={(event) => {
                if (submenu?.label === item.label) setSubmenu(null)
                else openSubmenu(item, event.currentTarget, true)
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight") {
                  event.preventDefault()
                  openSubmenu(item, event.currentTarget, true)
                }
              }}
              onPointerEnter={(event) => openSubmenu(item, event.currentTarget)}
              role="menuitem"
              type="button"
            >
              <span>{item.label}</span>
              <span aria-hidden="true" className="crit-context-menu__arrow">›</span>
            </button>
          ) : "href" in item ? (
            <a
              href={item.href}
              key={item.label}
              onClick={close}
              onPointerEnter={() => setSubmenu(null)}
              rel="noreferrer"
              role="menuitem"
              target="_blank"
            >
              <span>{item.label}</span>
              {item.detail === undefined ? null : (
                <span className="crit-context-menu__detail">{item.detail}</span>
              )}
            </a>
          ) : (
            <button
              data-tone={item.tone}
              key={item.label}
              onClick={() => {
                close()
                item.onSelect()
              }}
              onPointerEnter={() => setSubmenu(null)}
              role="menuitem"
              type="button"
            >
              <span>{item.label}</span>
              {item.detail === undefined ? null : (
                <span className="crit-context-menu__detail">{item.detail}</span>
              )}
            </button>
          )
        )}
      </div>
      {submenu === null ? null : (
        <div
          aria-label={submenu.label}
          className="crit-context-menu crit-context-menu--submenu"
          onContextMenu={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault()
              menuRef.current
                ?.querySelector<HTMLElement>("[data-submenu-trigger]")
                ?.focus()
              setSubmenu(null)
            }
          }}
          onPointerDown={(event) => event.stopPropagation()}
          ref={submenuRef}
          role="menu"
          style={{ left: submenu.position.x, top: submenu.position.y }}
        >
          {submenu.items.map((item) =>
            "href" in item ? (
              <a
                href={item.href}
                key={item.label}
                onClick={close}
                rel="noreferrer"
                role="menuitem"
                target="_blank"
              >
                <span>{item.label}</span>
                {item.detail === undefined ? null : (
                  <span className="crit-context-menu__detail">{item.detail}</span>
                )}
              </a>
            ) : (
              <button
                data-tone={item.tone}
                key={item.label}
                onClick={() => {
                  close()
                  item.onSelect()
                }}
                role="menuitem"
                type="button"
              >
                <span>{item.label}</span>
                {item.detail === undefined ? null : (
                  <span className="crit-context-menu__detail">{item.detail}</span>
                )}
              </button>
            )
          )}
        </div>
      )}
    </>,
    document.body
  )
}

function NewFrameDialog({
  onCancel,
  onCreate,
  onError,
  open
}: {
  readonly onCancel: () => void
  readonly onCreate: (url: string, title: string) => void
  readonly onError: (message: string) => void
  readonly open: boolean
}) {
  const [title, setTitle] = useState("")
  const [url, setUrl] = useState("")

  useHotkey("Escape", onCancel, {
    conflictBehavior: "allow",
    enabled: open,
    ignoreInputs: false
  })

  useEffect(() => {
    if (!open) {
      setTitle("")
      setUrl("")
    }
  }, [open])

  if (!open || typeof document === "undefined") return null

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    try {
      const parsed = new URL(url.trim(), window.location.href)
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("Frame URL must use http or https")
      }
      const inferredTitle =
        parsed.pathname.split("/").filter(Boolean).at(-1) ?? parsed.hostname
      onCreate(parsed.href, title.trim() || inferredTitle || "Untitled frame")
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Enter a valid frame URL")
    }
  }

  return createPortal(
    <div
      aria-labelledby="crit-new-frame-title"
      aria-modal="true"
      className="crit-dialog-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
      role="dialog"
    >
      <form className="crit-new-frame-dialog" onSubmit={submit}>
        <h2 id="crit-new-frame-title">New frame</h2>
        <label>
          URL
          <input
            autoFocus
            onChange={(event) => setUrl(event.currentTarget.value)}
            placeholder="https://example.com/iteration"
            required
            type="text"
            value={url}
          />
        </label>
        <label>
          Title <span>(optional)</span>
          <input
            onChange={(event) => setTitle(event.currentTarget.value)}
            placeholder="Inferred from URL"
            type="text"
            value={title}
          />
        </label>
        <div className="crit-new-frame-dialog__actions">
          <button onClick={onCancel} type="button">Cancel</button>
          <button data-primary="" type="submit">Add frame</button>
        </div>
      </form>
    </div>,
    document.body
  )
}

function NoteCard({
  note,
  geometry,
  selected,
  zoom,
  onBringToFront,
  onMove,
  onRemove,
  onResize,
  onSelect,
  onSendToBack,
  onText
}: {
  readonly note: CanvasNote
  readonly geometry: CanvasGeometry
  readonly selected: boolean
  readonly zoom: number
  readonly onBringToFront: () => void
  readonly onMove: (event: ReactPointerEvent, item: CanvasNote) => void
  readonly onRemove: () => void
  readonly onResize: (
    event: ReactPointerEvent,
    item: CanvasNote,
    handle: ResizeHandlePosition
  ) => void
  readonly onSelect: () => void
  readonly onSendToBack: () => void
  readonly onText: (expectedText: string, text: string) => void
}) {
  const [text, setText] = useState(note.text)
  useEffect(() => setText(note.text), [note.text])
  return (
    <article
      className="crit-note"
      data-selected={selected || undefined}
      style={{ ...itemStyle(geometry, note.zIndex), "--crit-ui": 1 } as CSSProperties}
    >
      <header
        className="crit-note__chrome"
        onPointerDown={(event) => {
          onSelect()
          onMove(event, note)
        }}
      >
        <span className="crit-note__label">{note.attachedTo === null ? "Note" : `Attached to ${note.attachedTo}`}</span>
        <span className="crit-note__actions">
          <OrderControls
            label="note"
            onBringToFront={onBringToFront}
            onSendToBack={onSendToBack}
          />
          <button aria-label="Delete note" onClick={onRemove} onPointerDown={(event) => event.stopPropagation()} type="button">×</button>
        </span>
      </header>
      <textarea
        aria-label="Note"
        onBlur={() => text !== note.text && onText(note.text, text)}
        onChange={(event) => setText(event.currentTarget.value)}
        value={text}
      />
      {!selected ? (
        <button
          aria-label="Select note"
          className="crit-note__select-shield"
          onPointerDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onSelect()
          }}
          type="button"
        />
      ) : null}
      {selected ? (
        <CanvasSelection
          ink={frameStatus("archived").ink}
          label="note"
          onResize={(event, handle) => onResize(event, note, handle)}
          zoom={zoom}
        />
      ) : null}
    </article>
  )
}

function OrderControls({
  label,
  onBringToFront,
  onSendToBack,
  style
}: {
  readonly label: string
  readonly onBringToFront: () => void
  readonly onSendToBack: () => void
  readonly style?: CSSProperties
}) {
  return (
    <span style={{ display: "flex", flex: "0 0 auto", gap: style === undefined ? 4 : 0 }}>
      <button
        aria-label={`Send ${label} to back`}
        onClick={onSendToBack}
        onPointerDown={(event) => event.stopPropagation()}
        style={style}
        title="Send to back"
        type="button"
      >
        ⇩
      </button>
      <button
        aria-label={`Bring ${label} to front`}
        onClick={onBringToFront}
        onPointerDown={(event) => event.stopPropagation()}
        style={style}
        title="Bring to front"
        type="button"
      >
        ⇧
      </button>
    </span>
  )
}
