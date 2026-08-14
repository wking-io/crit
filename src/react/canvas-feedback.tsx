import { useState, type CSSProperties, type ReactNode } from "react"

import type {
  CanvasPresence,
  CanvasSessionState
} from "../session/canvas-session.js"

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
      <div className="crit-presence__item">
        <span
          aria-label={`Current author: ${presence.currentAuthor.name}`}
          className="crit-presence__avatar"
          style={{ background: avatarColor(presence.currentAuthor.id) }}
          tabIndex={0}
        >
          {avatarLetter(presence.currentAuthor.name)}
        </span>
        <div className="crit-presence__card" role="tooltip">
          <strong>{presence.currentAuthor.name}</strong>
          <span>Current author</span>
          <code>{presence.currentAuthor.id}</code>
        </div>
      </div>
      {presence.availability === "unavailable" ? (
        <div className="crit-presence__item">
          <span
            aria-label="Anonymous agent presence"
            className="crit-presence__avatar"
            data-anonymous
            tabIndex={0}
          >
            ?
          </span>
          <div className="crit-presence__card" role="tooltip">
            <strong>Anonymous agent</strong>
            <span>Unknown harness</span>
          </div>
        </div>
      ) : presence.activities.map((activity) => (
        <div className="crit-presence__item" key={activity.activityId}>
          <span
            aria-label={`${activity.harness} agent: ${activity.activityId}`}
            className="crit-presence__avatar"
            style={{ background: avatarColor(activity.activityId) }}
            tabIndex={0}
          >
            {avatarLetter(activity.harness)}
          </span>
          <div className="crit-presence__card" role="tooltip">
            <strong>{activity.harness}</strong>
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
          </div>
        </div>
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
      <button onClick={copy} type="button">
        {copyStatus === "copied"
          ? "Prompt copied"
          : copyStatus === "failed"
            ? "Copy unavailable"
            : "Copy fix prompt"}
      </button>
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
  return (
    <button
      aria-live="polite"
      className="crit-save-state"
      disabled={saveStatus !== "conflict"}
      onClick={() => saveStatus === "conflict" && onDiscardLocalChanges()}
      type="button"
    >
      {saveStatus === "clean" ? "Saved" : saveStatus.replace("-", " ")}
      {recoveryStatus === "recovered" ? " · draft recovered" : ""}
      {saveStatus === "conflict" ? " · discard local changes" : ""}
    </button>
  )
}
