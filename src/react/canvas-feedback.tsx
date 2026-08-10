import type { CSSProperties, ReactNode } from "react"

import type { CanvasSessionState } from "../session/canvas-session.js"

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
  readonly className?: string
  readonly error?: boolean
  readonly style?: CSSProperties
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

export function AgentActivityIndicator({
  detail
}: {
  readonly detail: string | null
}) {
  return (
    <div aria-live="polite" className="crit-presence" role="status">
      <span className="crit-presence__dot" />
      Agent working{detail === null ? "" : ` · ${detail}`}
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
