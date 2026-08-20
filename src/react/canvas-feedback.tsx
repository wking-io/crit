import { Button } from "@base-ui/react/button"
import { Input } from "@base-ui/react/input"
import { Popover } from "@base-ui/react/popover"
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from "react"

import type {
  CanvasPresence,
  CanvasSessionState
} from "../session/canvas-session.js"
import { ConfirmationDialog } from "./confirmation-dialog.js"
import { cssVariableStyle } from "./css-variable-style.js"
import {
  browserAuthorProfileStorage,
  currentAuthorNameLabel,
  currentAuthorProfile,
  readPersistedAuthorDisplayName,
  writePersistedAuthorDisplayName,
  type AuthorProfileStorage
} from "./current-author-profile.js"
import { Glyph } from "./glyph.js"
import { useCritOverlayContainer } from "./overlay-container.js"
import {
  toolbarOverlayAnchorFor,
  toolbarOverlayPositionerProps
} from "./canvas-toolbar-overlay.js"
import { WovenAvatarPattern, wovenAvatarFor } from "./woven-avatar.js"

const boundaryStyle: CSSProperties = {
  alignItems: "center",
  background: "var(--crit-message-surface, oklch(98.5% 0 none))",
  color: "var(--crit-message-ink, #68655e)",
  display: "flex",
  font: "500 12px/1.7 InterVariable, Inter, sans-serif",
  fontFeatureSettings: '"calt" 1, "case" 1, "ss02" 1, "tnum" 1, "ss03" 1',
  fontOpticalSizing: "none",
  fontVariationSettings: '"opsz" 14',
  letterSpacing: 0,
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

type AgentPresencePayload = {
  readonly kind: "agent"
  readonly secondary: string
  readonly title: string
}

type AuthorPresencePayload = {
  readonly kind: "author"
  readonly authorId: string
  readonly displayName: string
  readonly email: string | null
  readonly handle: string | null
}

type PresencePopoverPayload = AgentPresencePayload | AuthorPresencePayload

export function CurrentAuthorProfileCard({
  displayName,
  editing,
  email,
  handle,
  nameDraft,
  onCancelEdit,
  onEdit,
  onNameDraftChange,
  onSaveName
}: {
  readonly displayName: string
  readonly editing: boolean
  readonly email: string | null
  readonly handle: string | null
  readonly nameDraft: string
  readonly onCancelEdit: () => void
  readonly onEdit: () => void
  readonly onNameDraftChange: (value: string) => void
  readonly onSaveName: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const ignoreBlurRef = useRef(false)
  const missing = displayName.length === 0
  useEffect(() => {
    if (!editing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing])
  const cancel = () => {
    ignoreBlurRef.current = true
    onCancelEdit()
  }
  const save = () => {
    ignoreBlurRef.current = true
    onSaveName()
  }
  return (
    <div
      className="crit-presence__author"
      data-editing={editing || undefined}
    >
      <div
        className="crit-presence__header"
        onBlur={(event) => {
          if (!editing) return
          const nextFocus = event.relatedTarget
          if (
            nextFocus instanceof Node &&
            event.currentTarget.contains(nextFocus)
          ) return
          if (ignoreBlurRef.current) {
            ignoreBlurRef.current = false
            return
          }
          onSaveName()
        }}
      >
        {editing ? (
          <Input
            aria-label="Display name"
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            className="crit-presence__name-input"
            data-1p-ignore=""
            data-lpignore="true"
            onChange={(event) => onNameDraftChange(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                save()
              }
              if (event.key !== "Escape") return
              event.preventDefault()
              event.stopPropagation()
              cancel()
            }}
            ref={inputRef}
            spellCheck={false}
            value={nameDraft}
          />
        ) : (
          <strong
            className="crit-presence__name"
            data-missing={missing || undefined}
          >
            {currentAuthorNameLabel(displayName)}
          </strong>
        )}
        {editing ? (
          <Button
            aria-label="Save name"
            className="crit-icon-button crit-presence__edit"
            onClick={save}
            type="button"
          >
            <Glyph name="save" />
          </Button>
        ) : (
          <Button
            aria-label="Edit name"
            className="crit-icon-button crit-presence__edit"
            onClick={onEdit}
            type="button"
          >
            <Glyph name="edit" />
          </Button>
        )}
      </div>
      {email === null ? null : (
        <span className="crit-presence__secondary">{email}</span>
      )}
      {handle === null ? null : (
        <span className="crit-presence__handle">{handle}</span>
      )}
    </div>
  )
}

function PresenceAvatar({
  anonymous = false,
  handle,
  index,
  label,
  payload,
  seed,
  total
}: {
  readonly anonymous?: boolean
  readonly handle: Popover.Handle<PresencePopoverPayload>
  readonly index: number
  readonly label: string
  readonly payload: PresencePopoverPayload
  readonly seed: string
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
        "--crit-presence-layer": total - index
      })}
    >
      <Popover.Trigger
        aria-label={label}
        className="crit-presence__avatar"
        closeDelay={100}
        data-anonymous={anonymous || undefined}
        delay={0}
        handle={handle}
        openOnHover
        payload={payload}
      >
        <WovenAvatarPattern spec={wovenAvatarFor(seed)} />
      </Popover.Trigger>
    </div>
  )
}

export function CanvasPresenceIndicator({
  presence,
  profileStorage = browserAuthorProfileStorage()
}: {
  readonly presence: CanvasPresence
  readonly profileStorage?: AuthorProfileStorage | null
}) {
  const [popoverHandle] = useState(
    () => Popover.createHandle<PresencePopoverPayload>()
  )
  const overlayContainer = useCritOverlayContainer()
  const presenceRef = useRef<HTMLDivElement>(null)
  const currentAuthor = presence.currentAuthor
  const [storedDisplayName, setStoredDisplayName] = useState<string | null>(
    () => currentAuthor === null || profileStorage === null
      ? null
      : readPersistedAuthorDisplayName(profileStorage, currentAuthor.id)
  )
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState("")
  const overlayAnchor = () => toolbarOverlayAnchorFor(
    presenceRef.current?.querySelector("[data-popup-open]") ?? presenceRef.current
  )
  const participants = presence.availability === "unavailable"
    ? [{
        anonymous: true,
        key: "anonymous-agent",
        label: "Anonymous agent presence",
        payload: {
          kind: "agent" as const,
          secondary: "Unknown harness",
          title: "Anonymous agent"
        }
      }]
    : presence.activities.map((activity) => ({
        anonymous: false,
        key: activity.activityId,
        label: `${activity.harness} agent: ${activity.activityId}`,
        payload: {
          kind: "agent" as const,
          secondary: activity.harness,
          title: activity.activityId
        }
      }))
  const authorProfile = currentAuthor === null
    ? null
    : currentAuthorProfile(currentAuthor, storedDisplayName)
  const authorEntry = currentAuthor === null || authorProfile === null
    ? []
    : [{
        anonymous: false,
        key: `current-author:${currentAuthor.id}`,
        label: `Current author: ${currentAuthorNameLabel(authorProfile.displayName)}`,
        payload: {
          kind: "author" as const,
          authorId: currentAuthor.id,
          displayName: authorProfile.displayName,
          email: authorProfile.email,
          handle: authorProfile.handle
        }
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
  const beginNameEdit = (displayName: string) => {
    setNameDraft(displayName)
    setEditingName(true)
  }
  const cancelNameEdit = () => {
    setEditingName(false)
    setNameDraft("")
  }
  const saveName = (authorId: string) => {
    const nextName = nameDraft.trim()
    if (profileStorage !== null) {
      writePersistedAuthorDisplayName(profileStorage, authorId, nextName)
    }
    setStoredDisplayName(nextName)
    setEditingName(false)
  }
  return (
    <div
      aria-label={`Canvas presence: ${entries.length}`}
      aria-live="polite"
      className="crit-presence"
      data-overflow={overflow > 0 || undefined}
      ref={presenceRef}
      role="status"
      style={cssVariableStyle({
        "--crit-presence-collapsed-width": `${collapsedWidth}px`,
        "--crit-presence-expanded-width": `${expandedWidth}px`
      })}
    >
      {entries.map((entry, index) => (
        <PresenceAvatar
          anonymous={entry.anonymous}
          handle={popoverHandle}
          index={index}
          key={entry.key}
          label={entry.label}
          payload={entry.payload}
          seed={entry.key}
          total={entries.length}
        />
      ))}
      {overflow === 0 ? null : (
        <span aria-hidden="true" className="crit-presence__overflow">
          +{overflow}
        </span>
      )}
      <Popover.Root
        handle={popoverHandle}
        onOpenChange={(open) => {
          if (!open) cancelNameEdit()
        }}
      >
        {({ payload }) => (
          <Popover.Portal container={overlayContainer}>
            <Popover.Positioner
              {...toolbarOverlayPositionerProps}
              anchor={overlayAnchor}
              className="crit-toolbar-overlay-positioner crit-presence__positioner"
            >
              <Popover.Popup
                aria-label={payload === undefined
                  ? undefined
                  : payload.kind === "author"
                    ? currentAuthorNameLabel(authorProfile?.displayName ?? payload.displayName)
                    : payload.title}
                className="crit-presence__card"
                initialFocus={false}
              >
                <Popover.Viewport className="crit-presence__viewport">
                  {payload === undefined
                    ? null
                    : payload.kind === "author" && authorProfile !== null
                      ? (
                    <CurrentAuthorProfileCard
                      displayName={authorProfile.displayName}
                      editing={editingName}
                      email={authorProfile.email}
                      handle={authorProfile.handle}
                      nameDraft={nameDraft}
                      onCancelEdit={cancelNameEdit}
                      onEdit={() => beginNameEdit(authorProfile.displayName)}
                      onNameDraftChange={setNameDraft}
                      onSaveName={() => saveName(payload.authorId)}
                    />
                  ) : payload.kind === "agent" ? (
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
                  ) : null}
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
  if (
    saveStatus !== "conflict" &&
    saveStatus !== "save-error" &&
    recoveryStatus !== "recovered"
  ) {
    return null
  }
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
