import { Button } from "@base-ui/react/button"
import { Input } from "@base-ui/react/input"
import { Menu } from "@base-ui/react/menu"
import type { Frame } from "@crit/domain"
import { Predicate } from "effect"
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  usePresence,
  useTransform
} from "motion/react"
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode
} from "react"

import {
  CritContextActions,
  ReviewMenuItem
} from "./canvas-context-menu.js"
import { cssVariableStyle } from "./css-variable-style.js"
import { FRAME_SIZE_PRESETS } from "./frame-breakpoints.js"
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
import { useOptionalReviewRunner } from "./review-runner.js"
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

  useEffect(() => {
    const playback = animate(
      progress,
      isPresent ? 1 : 0,
      isPresent
        ? STATUS_PILL_MOTION.spring
        : STATUS_PILL_MOTION.close
    )
    if (!isPresent) playback.then(() => safeToRemove?.())
    return () => playback.stop()
  }, [isPresent, progress, safeToRemove])

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
        <motion.button
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
  const [titleDraft, setTitleDraft] = useState(frame.title)
  const [titleEditing, setTitleEditing] = useState(false)
  const [statusMenuOpen, setStatusMenuOpen] = useState(false)
  const [statusMenuLayerActive, setStatusMenuLayerActive] = useState(false)
  const [breakpointsOpen, setBreakpointsOpen] = useState(false)
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
  const actions = {
    snapshot: snapshotAvailable && screenWidth >= 148,
    breakpoints: canMutate && live && screenWidth >= 170,
    open: url !== undefined && screenWidth >= 82,
    fullscreen: canMutate && screenWidth >= 104,
    delete: canMutate && screenWidth >= 60
  }
  const actionCount = Object.values(actions).filter(Boolean).length
  const toolbarMode = frameToolbarMode(screenWidth, actionCount)
  const titleVisible = toolbarMode === "full"
  const statusActionId = (
    statusId: FrameStatusChrome["id"]
  ): ReviewActionId => {
    if (statusId === "in-progress") return "set-frame-status-in-progress"
    if (statusId === "ready-for-review") return "set-frame-status-ready-for-review"
    if (statusId === "changes-requested") return "set-frame-status-changes-requested"
    return "set-frame-status-approved"
  }

  useEffect(() => setTitleDraft(frame.title), [frame.title])
  useEffect(() => {
    if (!selected) setTitleEditing(false)
  }, [selected])

  const commitTitle = () => {
    const title = titleDraft.trim()
    if (title.length > 0 && title !== frame.title) {
      runner?.run("set-frame-title", ReviewActionInput.text({ text: title }))
    } else {
      setTitleDraft(frame.title)
    }
    setTitleEditing(false)
  }

  const menuItems = [
    ...(canMutate
      ? [ReviewMenuItem.action({
        policy: removePolicy,
        disabled: !runner.runnableIds.has("remove"),
        onSelect: () => runner.run("remove")
      })]
      : []),
    ...(canMutate
      ? [ReviewMenuItem.action({
        policy: fullscreenPolicy,
        disabled: !runner.runnableIds.has(fullscreenPolicy.id),
        onSelect: () => runner.run(fullscreenPolicy.id)
      })]
      : []),
    ...(url === undefined
      ? []
      : [ReviewMenuItem.link({
        policy: openPolicy,
        href: url
      })]),
    ...(canMutate
      ? [ReviewMenuItem.action({
        policy: reviewActionPolicy("bring-to-front"),
        disabled: !runner.runnableIds.has("bring-to-front"),
        onSelect: () => runner.run("bring-to-front")
      }),
      ReviewMenuItem.action({
        policy: reviewActionPolicy("send-to-back"),
        disabled: !runner.runnableIds.has("send-to-back"),
        onSelect: () => runner.run("send-to-back")
      })]
      : []),
    ...(canMutate && live
      ? [ReviewMenuItem.submenu({
        id: "resize-presets",
        label: "Resize to",
        description: "Resize this Frame to a standard viewport size.",
        items: FRAME_SIZE_PRESETS.map((preset) => {
          const id = `resize-frame-${preset.id}` as const
          return ReviewMenuItem.action({
            policy: reviewActionPolicy(id),
            disabled: !runner.runnableIds.has(id),
            onSelect: () => runner.run(id)
          })
        })
      })]
      : [])
  ]

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
      {live && canMutate
        ? (
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
                  aria-label={`Set status for ${frame.title}`}
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
                <span
                  className="crit-frame__title-mask"
                  data-editing={titleEditing && selected || undefined}
                  title={titleEditing && selected
                    ? undefined
                    : `${shortId}: ${frame.title}`}
                >
                  {titleEditing && selected && canMutate
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
                            onChange={(event) =>
                              setTitleDraft(event.currentTarget.value)}
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
                          <Glyph className="crit-frame__title-edit-icon" name="edit" />
                        </Button>
                      )
                      : (
                        <span className="crit-frame__title-label">
                          <span className="crit-frame__title-track">
                            <strong>{shortId}: {frame.title}</strong>
                            <strong>{status.label}</strong>
                          </span>
                        </span>
                      )}
                </span>
              )
              : null}
          </div>
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
                              {policy.label}
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
                <a
                  aria-label={openPolicy.label}
                  className="crit-frame__action"
                  href={url}
                  rel="noreferrer"
                  target="_blank"
                  {...reviewActionHelpTarget(openPolicy)}
                  onClick={(event) => {
                    event.preventDefault()
                    runner?.run("open-url")
                  }}
                >
                  <Glyph name="openExternal" />
                </a>
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
                  onClick={() => runner?.run("remove")}
                  type="button"
                >
                  <Glyph name="trash" />
                </Button>
              )
              : null}
          </div>
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

  if (!canMutate) return frameNode
  return (
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
}

export { FRAME_CHROME_HEIGHT }
