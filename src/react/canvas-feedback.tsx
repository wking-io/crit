import { Avatar } from "@base-ui/react/avatar"
import { Button } from "@base-ui/react/button"
import { Popover } from "@base-ui/react/popover"
import { useState, type CSSProperties, type ReactNode } from "react"

import type {
  CanvasPresence,
  CanvasSessionState
} from "../session/canvas-session.js"
import { ConfirmationDialog } from "./confirmation-dialog.js"
import { cssVariableStyle } from "./css-variable-style.js"
import { useCritOverlayContainer } from "./overlay-container.js"

const boundaryStyle: CSSProperties = {
  alignItems: "center",
  background: "var(--crit-message-surface, oklch(98.5% 0 none))",
  color: "var(--crit-message-ink, #68655e)",
  display: "flex",
  font: '500 12px/1.7 "JetBrains Mono", ui-monospace, monospace',
  height: "100%",
  justifyContent: "center",
  minHeight: 420,
  padding: 24,
  textAlign: "center"
}

export function CritBoundaryMessage({
  children,
  className,
  error = false,
  style
}: {
  readonly children: ReactNode
  readonly className?: string | undefined
  readonly error?: boolean
  readonly style?: CSSProperties | undefined
}) {
  return (
    <div
      className={className}
      data-crit-boundary-error={error || undefined}
      role={error ? "alert" : undefined}
      style={{ ...boundaryStyle, ...style }}
    >
      {children}
    </div>
  )
}

const avatarColors = [
  "var(--crit-color-orange-p1, oklch(67% 0.18 55))",
  "var(--crit-color-blue-p2, oklch(65% 0.2 245.3))",
  "var(--crit-color-green-p2, oklch(65% 0.2 156.3))",
  "var(--crit-color-red-p1, oklch(67% 0.18 9))",
  "var(--crit-color-purple-p1, oklch(67% 0.18 302))"
] as const

const avatarColor = (index: number) =>
  avatarColors[index % avatarColors.length]!

const avatarLetter = (label: string) =>
  Array.from(label.trim())[0]?.toLocaleUpperCase() ?? "?"

type PresencePopoverPayload = {
  readonly secondary: string
  readonly title: string
}

function PresenceAvatar({
  anonymous = false,
  background,
  fallback,
  handle,
  index,
  label,
  payload,
  total
}: {
  readonly anonymous?: boolean
  readonly background?: string
  readonly fallback: string
  readonly handle: Popover.Handle<PresencePopoverPayload>
  readonly index: number
  readonly label: string
  readonly payload: PresencePopoverPayload
  readonly total: number
}) {
  const collapsedIndex = Math.min(index, 2)
  const collapsedSize = 22 - collapsedIndex * 2
  return (
    <div
      className="crit-presence__item"
      data-collapsed-hidden={index > 2 || undefined}
      style={cssVariableStyle({
        "--crit-presence-collapsed-scale": collapsedSize / 22,
        "--crit-presence-collapsed-x": `${1 + collapsedIndex * 5}px`,
        "--crit-presence-expanded-x": `${1 + index * 23}px`,
        "--crit-presence-glyph-scale": 22 / collapsedSize,
        "--crit-presence-layer": total - index
      })}
    >
      <Avatar.Root
        className="crit-presence__avatar"
        data-anonymous={anonymous || undefined}
        render={(
          <Popover.Trigger
            aria-label={label}
            closeDelay={100}
            delay={0}
            handle={handle}
            openOnHover
            payload={payload}
          />
        )}
        style={background === undefined ? undefined : { background }}
      >
        <Avatar.Fallback className="crit-presence__glyph">
          {fallback}
        </Avatar.Fallback>
      </Avatar.Root>
    </div>
  )
}

export function CanvasPresenceIndicator({
  presence
}: {
  readonly presence: CanvasPresence
}) {
  const [popoverHandle] = useState(
    () => Popover.createHandle<PresencePopoverPayload>()
  )
  const overlayContainer = useCritOverlayContainer()
  const participants = presence.availability === "unavailable"
    ? [{
        anonymous: true,
        background: undefined,
        fallback: "?",
        key: "anonymous-agent",
        label: "Anonymous agent presence",
        secondary: "Unknown harness",
        title: "Anonymous agent"
      }]
    : presence.activities.map((activity) => ({
        anonymous: false,
        background: undefined,
        fallback: avatarLetter(activity.activityId),
        key: activity.activityId,
        label: `${activity.harness} agent: ${activity.activityId}`,
        secondary: activity.harness,
        title: activity.activityId
      }))
  const authorEntry = presence.currentAuthor === null
    ? []
    : [{
        anonymous: false,
        background: undefined,
        fallback: avatarLetter(presence.currentAuthor.name),
        key: `current-author:${presence.currentAuthor.id}`,
        label: `Current author: ${presence.currentAuthor.name}`,
        secondary: presence.currentAuthor.id,
        title: presence.currentAuthor.name
      }]
  const entries = [...authorEntry, ...participants]
  if (entries.length === 0) return null
  const overflow = Math.max(0, entries.length - 3)
  const collapsedWidth = overflow > 0
    ? 52
    : entries.length === 1
      ? 24
      : 22 + Math.min(entries.length - 1, 2) * 5
  const expandedWidth = entries.length * 23 + 1
  return (
    <div
      aria-label={`Canvas presence: ${entries.length}`}
      aria-live="polite"
      className="crit-presence"
      data-overflow={overflow > 0 || undefined}
      role="status"
      style={cssVariableStyle({
        "--crit-presence-collapsed-width": `${collapsedWidth}px`,
        "--crit-presence-expanded-width": `${expandedWidth}px`
      })}
    >
      {entries.map((entry, index) => (
        <PresenceAvatar
          anonymous={entry.anonymous}
          {...(entry.anonymous ? {} : { background: avatarColor(index) })}
          fallback={entry.fallback}
          handle={popoverHandle}
          index={index}
          key={entry.key}
          label={entry.label}
          payload={{ secondary: entry.secondary, title: entry.title }}
          total={entries.length}
        />
      ))}
      {overflow === 0 ? null : (
        <span aria-hidden="true" className="crit-presence__overflow">
          +{overflow}
        </span>
      )}
      <Popover.Root handle={popoverHandle}>
        {({ payload }) => (
          <Popover.Portal container={overlayContainer}>
            <Popover.Positioner
              align="end"
              className="crit-presence__positioner"
              side="bottom"
              sideOffset={8}
            >
              <Popover.Popup
                className="crit-presence__card"
                initialFocus={false}
              >
                <Popover.Viewport className="crit-presence__viewport">
                  {payload === undefined ? null : (
                    <div className="crit-presence__content">
                      <Popover.Title
                        className="crit-presence__name"
                        render={<strong />}
                      >
                        {payload.title}
                      </Popover.Title>
                      <span className="crit-presence__secondary">
                        {payload.secondary}
                      </span>
                    </div>
                  )}
                </Popover.Viewport>
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        )}
      </Popover.Root>
    </div>
  )
}

export function GitIdentityBoundary({
  detail,
  prompt
}: {
  readonly detail: string
  readonly prompt: string
}) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">(
    "idle"
  )
  const copy = () => {
    const clipboard = globalThis.navigator?.clipboard
    if (clipboard === undefined) {
      setCopyStatus("failed")
      return
    }
    void clipboard.writeText(prompt).then(
      () => setCopyStatus("copied"),
      () => setCopyStatus("failed")
    )
  }

  return (
    <div className="crit-identity-error">
      <strong>Git identity required</strong>
      <p>{detail}</p>
      <Button onClick={copy} type="button">
        {copyStatus === "copied"
          ? "Prompt copied"
          : copyStatus === "failed"
            ? "Copy unavailable"
            : "Copy fix prompt"}
      </Button>
      <details>
        <summary>View fix prompt</summary>
        <pre>{prompt}</pre>
      </details>
    </div>
  )
}

export function CanvasSaveIndicator({
  recoveryStatus,
  saveStatus,
  onDiscardLocalChanges
}: {
  readonly recoveryStatus: CanvasSessionState["recoveryStatus"]
  readonly saveStatus: CanvasSessionState["saveStatus"]
  readonly onDiscardLocalChanges: () => void
}) {
  const [confirmationOpen, setConfirmationOpen] = useState(false)
  return (
    <>
      <Button
        aria-live="polite"
        className="crit-save-state"
        disabled={saveStatus !== "conflict"}
        onClick={() => saveStatus === "conflict" && setConfirmationOpen(true)}
        type="button"
      >
        {saveStatus === "clean" ? "Saved" : saveStatus.replace("-", " ")}
        {recoveryStatus === "recovered" ? " · draft recovered" : ""}
        {saveStatus === "conflict" ? " · discard local changes" : ""}
      </Button>
      <ConfirmationDialog
        confirmLabel="Discard changes"
        description="The recovered local draft will be replaced by the latest saved canvas. This cannot be undone."
        onCancel={() => setConfirmationOpen(false)}
        onConfirm={() => {
          setConfirmationOpen(false)
          onDiscardLocalChanges()
        }}
        open={confirmationOpen}
        title="Discard local changes?"
      />
    </>
  )
}
