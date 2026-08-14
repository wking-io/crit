import { Effect } from "effect"
import { AnimatePresence, motion } from "motion/react"
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
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
import {
  cssVariableStyle,
  type CssVariableStyle
} from "./css-variable-style.js"
import { canvasUiScale } from "./canvas-camera.js"
import {
  CritContextMenu,
  type ContextMenuPosition
} from "./canvas-context-menu.js"
import {
  useCanvasActionRunner,
  useCanvasControls
} from "./canvas-action-runner.js"
import { canvasItemStyle } from "./canvas-item-style.js"
import {
  CanvasSelection,
  type ResizeHandlePosition
} from "./canvas-selection.js"
import { CanvasCommentPin } from "./canvas-comment-pin.js"
import {
  CanvasHelpPanel,
  actionHelpTarget,
  informationalHelpTarget
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
import {
  FRAME_SIZE_PRESETS,
  type FrameSizePreset
} from "./frame-breakpoints.js"
import { Glyph } from "./glyph.js"

export type FrameToolbarMode = "full" | "compact" | "minimal"
export type FrameChromeAction =
  | "snapshot"
  | "breakpoints"
  | "open"
  | "fullscreen"
  | "delete"

export interface FrameChromeSettings {
  readonly titleMinimumCharacters: number
  readonly snapshotMinimumWidth: number
  readonly breakpointsMinimumWidth: number
  readonly openMinimumWidth: number
  readonly fullscreenMinimumWidth: number
  readonly deleteMinimumWidth: number
}

export const DEFAULT_FRAME_CHROME_SETTINGS: FrameChromeSettings = {
  titleMinimumCharacters: 10,
  snapshotMinimumWidth: 148,
  breakpointsMinimumWidth: 170,
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

export const frameContentProjection = (
  width: number,
  height: number,
  zoom: number
) => ({
  iframeHeight: Math.max(0, height),
  iframeWidth: Math.max(0, width),
  shellHeight:
    Math.max(0, height) + FRAME_CHROME_HEIGHT * frameUiScale(zoom),
  shellWidth: Math.max(0, width)
})

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
  settings?: Partial<FrameChromeSettings>,
  breakpointsAvailable = true
): FrameChromeLayout => {
  const resolved = resolveFrameChromeSettings(settings)
  const screenWidth = worldWidth * zoom
  const actions = {
    snapshot:
      snapshotAvailable && screenWidth >= resolved.snapshotMinimumWidth,
    breakpoints:
      breakpointsAvailable && screenWidth >= resolved.breakpointsMinimumWidth,
    open: screenWidth >= resolved.openMinimumWidth,
    fullscreen: screenWidth >= resolved.fullscreenMinimumWidth,
    delete: screenWidth >= resolved.deleteMinimumWidth
  }
  const actionCount = Object.values(actions).filter(Boolean).length
  const metrics = frameChromeMetrics(worldWidth, zoom, actionCount, resolved)
  return { ...metrics, actions }
}

export { FRAME_SIZE_PRESETS } from "./frame-breakpoints.js"

export function FrameCard({
  frame,
  frameChrome,
  geometry,
  iframeAllow,
  iframeSandbox,
  iframeUrl = frame.url,
  iframeVisible,
  selected,
  shortId,
  zoom,
  commentMode,
  commentThreads,
  defaultStatusMenuOpen = false,
  openCommentId,
  onBringToFront,
  onFitContent,
  onMove,
  onRemove,
  onResize,
  onSelect,
  onInputIntent,
  onCommentAnchor,
  onCompleteBreakpoints,
  onDuplicateAt,
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
  readonly iframeUrl?: string
  readonly iframeVisible: boolean
  readonly selected: boolean
  readonly shortId: string
  readonly zoom: number
  readonly commentMode: boolean
  readonly commentThreads: ReadonlyArray<CanvasCommentThread>
  readonly defaultStatusMenuOpen?: boolean
  readonly openCommentId?: string
  readonly onBringToFront: () => Effect.Effect<unknown, unknown>
  readonly onFitContent: (height: number) => Effect.Effect<unknown, unknown>
  readonly onMove: (event: ReactPointerEvent, item: CanvasFrame) => void
  readonly onRemove: () => Effect.Effect<unknown, unknown>
  readonly onResize: (
    event: ReactPointerEvent,
    item: CanvasFrame,
    handle: ResizeHandlePosition
  ) => void
  readonly onSelect: (additive?: boolean) => void
  readonly onInputIntent: (intent: FrameInputIntent) => void
  readonly onCommentAnchor: (anchor: CommentAnchor) => Effect.Effect<unknown, unknown>
  readonly onCompleteBreakpoints: () => Effect.Effect<unknown, unknown>
  readonly onDuplicateAt: (preset: FrameSizePreset) => Effect.Effect<unknown, unknown>
  readonly onOpenComment: (id: string) => Effect.Effect<unknown, unknown>
  readonly onSnapshot?: () => Effect.Effect<unknown, unknown>
  readonly onSnapshotError: (cause: unknown) => void
  readonly onSendToBack: () => Effect.Effect<unknown, unknown>
  readonly onSetSize: (width: number, height: number) => Effect.Effect<unknown, unknown>
  readonly onStatus: (status: FrameReviewStatus) => Effect.Effect<unknown, unknown>
  readonly onTitle: (title: string) => Effect.Effect<unknown, unknown>
}) {
  const frameRef = useRef<HTMLElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuPosition | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [statusMenuOpen, setStatusMenuOpen] = useState(defaultStatusMenuOpen)
  const [titleDraft, setTitleDraft] = useState(frame.title)
  const [titleEditing, setTitleEditing] = useState(false)
  const [commentBridgeReady, setCommentBridgeReady] = useState(false)
  const actionScopes = contextMenu !== null
    ? ["canvas", "menu"] as const
    : titleEditing
      ? ["canvas", "frame-title-edit"] as const
      : fullscreen
        ? ["canvas", "fullscreen"] as const
        : ["canvas"] as const
  const controls = useCanvasControls(actionScopes, true)
  const runner = useCanvasActionRunner()
  const target = {
    kind: "frame" as const,
    id: frame.id,
    label: frame.title
  }
  const commentBridgeRef = useRef<ReturnType<typeof connectBridgedFrameComments> | null>(null)
  const onCommentAnchorRef = useRef(onCommentAnchor)
  const onOpenCommentRef = useRef(onOpenComment)
  onCommentAnchorRef.current = onCommentAnchor
  onOpenCommentRef.current = onOpenComment
  useEffect(() => setTitleDraft(frame.title), [frame.title])
  useEffect(() => {
    if (!selected) setTitleEditing(false)
  }, [selected])
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
    frameChrome,
    frame.snapshot === undefined
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
  const contentProjection = frameContentProjection(
    geometry.width,
    geometry.height,
    zoom
  )
  const statusFan = statusFanProjection(zoom, statusFrameGap)
  const frameStyle = {
    ...canvasItemStyle(geometry, frame.zIndex),
    height: contentProjection.shellHeight,
    "--crit-ui": uiScale,
    "--frame-ink": status.ink,
    "--frame-shell": status.shell,
    "--frame-stroke": status.stroke
  } satisfies CssVariableStyle

  const measureContentHeight = useCallback((force = false) => Effect.suspend(() => {
    const iframe = iframeRef.current
    if (iframe === null) {
      return Effect.fail(new Error("Frame content is not currently loaded"))
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
      const nextHeight = Math.ceil(contentHeight)
      if (force || Math.abs(nextHeight - geometry.height) > 1) {
        return onFitContent(nextHeight)
      }
      return Effect.void
    } catch {
      return Effect.fail(new Error(
        "Fit content requires a same-origin frame or a Crit height bridge"
      ))
    }
  }), [geometry.height, onFitContent])

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
          ? new ResizeObserver(() => Effect.runFork(
              measureContentHeight().pipe(
                Effect.catch((cause) => Effect.sync(() => onSnapshotError(cause)))
              )
            ))
          : null
        const contentDocument = iframe.contentDocument
        if (resizeObserver !== null && contentDocument !== null) {
          resizeObserver.observe(contentDocument.documentElement)
          if (contentDocument.body !== null) resizeObserver.observe(contentDocument.body)
          Effect.runFork(measureContentHeight().pipe(
            Effect.catch((cause) => Effect.sync(() => onSnapshotError(cause)))
          ))
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
    iframeUrl
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
        else if (event.type === "select") {
          runner.run(
            controls,
            placeCommentAction,
            onCommentAnchorRef.current(event.anchor),
            onSnapshotError
          )
        } else {
          const action = controls.action({
            id: "open-comment",
            target: { kind: "comment-thread", id: event.id, label: "comment" }
          })
          runner.run(
            controls,
            action,
            onOpenCommentRef.current(event.id),
            onSnapshotError
          )
        }
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
  }, [frame.snapshot, frame.url, iframeUrl, status.ink])
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
  const snapshotAction = controls.action({
    id: "take-frame-snapshot",
    target,
    snapshotAvailable: frame.snapshot === undefined && onSnapshot !== undefined
  })
  const takeSnapshot = () => {
    if (onSnapshot === undefined) return
    runner.run(controls, snapshotAction, onSnapshot(), onSnapshotError)
  }
  const beginTitleEditAction = controls.action({
    id: "begin-frame-title-edit",
    target,
    editable: frame.snapshot === undefined
  })
  const saveTitleAction = controls.action({
    id: "save-frame-title-edit",
    target,
    editable: frame.snapshot === undefined
  })
  const cancelTitleAction = controls.action({
    id: "cancel-frame-title-edit",
    target,
    editable: frame.snapshot === undefined
  })
  const breakpointAction = controls.action({
    id: "show-frame-breakpoints",
    target,
    frameIsLive: frame.snapshot === undefined
  })
  const openAction = controls.action({ id: "open-frame-new-tab", target })
  const fullscreenAction = controls.action({
    id: fullscreen ? "exit-frame-fullscreen" : "enter-frame-fullscreen",
    target
  })
  const removeAction = controls.action({
    id: "remove-item",
    target
  })
  const placeCommentAction = controls.action({
    id: "place-comment",
    target,
    frameIsLive: frame.snapshot === undefined
  })
  const commitTitle = () => {
    const title = titleDraft.trim()
    const effect = title.length > 0 && title !== frame.title
      ? onTitle(title)
      : Effect.sync(() => setTitleDraft(frame.title))
    runner.run(
      controls,
      saveTitleAction,
      effect.pipe(Effect.ensuring(Effect.sync(() => setTitleEditing(false)))),
      onSnapshotError
    )
  }
  const toggleFullscreen = () => {
    if (document.fullscreenElement === frameRef.current) {
      return document.exitFullscreen()
    } else {
      return frameRef.current?.requestFullscreen() ?? Promise.resolve()
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
      onPointerDown={(event) => onSelect(
        event.metaKey || event.ctrlKey || event.shiftKey
      )}
      ref={frameRef}
      style={frameStyle}
    >
      {frame.snapshot === undefined ? (
        <div
          aria-label={`Set status for ${frame.title}`}
          className="crit-status-menu"
          onPointerDown={(event) => event.stopPropagation()}
          role="menu"
          style={cssVariableStyle({
            "--crit-status-ui": statusFan.scale,
            bottom: `calc(100% + ${statusFan.frameGap}px)`,
            pointerEvents: statusMenuOpen ? "all" : "none"
          })}
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
                    else {
                      const action = controls.action({
                        id: "set-frame-status",
                        target,
                        status: option.id,
                        frameIsLive: frame.snapshot === undefined
                      })
                      const reviewStatus = option.id
                      runner.run(
                        controls,
                        action,
                        onStatus(reviewStatus),
                        onSnapshotError
                      )
                    }
                    setStatusMenuOpen(false)
                  }
                  const statusAction = option.id === "archived"
                    ? snapshotAction
                    : controls.action({
                        id: "set-frame-status",
                        target,
                        status: option.id,
                        frameIsLive: frame.snapshot === undefined
                      })
                  const optionStyle = cssVariableStyle({
                    "--status-ink": option.ink,
                    "--status-shell": option.shell,
                    "--status-stroke": option.stroke
                  })
                  // SAFETY: Motion forwards CSS custom properties to the DOM,
                  // but its style type conflicts with React's optional SVG x property.
                  const motionOptionStyle = optionStyle as ComponentProps<
                    typeof motion.button
                  >["style"] & {}
                  return (
                    <motion.button
                      aria-checked={false}
                      className="crit-status-option"
                      disabled={statusAction.availability !== "enabled"}
                      {...actionHelpTarget(statusAction)}
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
                      style={motionOptionStyle}
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
                      <span>{statusAction.label}</span>
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
        {...informationalHelpTarget({
          name: "Move frame",
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
            disabled={controls.action({
              id: "open-frame-status",
              target,
              frameIsLive: frame.snapshot === undefined
            }).availability !== "enabled"}
            {...actionHelpTarget(controls.action({
              id: "open-frame-status",
              target,
              frameIsLive: frame.snapshot === undefined
            }))}
            onClick={() => {
              const action = controls.action({
                id: "open-frame-status",
                target,
                frameIsLive: frame.snapshot === undefined
              })
              runner.run(
                controls,
                action,
                Effect.sync(() => setStatusMenuOpen((open) => !open))
              )
            }}
            onPointerDown={(event) => event.stopPropagation()}
            type="button"
          >
            <Glyph name={status.glyph} />
          </button>
          {titleVisible ? (
            <span
              className="crit-frame__title-mask"
              data-editing={titleEditing && selected || undefined}
              title={titleEditing && selected ? undefined : `${shortId}: ${frame.title}`}
            >
              {titleEditing && selected ? (
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
                      aria-keyshortcuts={`${saveTitleAction.ariaKeyShortcuts ?? ""} ${cancelTitleAction.ariaKeyShortcuts ?? ""}`.trim()}
                      {...actionHelpTarget(saveTitleAction)}
                      onChange={(event) => setTitleDraft(event.currentTarget.value)}
                      onKeyDown={(event) => {
                        event.stopPropagation()
                        if (event.key === "Enter") {
                          event.preventDefault()
                          commitTitle()
                        }
                        if (event.key === "Escape") {
                          event.preventDefault()
                          runner.run(
                            controls,
                            cancelTitleAction,
                            Effect.sync(() => {
                              setTitleDraft(frame.title)
                              setTitleEditing(false)
                            })
                          )
                        }
                      }}
                      value={titleDraft}
                    />
                  </span>
                  <button
                    aria-keyshortcuts={saveTitleAction.ariaKeyShortcuts}
                    aria-label={saveTitleAction.label}
                    className="crit-frame__title-save"
                    disabled={saveTitleAction.availability !== "enabled"}
                    {...actionHelpTarget(saveTitleAction)}
                    onClick={commitTitle}
                    type="button"
                  >
                    <Glyph name="save" />
                  </button>
                </div>
              ) : selected ? (
                <button
                  aria-label={`Edit frame title: ${frame.title}`}
                  className="crit-frame__title-button"
                  disabled={beginTitleEditAction.availability !== "enabled"}
                  {...actionHelpTarget(beginTitleEditAction)}
                  onClick={() => runner.run(
                    controls,
                    beginTitleEditAction,
                    Effect.sync(() => setTitleEditing(true))
                  )}
                  onPointerDown={(event) => event.stopPropagation()}
                  type="button"
                >
                  <span className="crit-frame__title-track">
                    <strong>{shortId}: {frame.title}</strong>
                    <strong>{status.label}</strong>
                  </span>
                  <Glyph className="crit-frame__title-edit-icon" name="edit" />
                </button>
              ) : (
                <span className="crit-frame__title-label">
                  <span className="crit-frame__title-track">
                    <strong>{shortId}: {frame.title}</strong>
                    <strong>{status.label}</strong>
                  </span>
                </span>
              )}
            </span>
          ) : null}
        </div>
        <div className="crit-frame__actions" onPointerDown={(event) => event.stopPropagation()}>
            {frame.snapshot === undefined && actions.breakpoints ? (
              <button
                aria-label={breakpointAction.label}
                className="crit-frame__action"
                disabled={breakpointAction.availability !== "enabled"}
                {...actionHelpTarget(breakpointAction)}
                onClick={() => runner.run(
                  controls,
                  breakpointAction,
                  onCompleteBreakpoints(),
                  onSnapshotError
                )}
                type="button"
              >
                <Glyph name="responsiveBreakpoints" />
              </button>
            ) : null}
            {frame.snapshot === undefined && onSnapshot !== undefined && actions.snapshot ? (
              <button
                aria-label={snapshotAction.reason === "action-pending" ? "Taking snapshot" : snapshotAction.label}
                className="crit-frame__action"
                data-snapshotting={snapshotAction.reason === "action-pending" || undefined}
                disabled={snapshotAction.availability !== "enabled"}
                {...actionHelpTarget(snapshotAction)}
                onClick={takeSnapshot}
                type="button"
              >
                <Glyph name="snapshot" />
              </button>
            ) : null}
            {actions.open ? <a
              aria-label={openAction.label}
              className="crit-frame__action"
              {...actionHelpTarget(openAction)}
              href={frame.url}
              rel="noreferrer"
              target="_blank"
            >
              <Glyph name="openExternal" />
            </a> : null}
            {actions.fullscreen ? <button
              aria-label={fullscreenAction.label}
              className="crit-frame__action"
              aria-keyshortcuts={fullscreenAction.ariaKeyShortcuts}
              disabled={fullscreenAction.availability !== "enabled"}
              {...actionHelpTarget(fullscreenAction)}
              onClick={() => runner.run(
                controls,
                fullscreenAction,
                Effect.promise(toggleFullscreen),
                onSnapshotError
              )}
              type="button"
            >
              <Glyph name={fullscreen ? "minimize" : "fullscreen"} />
            </button> : null}
            {actions.delete ? <button
              aria-keyshortcuts={removeAction.ariaKeyShortcuts}
              aria-label={removeAction.label}
              className="crit-frame__action"
              disabled={removeAction.availability !== "enabled"}
              {...actionHelpTarget(removeAction)}
              onClick={() => runner.run(
                controls,
                removeAction,
                onRemove(),
                onSnapshotError
              )}
              type="button"
            ><Glyph name="trash" /></button> : null}
        </div>
        </header>
        <div className="crit-frame__viewport">
        {iframeVisible ? (
          <iframe
            allow={iframeAllow}
            // The relay URL is stable by Frame identity, so recreate the
            // browsing context when that Frame's canonical URL changes.
            ref={iframeRef}
            referrerPolicy="no-referrer"
            // Snapshot Artifacts are captured foreign pages with their CSP
            // stripped, served from the dev-server origin — never let their
            // scripts run same-origin with the host app and the Crit API.
            sandbox={
              iframeSandbox ??
              (frame.snapshot === undefined ? undefined : "allow-scripts")
            }
            src={iframeUrl}
            title={frame.title}
          />
        ) : <div
          className="crit-frame__paused"
          {...informationalHelpTarget({
            name: "Paused frame",
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
              threadId={thread.id}
              xRatio={thread.anchor.xRatio}
              yRatio={thread.anchor.yRatio}
            />
          }) : null}
        {commentMode && frame.snapshot === undefined && !commentBridgeReady ? (
          <button
            aria-label={`Place a comment on ${frame.title}`}
            className="crit-frame__comment-fallback"
            disabled={placeCommentAction.availability !== "enabled"}
            {...actionHelpTarget(placeCommentAction)}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              runner.run(
                controls,
                placeCommentAction,
                onCommentAnchor({
                  kind: "frame",
                  xRatio: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
                  yRatio: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
                }),
                onSnapshotError
              )
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
          ink="var(--frame-ink)"
          label={frame.title}
          onResize={(event, handle) => onResize(event, frame, handle)}
          shell={status.shell}
          zoom={zoom}
        />
      ) : null}
      {fullscreen ? <CanvasHelpPanel /> : null}
      <CritContextMenu
        ariaLabel={`Actions for ${frame.title}`}
        items={[
          {
            action: removeAction,
            execute: onRemove(),
            onFailure: onSnapshotError
          },
          {
            action: fullscreenAction,
            execute: Effect.promise(toggleFullscreen),
            onFailure: onSnapshotError
          },
          {
            action: openAction,
            href: frame.url,
          },
          {
            action: controls.action({
              id: "bring-item-to-front",
              target
            }),
            execute: onBringToFront()
          },
          {
            action: controls.action({
              id: "send-item-to-back",
              target
            }),
            execute: onSendToBack()
          },
          {
            action: controls.action({
              id: "open-frame-size-menu",
              target
            }),
            items: FRAME_SIZE_PRESETS.map((preset) => ({
              action: controls.action({
                id: "resize-frame-to-preset",
                target,
                preset: preset.id
              }),
              detail: `${preset.width} × ${preset.height}`,
              execute: onSetSize(preset.width, preset.height)
            }))
          },
          ...(frame.snapshot === undefined ? [{
            action: controls.action({
              id: "open-frame-duplicate-menu" as const,
              target,
              frameIsLive: true
            }),
            items: FRAME_SIZE_PRESETS.map((preset) => ({
              action: controls.action({
                id: "duplicate-frame-at-preset",
                target,
                preset: preset.id,
                frameIsLive: true
              }),
              detail: `${preset.width} × ${preset.height}`,
              execute: onDuplicateAt(preset)
            }))
          }] : []),
          {
            action: controls.action({ id: "fit-frame-content", target }),
            execute: measureContentHeight(true),
            onFailure: onSnapshotError
          }
        ]}
        onClose={() => setContextMenu(null)}
        position={contextMenu}
      />
    </section>
  )
}
