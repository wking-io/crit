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
  CanvasCommentThread,
  CanvasFrame,
  CanvasGeometry,
  CommentAnchor,
  FrameReviewStatus,
  FrameStatus
} from "../core/index.js"
import {
  connectBridgedFrameComments,
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
import { CanvasCommentPin } from "./canvas-comment-pin.js"
import {
  CanvasHelpPanel,
  NO_HELP_HOTKEY,
  helpTarget
} from "./canvas-help.js"
import {
  FRAME_STATUSES,
  STATUS_PILL_HEIGHT,
  STATUS_PILL_MOTION,
  STATUS_PILL_STEP,
  calculateStatusPillLayout,
  frameStatus,
  measureStatusPillWidth
} from "./frame-chrome.js"
import { Glyph } from "./glyph.js"

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

export const statusFanProjection = (
  zoom: number,
  screenFrameGap: number
) => {
  const scale = frameUiScale(zoom)
  return {
    scale,
    frameGap: screenFrameGap * scale
  }
}

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

export type FrameLoadingPolicy =
  | { readonly strategy: "navigate" }
  | { readonly strategy: "parent-fetch"; readonly aliasOrigin?: string }

const DEFAULT_FRAME_LOADING_POLICY: FrameLoadingPolicy = { strategy: "navigate" }

/** @internal Selects a safe parent fetch without treating an alias as the page origin. */
export const frameFetchTarget = (
  requestedUrl: URL,
  pageOrigin: string,
  policy: Extract<FrameLoadingPolicy, { readonly strategy: "parent-fetch" }>
) => {
  if (requestedUrl.origin === pageOrigin) {
    return { target: requestedUrl.href, fetchOrigin: pageOrigin }
  }
  if (policy.aliasOrigin === undefined) return null
  try {
    const trusted = new URL(policy.aliasOrigin)
    if ((trusted.protocol !== "http:" && trusted.protocol !== "https:") ||
      requestedUrl.origin !== trusted.origin) return null
  } catch {
    return null
  }
  return {
    target: `${requestedUrl.pathname}${requestedUrl.search}`,
    fetchOrigin: pageOrigin
  }
}

export const prepareSameOriginFrameHtml = (
  html: string,
  responseUrl: string,
  requestedUrl: string
) => {
  const document = new DOMParser().parseFromString(html, "text/html")
  const head = document.head
  const base = document.querySelector("base") ?? document.createElement("base")
  base.setAttribute("href", responseUrl)
  const metadata = document.createElement("meta")
  metadata.setAttribute("name", "crit-frame-url")
  metadata.setAttribute("content", requestedUrl)
  // Prepend both so URL resolution and logical routing are established before
  // any module scripts in the fetched document are encountered.
  head.prepend(metadata)
  head.prepend(base)
  return `<!doctype html>\n${document.documentElement.outerHTML}`
}

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
  frameLoading = DEFAULT_FRAME_LOADING_POLICY,
  selected,
  shortId,
  zoom,
  commentMode,
  commentThreads,
  openCommentId,
  onBringToFront,
  onFitContent,
  onMove,
  onRemove,
  onResize,
  onSelect,
  onInputIntent,
  onCommentAnchor,
  onOpenComment,
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
  readonly frameLoading?: FrameLoadingPolicy
  readonly selected: boolean
  readonly shortId: string
  readonly zoom: number
  readonly commentMode: boolean
  readonly commentThreads: ReadonlyArray<CanvasCommentThread>
  readonly openCommentId?: string
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
  readonly onCommentAnchor: (anchor: CommentAnchor) => void
  readonly onOpenComment: (id: string) => void
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
  const [commentBridgeReady, setCommentBridgeReady] = useState(false)
  const [srcdocState, setSrcdocState] = useState<
    { readonly status: "idle" | "loading" | "error"; readonly error?: string } |
    { readonly status: "ready"; readonly html: string }
  >({ status: "idle" })
  const [srcdocAttempt, setSrcdocAttempt] = useState(0)
  const requestedFrameUrl = typeof window === "undefined"
    ? null
    : (() => {
        try { return new URL(frame.url, window.location.href) } catch { return null }
      })()
  const fetchTarget = requestedFrameUrl === null || typeof window === "undefined"
    ? null
    : frameLoading.strategy === "parent-fetch"
      ? frameFetchTarget(requestedFrameUrl, window.location.origin, frameLoading)
      : null
  const usesSrcdoc = frame.snapshot === undefined &&
    frameLoading.strategy === "parent-fetch" &&
    typeof window !== "undefined" &&
    fetchTarget !== null

  useEffect(() => {
    if (!iframeVisible || !usesSrcdoc || requestedFrameUrl === null) {
      setSrcdocState({ status: "idle" })
      return
    }
    const controller = new AbortController()
    setSrcdocState({ status: "loading" })
    fetch(fetchTarget!.target, {
      credentials: "same-origin",
      referrerPolicy: "same-origin",
      signal: controller.signal
    }).then(async (response) => {
      if (!response.ok) throw new Error(`Frame request failed (${response.status})`)
      if (!response.headers.get("content-type")?.toLowerCase().includes("text/html")) {
        throw new Error("Frame response is not HTML")
      }
      const finalUrl = new URL(response.url)
      if (finalUrl.origin !== fetchTarget!.fetchOrigin) {
        throw new Error("Frame request redirected to another origin")
      }
      const logicalUrl = new URL(requestedFrameUrl.href)
      if (logicalUrl.hash && !finalUrl.hash) finalUrl.hash = logicalUrl.hash
      const html = prepareSameOriginFrameHtml(
        await response.text(), finalUrl.href, logicalUrl.href
      )
      if (!controller.signal.aborted) setSrcdocState({ status: "ready", html })
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return
      setSrcdocState({
        status: "error",
        error: cause instanceof Error ? cause.message : "Unable to load frame"
      })
    })
    return () => controller.abort()
  }, [fetchTarget?.fetchOrigin, fetchTarget?.target, frame.url, iframeVisible, srcdocAttempt, usesSrcdoc])
  const commentBridgeRef = useRef<ReturnType<typeof connectBridgedFrameComments> | null>(null)
  const onCommentAnchorRef = useRef(onCommentAnchor)
  const onOpenCommentRef = useRef(onOpenComment)
  onCommentAnchorRef.current = onCommentAnchor
  onOpenCommentRef.current = onOpenComment
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
  const statusFan = statusFanProjection(zoom, statusFrameGap)
  const statusVariable = `--crit-frame-status-${frame.status}`
  const frameStyle = {
    ...canvasItemStyle(geometry, frame.zIndex),
    "--crit-ui": uiScale,
    "--frame-ink": `var(${statusVariable}-ink, ${status.ink})`,
    "--frame-shell": `var(${statusVariable}-shell, ${status.shell})`,
    "--frame-stroke": `var(${statusVariable}-stroke, ${status.stroke})`
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
    onSelect,
    srcdocState.status
  ])
  useEffect(() => {
    const iframe = iframeRef.current
    if (iframe === null || frame.snapshot !== undefined) {
      setCommentBridgeReady(false)
      return
    }
    setCommentBridgeReady(false)
    const bridge = connectBridgedFrameComments({
      target: window,
      frameElement: iframe,
      onEvent: (event) => {
        if (event.type === "ready") setCommentBridgeReady(true)
        else if (event.type === "select") onCommentAnchorRef.current(event.anchor)
        else onOpenCommentRef.current(event.id)
      }
    })
    commentBridgeRef.current = bridge
    // Probe immediately in case the iframe's initial ready event fired before
    // this effect subscribed. The bridge acknowledges configure with ready.
    bridge.configure({ enabled: false, color: status.ink, pins: [] })
    return () => {
      bridge.disconnect()
      if (commentBridgeRef.current === bridge) commentBridgeRef.current = null
    }
  }, [frame.snapshot, frame.url, srcdocState.status, status.ink])
  useEffect(() => {
    if (!commentBridgeReady) return
    commentBridgeRef.current?.configure({
      ...(openCommentId === undefined ? {} : { activeId: openCommentId }),
      enabled: commentMode,
      color: status.ink,
      pins: commentThreads.flatMap((thread) =>
        thread.anchor.kind === "element"
          ? [{ id: thread.id, anchor: thread.anchor }]
          : []
      )
    })
  }, [commentBridgeReady, commentMode, commentThreads, openCommentId, status.ink])
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
            ["--crit-status-ui" as string]: statusFan.scale,
            bottom: `calc(100% + ${statusFan.frameGap}px)`,
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
                  const startY =
                    distanceFromFrame * STATUS_PILL_STEP +
                    STATUS_PILL_MOTION.originOffset
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
                        x: finalX,
                        y: finalY,
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
                      <Glyph name={option.glyph} />
                      <span>{option.label}</span>
                    </motion.button>
                  )
                })
              : null}
          </AnimatePresence>
        </div>
      ) : null}
      <div className="crit-frame__surface">
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
            <Glyph name={status.glyph} />
          </button>
          {titleVisible ? (
            <span
              className="crit-frame__title-mask"
              data-editing={titleEditing || undefined}
              title={titleEditing ? undefined : `${shortId}: ${frame.title}`}
            >
              {titleEditing ? (
                <div
                  className="crit-frame__title-editor"
                  onBlur={(event) => {
                    const nextFocus = event.relatedTarget
                    if (
                      nextFocus instanceof Node &&
                      event.currentTarget.contains(nextFocus)
                    ) return
                    commitTitle()
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <span className="crit-frame__title-prefix">{shortId}:</span>
                  <span
                    className="crit-frame__title-input-sizer"
                    data-value={titleDraft || " "}
                  >
                    <input
                      aria-label="Frame title"
                      autoComplete="off"
                      autoFocus
                      spellCheck={false}
                      {...helpTarget({
                        name: "Frame title",
                        hotkey: "Enter · Esc",
                        description: "Rename the frame. Press Enter to save or Escape to cancel."
                      })}
                      onChange={(event) => setTitleDraft(event.currentTarget.value)}
                      onKeyDown={(event) => {
                        event.stopPropagation()
                        if (event.key === "Enter") {
                          event.preventDefault()
                          commitTitle()
                        }
                        if (event.key === "Escape") {
                          event.preventDefault()
                          setTitleDraft(frame.title)
                          setTitleEditing(false)
                        }
                      }}
                      value={titleDraft}
                    />
                  </span>
                  <button
                    aria-label="Save frame title"
                    className="crit-frame__title-save"
                    onClick={commitTitle}
                    type="button"
                  >
                    <Glyph name="save" />
                  </button>
                </div>
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
                  <Glyph className="crit-frame__title-edit-icon" name="edit" />
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
                <Glyph name="snapshot" />
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
              <Glyph name="openExternal" />
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
              <Glyph name={fullscreen ? "minimize" : "fullscreen"} />
            </button> : null}
            {actions.delete ? <button
              aria-keyshortcuts="Backspace"
              aria-label={`Delete ${frame.title}`}
              className="crit-frame__action"
              {...helpTarget({
                name: "Remove frame",
                hotkey: "Del",
                description: "Remove this frame from the canvas."
              })}
              onClick={onRemove}
              type="button"
            ><Glyph name="trash" /></button> : null}
        </div>
        </header>
        <div className="crit-frame__viewport">
        {iframeVisible && usesSrcdoc && srcdocState.status !== "ready" ? (
          <div className="crit-frame__paused" role={srcdocState.status === "error" ? "alert" : "status"}>
            {srcdocState.status === "error" ? (
              <><span>Unable to load frame: {srcdocState.error}</span>{" "}<button
                onClick={() => setSrcdocAttempt((attempt) => attempt + 1)}
                type="button"
              >Retry</button></>
            ) : "Loading frame…"}
          </div>
        ) : iframeVisible ? (
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
            {...(usesSrcdoc && srcdocState.status === "ready"
              ? { srcDoc: srcdocState.html }
              : { src: frame.url })}
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
        {frame.snapshot === undefined ? commentThreads
          .filter((thread) => thread.anchor.kind === "frame")
          .map((thread) => {
            if (thread.anchor.kind !== "frame") return null
            return <CanvasCommentPin
              active={openCommentId === thread.id}
              authorName={thread.opening.author.name}
              color={status.ink}
              key={thread.id}
              onOpen={() => onOpenComment(thread.id)}
              xRatio={thread.anchor.xRatio}
              yRatio={thread.anchor.yRatio}
            />
          }) : null}
        {commentMode && frame.snapshot === undefined && !commentBridgeReady ? (
          <button
            aria-label={`Place a comment on ${frame.title}`}
            className="crit-frame__comment-fallback"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              onCommentAnchor({
                kind: "frame",
                xRatio: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
                yRatio: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
              })
            }}
            onContextMenu={(event) => event.preventDefault()}
            onPointerDown={(event) => event.stopPropagation()}
            type="button"
          />
        ) : null}
        </div>
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
