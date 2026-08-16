import { Avatar } from "@base-ui/react/avatar"
import { Button } from "@base-ui/react/button"
import { Popover } from "@base-ui/react/popover"
import { useState, type CSSProperties, type ReactNode } from "react"

import type {
  CanvasPresence,
  CanvasSessionState
} from "../session/canvas-session.js"
import { ConfirmationDialog } from "./confirmation-dialog.js"
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
  "#635bff",
  "#087f5b",
  "#b45309",
  "#be123c",
  "#0369a1",
  "#7e22ce"
] as const

const avatarColor = (identity: string) => {
  let hash = 0
  for (const character of identity) {
    hash = (hash * 31 + character.codePointAt(0)!) >>> 0
  }
  return avatarColors[hash % avatarColors.length]!
}

const avatarLetter = (label: string) =>
  Array.from(label.trim())[0]?.toLocaleUpperCase() ?? "?"

function PresencePopover({
  anonymous = false,
  background,
  children,
  fallback,
  label,
  title
}: {
  readonly anonymous?: boolean
  readonly background?: string
  readonly children?: ReactNode
  readonly fallback: string
  readonly label: string
  readonly title: string
}) {
  const overlayContainer = useCritOverlayContainer()
  return (
    <div className="crit-presence__item">
      <Popover.Root>
        <Avatar.Root
          className="crit-presence__avatar"
          data-anonymous={anonymous || undefined}
          render={(
            <Popover.Trigger
              aria-label={label}
              closeDelay={80}
              delay={0}
              openOnHover
            />
          )}
          style={background === undefined ? undefined : { background }}
        >
          <Avatar.Fallback>{fallback}</Avatar.Fallback>
        </Avatar.Root>
        <Popover.Portal container={overlayContainer}>
          <Popover.Positioner
            align="end"
            className="crit-presence__positioner"
            side="bottom"
            sideOffset={8}
          >
            <Popover.Popup className="crit-presence__card">
              <Popover.Title render={<strong />}>{title}</Popover.Title>
              {children}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  )
}

export function CanvasPresenceIndicator({
  presence
}: {
  readonly presence: CanvasPresence
}) {
  return (
    <div
      aria-label="Canvas presence"
      aria-live="polite"
      className="crit-presence"
      role="status"
    >
      <PresencePopover
        background={avatarColor(presence.currentAuthor.id)}
        fallback={avatarLetter(presence.currentAuthor.name)}
        label={`Current author: ${presence.currentAuthor.name}`}
        title={presence.currentAuthor.name}
      >
        <span>Current author</span>
        <code>{presence.currentAuthor.id}</code>
      </PresencePopover>
      {presence.availability === "unavailable" ? (
        <PresencePopover
          anonymous
          fallback="?"
          label="Anonymous agent presence"
          title="Anonymous agent"
        >
          <span>Unknown harness</span>
        </PresencePopover>
      ) : presence.activities.map((activity) => (
        <PresencePopover
          background={avatarColor(activity.activityId)}
          fallback={avatarLetter(activity.harness)}
          key={activity.activityId}
          label={`${activity.harness} agent: ${activity.activityId}`}
          title={activity.harness}
        >
          {activity.model === null ? null : <span>{activity.model}</span>}
          {activity.detail === null ? null : <p>{activity.detail}</p>}
          <code>{activity.activityId}</code>
          {activity.reference === null ? null : (
            <>
              <span>{activity.reference.kind}</span>
              {activity.reference.uri === null ? (
                <code>{activity.reference.id}</code>
              ) : (
                <a
                  href={activity.reference.uri}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {activity.reference.id}
                </a>
              )}
            </>
          )}
        </PresencePopover>
      ))}
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
