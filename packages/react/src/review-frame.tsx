import { Button } from "@base-ui/react/button"
import { Input } from "@base-ui/react/input"
import { Menu } from "@base-ui/react/menu"
import type { Frame } from "@crit/domain"
import { Predicate } from "effect"
import {
  AnimatePresence,
  LazyMotion,
  MotionConfig,
  animate,
  domAnimation,
  m,
  useMotionValue,
  usePresence,
  useReducedMotion,
  useTransform
} from "motion/react"
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
  type RefObject
} from "react"

import {
  CritContextActions,
  ReviewMenuItem
} from "./canvas-context-menu.js"
import { ConfirmationDialog } from "./confirmation-dialog.js"
import { cssVariableStyle } from "./css-variable-style.js"
import {
  FRAME_SIZE_PRESETS,
  presetSizeDetail
} from "./frame-breakpoints.js"
import {
  STATUS_PILL_MOTION,
  calculateStatusFanLayout,
  frameStatus,
  frameStatusMenuOptions,
  statusFanProjection,
  statusMenuFrameZIndex,
  statusPillMotionPath,
  type FrameStatusChrome
} from "./frame-status-chrome.js"
import { Glyph } from "./glyph.js"
import {
  ReviewActionInput,
  reviewActionPolicy,
  type ReviewActionId
} from "./review-actions.js"
import {
  reviewActionHelpTarget,
  reviewInformationalHelpTarget
} from "./review-help.js"
import { useOptionalReviewRunner, type ReviewRunner } from "./review-runner.js"
import {
  ReviewSelectionChrome,
  type ResizeHandlePosition
} from "./review-selection-chrome.js"

export const canvasUiScale = (zoom: number): number =>
  1 / Math.max(0.05, zoom)

const itemStyle = (
  geometry: Frame["geometry"],
  zIndex: number
): CSSProperties => ({
  height: geometry.height,
  left: geometry.x,
  position: "absolute",
  top: geometry.y,
  width: geometry.width,
  zIndex
})

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

const frameToolbarMode = (screenWidth: number, actionCount: number) => {
  const fixedWidth = frameChromeFixedWidth(actionCount)
  const titleMinimumWidth = FRAME_TITLE_CHARACTER_WIDTH * 10
  return screenWidth - fixedWidth > titleMinimumWidth
    ? "full"
    : screenWidth >= fixedWidth
      ? "compact"
      : "minimal"
}

const liveFrameUrl = (frame: Frame): string | undefined =>
  Predicate.isTagged(frame.representation, "webUrl")
    ? frame.representation.url
    : undefined

const isLiveFrame = (frame: Frame): boolean =>
  !Predicate.isTagged(frame.representation, "artifact")

const statusActionId = (
  statusId: FrameStatusChrome["id"]
): ReviewActionId => {
  if (statusId === "in-progress") return "set-frame-status-in-progress"
  if (statusId === "ready-for-review") return "set-frame-status-ready-for-review"
  if (statusId === "changes-requested") return "set-frame-status-changes-requested"
  return "set-frame-status-approved"
}

const visibleFrameActions = (
  canMutate: boolean,
  live: boolean,
  screenWidth: number,
  snapshotAvailable: boolean,
  hasUrl: boolean
) => ({
  snapshot: snapshotAvailable && screenWidth >= 148,
  breakpoints: canMutate && live && screenWidth >= 170,
  open: hasUrl && screenWidth >= 82,
  fullscreen: canMutate && screenWidth >= 104,
  delete: canMutate && screenWidth >= 60
})

const reviewFrameMenuItems = (input: {
  readonly fullscreenPolicy: ReturnType<typeof reviewActionPolicy>
  readonly live: boolean
  readonly onFitContent: () => void
  readonly onRemove: () => void
  readonly openPolicy: ReturnType<typeof reviewActionPolicy>
  readonly removePolicy: ReturnType<typeof reviewActionPolicy>
  readonly runner: ReviewRunner
  readonly url: string | undefined
}) => [
  ReviewMenuItem.action({
    policy: input.removePolicy,
    disabled: !input.runner.runnableIds.has("remove"),
    onSelect: input.onRemove
  }),
  ReviewMenuItem.action({
    policy: input.fullscreenPolicy,
    disabled: !input.runner.runnableIds.has(input.fullscreenPolicy.id),
    onSelect: () => input.runner.run(input.fullscreenPolicy.id)
  }),
  ...(input.url === undefined
    ? []
    : [ReviewMenuItem.link({
      policy: input.openPolicy,
      href: input.url
    })]),
  ReviewMenuItem.action({
    policy: reviewActionPolicy("bring-to-front"),
    disabled: !input.runner.runnableIds.has("bring-to-front"),
    onSelect: () => input.runner.run("bring-to-front")
  }),
  ReviewMenuItem.action({
    policy: reviewActionPolicy("send-to-back"),
    disabled: !input.runner.runnableIds.has("send-to-back"),
    onSelect: () => input.runner.run("send-to-back")
  }),
  ...(input.live
    ? [
      ReviewMenuItem.submenu({
        id: "set-size",
        label: "Set size",
        description: "Resize this Frame to a standard viewport size.",
        items: FRAME_SIZE_PRESETS.map((preset) => {
          const id = `resize-frame-${preset.id}` as const
          return ReviewMenuItem.action({
            policy: reviewActionPolicy(id),
            disabled: !input.runner.runnableIds.has(id),
            detail: presetSizeDetail(preset),
            onSelect: () => input.runner.run(id)
          })
        })
      }),
      ReviewMenuItem.submenu({
        id: "duplicate-at-preset",
        label: "Duplicate at preset",
        description: "Duplicate this live Frame at a standard viewport size.",
        items: FRAME_SIZE_PRESETS.map((preset) => {
          const id = `duplicate-frame-${preset.id}` as const
          return ReviewMenuItem.action({
            policy: reviewActionPolicy(id),
            disabled: !input.runner.runnableIds.has(id),
            detail: presetSizeDetail(preset),
            onSelect: () => input.runner.run(id)
          })
        })
      }),
      ReviewMenuItem.action({
        policy: reviewActionPolicy("fit-frame-content"),
        onSelect: input.onFitContent
      })
    ]
    : [])
]

export const measureFrameContentHeight = (
  frameElement: HTMLElement
): number | undefined => {
  const iframe = frameElement.querySelector("iframe")
  if (!(iframe instanceof HTMLIFrameElement)) return undefined
  try {
    const contentDocument = iframe.contentDocument
    if (contentDocument === null) return undefined
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
    const chrome = frameElement.querySelector(".crit-frame__chrome")
    const chromeHeight = chrome instanceof HTMLElement
      ? chrome.getBoundingClientRect().height
      : FRAME_CHROME_HEIGHT
    return Math.max(120, Math.ceil(contentHeight + chromeHeight))
  } catch {
    return undefined
  }
}

function StatusPillOption({
  disabled,
  finalRotate,
  finalX,
  finalY,
  helpTarget,
  label,
  onSelect,
  option,
  startY,
  width
}: {
  readonly disabled: boolean
  readonly finalRotate: number
  readonly finalX: number
  readonly finalY: number
  readonly helpTarget: ReturnType<typeof reviewActionHelpTarget>
  readonly label: string
  readonly onSelect: () => void
  readonly option: FrameStatusChrome
  readonly startY: number
  readonly width: number
}) {
  const motionPath = useMemo(() => statusPillMotionPath({
    startY,
    finalX,
    finalY,
    finalRotate
  }), [finalRotate, finalX, finalY, startY])
  const progress = useMotionValue(0)
  const x = useTransform(
    progress,
    motionPath.times,
    motionPath.enter.x,
    { clamp: true }
  )
  const y = useTransform(
    progress,
    motionPath.times,
    motionPath.enter.y,
    { clamp: true }
  )
  const rotate = useTransform(
    progress,
    motionPath.times,
    motionPath.enter.rotate,
    { clamp: true }
  )
  const opacity = useTransform(progress, [0, 0.45, 1], [0, 1, 1])
  const scale = useTransform(
    progress,
    [0, 1],
    [STATUS_PILL_MOTION.initialScale, 1]
  )
  const [isPresent, safeToRemove] = usePresence()
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    if (reduceMotion) {
      progress.set(isPresent ? 1 : 0)
      if (!isPresent) safeToRemove?.()
      return
    }
    const playback = animate(
      progress,
      isPresent ? 1 : 0,
      isPresent
        ? STATUS_PILL_MOTION.spring
        : STATUS_PILL_MOTION.close
    )
    if (!isPresent) playback.then(() => safeToRemove?.())
    return () => playback.stop()
  }, [isPresent, progress, reduceMotion, safeToRemove])

  return (
    <Menu.Item
      aria-label={label}
      className="crit-status-option"
      disabled={disabled}
      {...helpTarget}
      label={label}
      nativeButton
      onClick={(event) => {
        if (event.detail === 0) onSelect()
      }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerUp={(event) => {
        if (!event.isPrimary || event.button !== 0) return
        onSelect()
      }}
      render={
        <m.button
          style={{ opacity, rotate, scale, x, y }}
          type="button"
        />
      }
      style={cssVariableStyle({
        "--status-ink": option.ink,
        "--status-shell": option.shell,
        "--status-stroke": option.stroke,
        width: `${width}px`
      })}
    >
      <Glyph name={option.glyph} />
      <span>{option.label}</span>
    </Menu.Item>
  )
}

function FrameStatusFan({
  frameElementRef,
  frameTitle,
  restoreStatusTriggerFocusRef,
  runner,
  statusFan,
  statusMenuActionsRef,
  statusMenuHandle,
  statusMenuOpen,
  statusMenuTriggerId,
  statusMenuTriggerRef,
  statusPillLayout,
  setStatusMenuLayerActive,
  setStatusMenuOpen
}: {
  readonly frameElementRef: RefObject<HTMLDivElement | null>
  readonly frameTitle: string
  readonly restoreStatusTriggerFocusRef: MutableRefObject<boolean>
  readonly runner: ReviewRunner
  readonly statusFan: ReturnType<typeof statusFanProjection>
  readonly statusMenuActionsRef: MutableRefObject<Menu.Root.Actions | null>
  readonly statusMenuHandle: ReturnType<typeof Menu.createHandle>
  readonly statusMenuOpen: boolean
  readonly statusMenuTriggerId: string
  readonly statusMenuTriggerRef: RefObject<HTMLButtonElement | null>
  readonly statusPillLayout: ReturnType<typeof calculateStatusFanLayout<FrameStatusChrome>>
  readonly setStatusMenuLayerActive: (active: boolean) => void
  readonly setStatusMenuOpen: (open: boolean) => void
}) {
  return (
    <Menu.Root
      actionsRef={statusMenuActionsRef}
      handle={statusMenuHandle}
      modal={false}
      onOpenChange={(open, eventDetails) => {
        if (!open) {
          restoreStatusTriggerFocusRef.current =
            eventDetails.reason === "escape-key" ||
            eventDetails.reason === "item-press"
          eventDetails.preventUnmountOnClose()
          setStatusMenuOpen(false)
          return
        }
        setStatusMenuLayerActive(true)
        setStatusMenuOpen(true)
      }}
      open={statusMenuOpen}
      triggerId={statusMenuTriggerId}
    >
      <Menu.Portal container={frameElementRef}>
        <Menu.Positioner
          anchor={frameElementRef}
          className="crit-status-positioner"
          collisionAvoidance={{
            align: "none",
            fallbackAxisSide: "none",
            side: "none"
          }}
          side="top"
        >
          <Menu.Popup
            aria-label={`Set status for ${frameTitle}`}
            className="crit-status-menu"
            onPointerDown={(event) => event.stopPropagation()}
            style={cssVariableStyle({
              "--crit-status-frame-gap": `${statusFan.frameGap}px`,
              "--crit-status-ui": statusFan.scale
            })}
          >
            <AnimatePresence
              onExitComplete={() => {
                if (!statusMenuOpen) {
                  statusMenuActionsRef.current?.unmount()
                  setStatusMenuLayerActive(false)
                  if (restoreStatusTriggerFocusRef.current) {
                    statusMenuTriggerRef.current?.focus()
                  }
                  restoreStatusTriggerFocusRef.current = false
                }
              }}
            >
              {statusMenuOpen
                ? statusPillLayout.items.map((item) => {
                  const actionId = statusActionId(item.option.id)
                  const policy = reviewActionPolicy(actionId)
                  return (
                    <StatusPillOption
                      disabled={!runner.runnableIds.has(actionId)}
                      finalRotate={item.finalRotate}
                      finalX={item.finalX}
                      finalY={item.finalY}
                      helpTarget={reviewActionHelpTarget(policy)}
                      key={item.option.id}
                      label={policy.label}
                      onSelect={() => runner.run(actionId)}
                      option={item.option}
                      startY={item.startY}
                      width={item.width}
                    />
                  )
                })
                : null}
            </AnimatePresence>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

function FrameTitleChrome({
  canMutate,
  frameTitle,
  runner,
  selected,
  shortId,
  statusLabel
}: {
  readonly canMutate: boolean
  readonly frameTitle: string
  readonly runner: ReviewRunner | null
  readonly selected: boolean
  readonly shortId: string
  readonly statusLabel: string
}) {
  const [titleDraft, setTitleDraft] = useState(frameTitle)
  const [titleEditing, setTitleEditing] = useState(false)
  const commitTitle = () => {
    const title = titleDraft.trim()
    if (title.length > 0 && title !== frameTitle) {
      runner?.run("set-frame-title", ReviewActionInput.text({ text: title }))
    } else {
      setTitleDraft(frameTitle)
    }
    setTitleEditing(false)
  }
  const editing = titleEditing && selected && canMutate
  const title = (
    editing
      ? (
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
          onContextMenu={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <span className="crit-frame__title-prefix">{shortId}:</span>
          <span
            className="crit-frame__title-input-sizer"
            data-value={titleDraft || " "}
          >
            <Input
              aria-label="Frame title"
              autoComplete="off"
              autoFocus
              spellCheck={false}
              onChange={(event) => setTitleDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                event.stopPropagation()
                if (event.key === "Enter") {
                  event.preventDefault()
                  commitTitle()
                }
                if (event.key === "Escape") {
                  event.preventDefault()
                  setTitleDraft(frameTitle)
                  setTitleEditing(false)
                }
              }}
              value={titleDraft}
            />
          </span>
          <Button
            aria-label="Save title"
            className="crit-frame__title-save"
            onClick={commitTitle}
            type="button"
          >
            <Glyph name="save" />
          </Button>
        </div>
      )
      : selected && canMutate
        ? (
          <Button
            aria-label={`Edit frame title: ${frameTitle}`}
            className="crit-frame__title-button"
            onClick={() => setTitleEditing(true)}
            onPointerDown={(event) => event.stopPropagation()}
            type="button"
          >
            <span className="crit-frame__title-track">
              <strong>{shortId}: {frameTitle}</strong>
              <strong>{statusLabel}</strong>
            </span>
            <Glyph className="crit-frame__title-edit-icon" name="edit" />
          </Button>
        )
        : (
          <span className="crit-frame__title-label">
            <span className="crit-frame__title-track">
              <strong>{shortId}: {frameTitle}</strong>
              <strong>{statusLabel}</strong>
            </span>
          </span>
        )
  )
  return (
    <span
      className="crit-frame__title-mask"
      data-editing={editing || undefined}
      title={editing ? undefined : `${shortId}: ${frameTitle}`}
    >
      {title}
    </span>
  )
}

function FrameIdentity({
  canMutate,
  frameTitle,
  live,
  runner,
  selected,
  shortId,
  status,
  statusMenuHandle,
  statusMenuOpen,
  statusMenuTriggerId,
  statusMenuTriggerRef,
  titleVisible
}: {
  readonly canMutate: boolean
  readonly frameTitle: string
  readonly live: boolean
  readonly runner: ReviewRunner | null
  readonly selected: boolean
  readonly shortId: string
  readonly status: FrameStatusChrome
  readonly statusMenuHandle: ReturnType<typeof Menu.createHandle>
  readonly statusMenuOpen: boolean
  readonly statusMenuTriggerId: string
  readonly statusMenuTriggerRef: RefObject<HTMLButtonElement | null>
  readonly titleVisible: boolean
}) {
  return (
    <div className="crit-frame__identity">
      {live && canMutate
        ? (
          <Menu.Trigger
            aria-expanded={statusMenuOpen}
            aria-label={`Status: ${status.label}. Change status`}
            className="crit-frame__mark"
            handle={statusMenuHandle}
            id={statusMenuTriggerId}
            ref={statusMenuTriggerRef}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <Glyph name={status.glyph} />
          </Menu.Trigger>
        )
        : (
          <span aria-hidden className="crit-frame__mark">
            <Glyph name={status.glyph} />
          </span>
        )}
      {titleVisible
        ? (
          <FrameTitleChrome
            canMutate={canMutate}
            frameTitle={frameTitle}
            key={`${selected}:${frameTitle}`}
            runner={runner}
            selected={selected}
            shortId={shortId}
            statusLabel={status.label}
          />
        )
        : null}
    </div>
  )
}

function FrameActionBar({
  actions,
  breakpointsOpen,
  fullscreenPolicy,
  onRemove,
  openPolicy,
  removePolicy,
  runner,
  setBreakpointsOpen,
  snapshotCapturing,
  snapshotPolicy,
  url
}: {
  readonly actions: ReturnType<typeof visibleFrameActions>
  readonly breakpointsOpen: boolean
  readonly fullscreenPolicy: ReturnType<typeof reviewActionPolicy>
  readonly onRemove: () => void
  readonly openPolicy: ReturnType<typeof reviewActionPolicy>
  readonly removePolicy: ReturnType<typeof reviewActionPolicy>
  readonly runner: ReviewRunner | null
  readonly setBreakpointsOpen: (open: boolean) => void
  readonly snapshotCapturing: boolean
  readonly snapshotPolicy: ReturnType<typeof reviewActionPolicy>
  readonly url: string | undefined
}) {
  return (
    <div
      className="crit-frame__actions"
      onPointerDown={(event) => event.stopPropagation()}
    >
      {actions.breakpoints
        ? (
          <Menu.Root
            onOpenChange={setBreakpointsOpen}
            open={breakpointsOpen}
          >
            <Menu.Trigger
              aria-label="Create breakpoints"
              className="crit-frame__action"
              {...reviewInformationalHelpTarget({
                name: "Breakpoints",
                description: "Resize this Frame to a standard viewport size."
              })}
            >
              <Glyph name="responsiveBreakpoints" />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner
                className="crit-context-menu__positioner"
                side="bottom"
              >
                <Menu.Popup
                  aria-label="Resize to"
                  className="crit-context-menu"
                >
                  {FRAME_SIZE_PRESETS.map((preset) => {
                    const id = `resize-frame-${preset.id}` as const
                    const policy = reviewActionPolicy(id)
                    return (
                      <Menu.Item
                        aria-label={policy.label}
                        className="crit-context-menu__item"
                        disabled={!runner?.runnableIds.has(id)}
                        key={preset.id}
                        {...reviewActionHelpTarget(policy)}
                        onClick={() => runner?.run(id)}
                      >
                        <span>{policy.label}</span>
                        <span className="crit-context-menu__detail">
                          {presetSizeDetail(preset)}
                        </span>
                      </Menu.Item>
                    )
                  })}
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        )
        : null}
      {actions.snapshot
        ? (
          <Button
            aria-label={snapshotCapturing ? "Taking snapshot" : snapshotPolicy.label}
            className="crit-frame__action"
            data-snapshotting={snapshotCapturing || undefined}
            disabled={snapshotCapturing}
            {...reviewActionHelpTarget(snapshotPolicy)}
            onClick={() => runner?.run("snapshot")}
            type="button"
          >
            <Glyph name="snapshot" />
          </Button>
        )
        : null}
      {actions.open && url !== undefined
        ? (
          <Button
            aria-label={openPolicy.label}
            className="crit-frame__action"
            {...reviewActionHelpTarget(openPolicy)}
            onClick={() => runner?.run("open-url")}
            type="button"
          >
            <Glyph name="openExternal" />
          </Button>
        )
        : null}
      {actions.fullscreen
        ? (
          <Button
            aria-label={fullscreenPolicy.label}
            className="crit-frame__action"
            disabled={!runner?.runnableIds.has(fullscreenPolicy.id)}
            {...reviewActionHelpTarget(fullscreenPolicy)}
            onClick={() => runner?.run(fullscreenPolicy.id)}
            type="button"
          >
            <Glyph name={
              fullscreenPolicy.id === "exit-fullscreen"
                ? "minimize"
                : "fullscreen"
            }
            />
          </Button>
        )
        : null}
      {actions.delete
        ? (
          <Button
            aria-label={removePolicy.label}
            className="crit-frame__action"
            disabled={!runner?.runnableIds.has("remove")}
            {...reviewActionHelpTarget(removePolicy)}
            onClick={onRemove}
            type="button"
          >
            <Glyph name="trash" />
          </Button>
        )
        : null}
    </div>
  )
}

export function ReviewFrame({
  capture,
  children,
  frame,
  geometry,
  onMove,
  onResize,
  onSelect,
  selected,
  selectedLabel,
  shortId,
  topZIndex = 0,
  uiScale,
  zIndex,
  frameRef
}: {
  readonly capture: boolean
  readonly children: ReactNode
  readonly frame: Frame
  readonly frameRef: (element: HTMLDivElement | null) => void
  readonly geometry: Frame["geometry"]
  readonly onMove: (event: ReactPointerEvent<HTMLDivElement>) => void
  readonly onResize?:
    | ((
      event: ReactPointerEvent<HTMLElement>,
      handle: ResizeHandlePosition
    ) => void)
    | undefined
  readonly onSelect: (event: ReactPointerEvent<HTMLDivElement>) => void
  readonly selected: boolean
  readonly selectedLabel: true | undefined
  readonly shortId: string
  readonly topZIndex?: number
  readonly uiScale: number
  readonly zIndex: number
}): ReactElement {
  const runner = useOptionalReviewRunner()
  const status = frameStatus(frame.status)
  const live = isLiveFrame(frame)
  const url = liveFrameUrl(frame)
  const canMutate = runner !== null
  const [statusMenuOpen, setStatusMenuOpen] = useState(false)
  const [statusMenuLayerActive, setStatusMenuLayerActive] = useState(false)
  const [breakpointsOpen, setBreakpointsOpen] = useState(false)
  const [removeOpen, setRemoveOpen] = useState(false)
  const statusMenuActionsRef = useRef<Menu.Root.Actions | null>(null)
  const statusMenuTriggerRef = useRef<HTMLButtonElement>(null)
  const restoreStatusTriggerFocusRef = useRef(false)
  const statusMenuTriggerId = useId()
  const [statusMenuHandle] = useState(() => Menu.createHandle())
  const frameElementRef = useRef<HTMLDivElement | null>(null)
  const availableStatuses = frameStatusMenuOptions(status.id)
  const statusPillLayout = calculateStatusFanLayout(availableStatuses)
  const statusFan = statusFanProjection(statusPillLayout.frameGap, uiScale)
  const snapshotPolicy = reviewActionPolicy("snapshot")
  const removePolicy = reviewActionPolicy("remove")
  const openPolicy = reviewActionPolicy("open-url")
  const fullscreenPolicy = reviewActionPolicy(
    runner?.runnableIds.has("exit-fullscreen") === true
      ? "exit-fullscreen"
      : "enter-fullscreen"
  )
  const snapshotCapturing = runner?.snapshotCapturing === true
  const snapshotAvailable = canMutate && live &&
    runner.runnableIds.has("snapshot")
  const screenWidth = geometry.width / uiScale
  const actions = visibleFrameActions(
    canMutate,
    live,
    screenWidth,
    snapshotAvailable,
    url !== undefined
  )
  const actionCount = Object.values(actions).filter(Boolean).length
  const toolbarMode = frameToolbarMode(screenWidth, actionCount)
  const titleVisible = toolbarMode === "full"

  const requestRemove = () => setRemoveOpen(true)
  const fitContent = () => {
    const frameElement = frameElementRef.current
    if (frameElement === null || runner === null) return
    const height = measureFrameContentHeight(frameElement)
    if (height === undefined) return
    runner.run("fit-frame-content", ReviewActionInput.height({ height }))
  }
  const menuItems = runner === null
    ? []
    : reviewFrameMenuItems({
      fullscreenPolicy,
      live,
      onFitContent: fitContent,
      onRemove: requestRemove,
      openPolicy,
      removePolicy,
      runner,
      url
    })

  useEffect(() => {
    const frame = frameElementRef.current
    if (frame === null) return () => {}
    const stop = (event: Event) => event.stopPropagation()
    frame.addEventListener("contextmenu", stop)
    return () => frame.removeEventListener("contextmenu", stop)
  }, [frameElementRef])

  const bindFrameRef = (element: HTMLDivElement | null) => {
    frameElementRef.current = element
    frameRef(element)
  }

  const frameNode = (
    <div
      ref={bindFrameRef}
      aria-label={frame.title}
      aria-selected={selectedLabel}
      className="crit-frame"
      data-frame-id={frame.frameId}
      data-frame-status={frame.status}
      data-review-status={frame.status}
      data-selected={selected || undefined}
      role="option"
      style={cssVariableStyle({
        ...itemStyle(
          geometry,
          statusMenuFrameZIndex(zIndex, topZIndex, statusMenuLayerActive)
        ),
        "--crit-ui": uiScale,
        "--frame-ink": status.ink,
        "--frame-shell": status.shell,
        "--frame-stroke": status.stroke
      })}
      onPointerDown={(event) => {
        onSelect(event)
        onMove(event)
      }}
    >
      {live && canMutate && runner !== null
        ? (
          <FrameStatusFan
            frameElementRef={frameElementRef}
            frameTitle={frame.title}
            restoreStatusTriggerFocusRef={restoreStatusTriggerFocusRef}
            runner={runner}
            setStatusMenuLayerActive={setStatusMenuLayerActive}
            setStatusMenuOpen={setStatusMenuOpen}
            statusFan={statusFan}
            statusMenuActionsRef={statusMenuActionsRef}
            statusMenuHandle={statusMenuHandle}
            statusMenuOpen={statusMenuOpen}
            statusMenuTriggerId={statusMenuTriggerId}
            statusMenuTriggerRef={statusMenuTriggerRef}
            statusPillLayout={statusPillLayout}
          />
        )
        : null}
      <div className="crit-frame__surface">
        <header
          className="crit-frame__chrome"
          data-toolbar-mode={toolbarMode}
          {...reviewInformationalHelpTarget({
            name: "Move frame",
            description: "Drag the frame header to reposition it on the canvas."
          })}
        >
          <FrameIdentity
            canMutate={canMutate}
            frameTitle={frame.title}
            live={live}
            runner={runner}
            selected={selected}
            shortId={shortId}
            status={status}
            statusMenuHandle={statusMenuHandle}
            statusMenuOpen={statusMenuOpen}
            statusMenuTriggerId={statusMenuTriggerId}
            statusMenuTriggerRef={statusMenuTriggerRef}
            titleVisible={titleVisible}
          />
          <FrameActionBar
            actions={actions}
            breakpointsOpen={breakpointsOpen}
            fullscreenPolicy={fullscreenPolicy}
            onRemove={requestRemove}
            openPolicy={openPolicy}
            removePolicy={removePolicy}
            runner={runner}
            setBreakpointsOpen={setBreakpointsOpen}
            snapshotCapturing={snapshotCapturing}
            snapshotPolicy={snapshotPolicy}
            url={url}
          />
          <ConfirmationDialog
            confirmLabel={removePolicy.label}
            description="This removes the selected Frames from the canvas."
            onCancel={() => setRemoveOpen(false)}
            onConfirm={() => {
              runner?.run("remove")
              setRemoveOpen(false)
            }}
            open={removeOpen}
            title="Remove Frame?"
          />
        </header>
        <div className="crit-frame__viewport">
          {children}
          {capture
            ? (
              <div
                aria-hidden
                data-crit-frame-capture=""
                style={{
                  inset: 0,
                  pointerEvents: "auto",
                  position: "absolute"
                }}
              />
            )
            : null}
        </div>
      </div>
      {selected
        ? (
          <ReviewSelectionChrome
            ink={status.ink}
            label={frame.title}
            onResize={onResize}
            shell={status.shell}
            uiScale={uiScale}
          />
        )
        : null}
    </div>
  )

  const frameTree = canMutate
    ? (
      <CritContextActions
        ariaLabel={`Actions for ${frame.title}`}
        items={menuItems}
        onOpenChange={(open) => {
          if (!open) return
        }}
      >
        {frameNode}
      </CritContextActions>
    )
    : frameNode

  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={domAnimation} strict>
        {frameTree}
      </LazyMotion>
    </MotionConfig>
  )
}

export { FRAME_CHROME_HEIGHT }
