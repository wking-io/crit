import { Effect } from "effect"
import { AnimatePresence, motion } from "motion/react"
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from "react"

import type {
  CanvasFrame,
  CanvasGeometry,
  FrameReviewStatus,
  FrameStatus
} from "../core/index.js"
import {
  connectBridgedFrameInput,
  connectSameOriginFrameInput,
  type FrameInputIntent
} from "../frame-bridge/index.js"
import { canvasUiScale } from "./canvas-camera.js"
import {
  CritContextMenu,
  type ContextMenuPosition
} from "./canvas-context-menu.js"
import { canvasItemStyle } from "./canvas-item-style.js"
import {
  CanvasSelection,
  type ResizeHandlePosition
} from "./canvas-selection.js"
import {
  CanvasHelpPanel,
  NO_HELP_HOTKEY,
  helpTarget
} from "./canvas-help.js"
import {
  FRAME_STATUSES,
  IconEditTitle,
  IconFullscreen,
  IconMinimize,
  IconOpenExternal,
  IconSnapshot,
  IconTrash,
  STATUS_PILL_HEIGHT,
  STATUS_PILL_MOTION,
  STATUS_PILL_STEP,
  calculateStatusPillLayout,
  frameStatus,
  measureStatusPillWidth
} from "./frame-chrome.js"

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

export const FRAME_SIZE_PRESETS = [
  { id: "mobile", label: "Mobile", width: 402, height: 874 },
  { id: "tablet", label: "Tablet", width: 832, height: 1194 },
  { id: "laptop", label: "Laptop", width: 1280, height: 832 },
  { id: "desktop", label: "Desktop", width: 1512, height: 982 },
  { id: "widescreen", label: "Widescreen", width: 2560, height: 1440 }
] as const

const statusHelpDescriptions: Readonly<Record<FrameStatus, string>> = {
  "changes-requested": "Mark this frame as needing another iteration.",
  "in-progress": "Mark this frame as actively being worked on.",
  archived: "Capture the current page as an immutable snapshot frame.",
  approved: "Mark this frame as accepted for the reviewed direction.",
  "ready-for-review": "Mark this frame as ready for feedback or approval."
}

export function FrameCard({
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
    ...canvasItemStyle(geometry, frame.zIndex),
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
                      {...helpTarget({
                        name: option.label,
                        hotkey: NO_HELP_HOTKEY,
                        description: statusHelpDescriptions[option.id]
                      })}
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
        {...helpTarget({
          name: "Move frame",
          hotkey: NO_HELP_HOTKEY,
          description: "Drag the frame header to reposition it on the canvas."
        })}
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
            {...helpTarget({
              name: "Frame status",
              hotkey: NO_HELP_HOTKEY,
              description:
                frame.snapshot === undefined
                  ? "Review or change this frame's current workflow status."
                  : "Snapshot frames remain archived and cannot change status."
            })}
            onClick={() => setStatusMenuOpen((open) => !open)}
            onPointerDown={(event) => event.stopPropagation()}
            type="button"
          >
            <StatusIcon />
          </button>
          {titleVisible ? (
            <span className="crit-frame__title-mask">
              {titleEditing ? (
                <input
                  aria-label="Frame title"
                  autoFocus
                  {...helpTarget({
                    name: "Frame title",
                    hotkey: "Enter · Esc",
                    description: "Rename the frame. Press Enter to save or Escape to cancel."
                  })}
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
                  {...helpTarget({
                    name: "Edit frame title",
                    hotkey: NO_HELP_HOTKEY,
                    description: "Rename this frame while preserving its stable frame ID."
                  })}
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
            {frame.snapshot === undefined && onSnapshot !== undefined && actions.snapshot ? (
              <button
                aria-label={snapshotting ? "Taking snapshot" : "Take snapshot"}
                className="crit-frame__action"
                data-snapshotting={snapshotting || undefined}
                disabled={snapshotting}
                {...helpTarget({
                  name: snapshotting ? "Taking snapshot" : "Take snapshot",
                  hotkey: NO_HELP_HOTKEY,
                  description: "Preserve the live page as a separate immutable snapshot frame."
                })}
                onClick={takeSnapshot}
                type="button"
              >
                <IconSnapshot />
              </button>
            ) : null}
            {actions.open ? <a
              aria-label={`Open ${frame.title}`}
              className="crit-frame__action"
              {...helpTarget({
                name: "Open in new tab",
                hotkey: NO_HELP_HOTKEY,
                description: "Open this frame's page in a separate browser tab."
              })}
              href={frame.url}
              rel="noreferrer"
              target="_blank"
            >
              <IconOpenExternal />
            </a> : null}
            {actions.fullscreen ? <button
              aria-label={fullscreen ? `Collapse ${frame.title} to canvas` : `Enter ${frame.title} fullscreen`}
              className="crit-frame__action"
              {...helpTarget({
                name: fullscreen ? "Collapse to canvas" : "Enter fullscreen",
                hotkey: fullscreen ? "Esc" : NO_HELP_HOTKEY,
                description: fullscreen
                  ? "Return this frame to its position on the canvas."
                  : "Expand this frame to fill the screen for focused review."
              })}
              onClick={toggleFullscreen}
              type="button"
            >
              {fullscreen ? <IconMinimize /> : <IconFullscreen />}
            </button> : null}
            {actions.delete ? <button
              aria-keyshortcuts="Delete"
              aria-label={`Delete ${frame.title}`}
              className="crit-frame__action"
              {...helpTarget({
                name: "Remove frame",
                hotkey: "Del",
                description: "Remove this frame from the canvas."
              })}
              onClick={onRemove}
              type="button"
            ><IconTrash /></button> : null}
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
        ) : <div
          className="crit-frame__paused"
          {...helpTarget({
            name: "Paused frame",
            hotkey: NO_HELP_HOTKEY,
            description: "This frame is unloaded while far outside the current view to save resources."
          })}
        >Frame paused while offscreen</div>}
      </div>
      {selected ? (
        <CanvasSelection
          ink={status.ink}
          label={frame.title}
          onResize={(event, handle) => onResize(event, frame, handle)}
          zoom={zoom}
        />
      ) : null}
      {fullscreen ? <CanvasHelpPanel /> : null}
      <CritContextMenu
        ariaLabel={`Actions for ${frame.title}`}
        items={[
          {
            help: "Remove this frame from the canvas.",
            label: "Delete",
            onSelect: onRemove,
            tone: "danger"
          },
          {
            help: fullscreen
              ? "Return this frame to its position on the canvas."
              : "Expand this frame to fill the screen for focused review.",
            label: fullscreen ? "Collapse to canvas" : "Fullscreen",
            onSelect: toggleFullscreen
          },
          {
            help: "Open this frame's page in a separate browser tab.",
            href: frame.url,
            label: "Open in new tab"
          },
          {
            help: "Place this frame above every other canvas item.",
            label: "Bring to front",
            onSelect: onBringToFront
          },
          {
            help: "Place this frame behind every other canvas item.",
            label: "Send to back",
            onSelect: onSendToBack
          },
          {
            help: "Choose a standard viewport size for this frame.",
            label: "Set size to...",
            items: FRAME_SIZE_PRESETS.map((preset) => ({
              detail: `${preset.width} × ${preset.height}`,
              help: `Resize this frame to the ${preset.label.toLowerCase()} preset at ${preset.width} by ${preset.height} pixels.`,
              label: preset.label,
              onSelect: () => onSetSize(preset.width, preset.height)
            }))
          },
          {
            help: "Resize the frame height to fit its same-origin page content.",
            label: "Fit content",
            onSelect: () => measureContentHeight(true)
          }
        ]}
        onClose={() => setContextMenu(null)}
        position={contextMenu}
      />
    </section>
  )
}
