import {
  Effect,
  Exit,
  Scope,
  Stream,
  SubscriptionRef,
  type Duration
} from "effect"
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from "react"

import { IndexedDbDraftJournal } from "../browser/indexeddb-draft-journal.js"
import type { CanvasDocument } from "../core/index.js"
import { HttpCritClient } from "../http/client.js"
import {
  CanvasSession,
  type CanvasSession as CanvasSessionHandle,
  type CanvasSessionState
} from "../session/canvas-session.js"
import { CritClient, type CritClientShape } from "../session/crit-client.js"
import { DraftJournal, type DraftJournalShape } from "../session/draft-journal.js"
import {
  CanvasViewport,
  type FrameChromeSettings
} from "./canvas-viewport.js"
import type { CanvasCameraOptions } from "./canvas-camera.js"

const rootStyle: CSSProperties = {
  background: "oklch(98.5% 0 none)",
  color: "#191918",
  fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  height: "100%",
  minHeight: 420,
  overflow: "hidden",
  overscrollBehavior: "none",
  overscrollBehaviorX: "none",
  position: "relative",
  width: "100%"
}

const messageStyle: CSSProperties = {
  alignItems: "center",
  background: "oklch(98.5% 0 none)",
  color: "#68655e",
  display: "flex",
  font: '500 12px/1.7 "JetBrains Mono", ui-monospace, monospace',
  height: "100%",
  justifyContent: "center",
  minHeight: 420,
  padding: 24,
  textAlign: "center"
}

const classes = (...values: ReadonlyArray<string | undefined>) =>
  values.filter((value): value is string => value !== undefined).join(" ")

const sessionIdForCanvas = (canvasId: string) => {
  const key = `@riff-refine/crit/session/${canvasId}`
  try {
    const existing = globalThis.sessionStorage?.getItem(key)
    if (existing) return existing
    const created = crypto.randomUUID()
    globalThis.sessionStorage?.setItem(key, created)
    return created
  } catch {
    return crypto.randomUUID()
  }
}

const errorMessage = (cause: unknown) => {
  if (cause instanceof Error) return cause.message
  if (typeof cause === "object" && cause !== null && "detail" in cause) {
    return String(cause.detail)
  }
  return String(cause)
}

export interface CritProps {
  readonly canvasId: string
  readonly client?: CritClientShape
  readonly apiPath?: string
  readonly autosaveDelay?: Duration.Input
  readonly refreshInterval?: Duration.Input | false
  readonly sessionId?: string
  readonly draftJournal?: DraftJournalShape | false
  readonly className?: string
  readonly style?: CSSProperties
  readonly iframeAllow?: string
  readonly iframeSandbox?: string
  readonly frameChrome?: Partial<FrameChromeSettings>
  readonly cameraOptions?: Partial<CanvasCameraOptions>
  readonly onSession?: (session: CanvasSessionHandle) => void
  readonly onCommandError?: (message: string) => void
  readonly loadingFallback?: ReactNode
  readonly errorFallback?: (message: string) => ReactNode
}

export function Crit({
  canvasId,
  client,
  apiPath,
  autosaveDelay,
  refreshInterval,
  sessionId,
  draftJournal,
  className,
  style,
  iframeAllow,
  iframeSandbox,
  frameChrome,
  cameraOptions,
  onSession,
  onCommandError,
  loadingFallback,
  errorFallback
}: CritProps) {
  const [session, setSession] = useState<CanvasSessionHandle | null>(null)
  const [sessionState, setSessionState] = useState<CanvasSessionState | null>(null)
  const [document, setDocument] = useState<CanvasDocument | null>(null)
  const [error, setError] = useState<string | null>(null)
  const onSessionRef = useRef(onSession)
  onSessionRef.current = onSession
  const resolvedSessionId = useMemo(
    () => sessionId ?? sessionIdForCanvas(canvasId),
    [canvasId, sessionId]
  )
  const resolvedClient = useMemo(
    () => client ?? HttpCritClient.make(apiPath === undefined ? {} : { apiPath }),
    [apiPath, client]
  )
  const resolvedJournal = useMemo(
    () => draftJournal === false ? undefined : (draftJournal ?? IndexedDbDraftJournal.make()),
    [draftJournal]
  )

  useEffect(() => {
    const scope = Effect.runSync(Scope.make())
    let cancelled = false
    setSession(null)
    setSessionState(null)
    setDocument(null)
    setError(null)

    const sessionOptions = {
      sessionId: resolvedSessionId,
      ...(autosaveDelay === undefined ? {} : { autosaveDelay }),
      ...(refreshInterval === undefined ? {} : { refreshInterval })
    }
    let opening = CanvasSession.open(canvasId, sessionOptions).pipe(
      Effect.provideService(CritClient, resolvedClient),
      Effect.provideService(Scope.Scope, scope)
    )
    if (resolvedJournal !== undefined) {
      opening = opening.pipe(Effect.provideService(DraftJournal, resolvedJournal))
    }

    void Effect.runPromise(opening).then(
      (opened) => {
        if (cancelled) return
        setSession(opened)
        setSessionState(opened.state.value)
        setDocument(opened.document.value)
        onSessionRef.current?.(opened)
        Effect.runFork(
          Effect.forkIn(
            Effect.all([
              SubscriptionRef.changes(opened.state).pipe(
                Stream.runForEach((next) =>
                  Effect.sync(() => !cancelled && setSessionState(next))
                )
              ),
              SubscriptionRef.changes(opened.document).pipe(
                Stream.runForEach((next) =>
                  Effect.sync(() => !cancelled && setDocument(next))
                )
              )
            ], { concurrency: "unbounded" }),
            scope
          )
        )
      },
      (cause) => !cancelled && setError(errorMessage(cause))
    )

    return () => {
      cancelled = true
      Effect.runFork(Scope.close(scope, Exit.void))
    }
  }, [
    autosaveDelay,
    canvasId,
    refreshInterval,
    resolvedClient,
    resolvedJournal,
    resolvedSessionId
  ])

  useEffect(() => {
    if (session === null) return
    const hot = (import.meta as ImportMeta & {
      readonly hot?: {
        readonly on: (
          event: string,
          listener: (data: { readonly id?: string }) => void
        ) => void
        readonly off: (
          event: string,
          listener: (data: { readonly id?: string }) => void
        ) => void
      }
    }).hot
    if (hot === undefined) return
    const refreshChangedCanvas = (data: { readonly id?: string }) => {
      if (data.id === canvasId) {
        Effect.runFork(session.refresh().pipe(Effect.catch(() => Effect.void)))
      }
    }
    hot.on("crit:canvas-changed", refreshChangedCanvas)
    const refreshActivity = (data: { readonly id?: string }) => {
      if (data.id === canvasId) {
        Effect.runFork(
          session.refreshAgentActivity().pipe(Effect.catch(() => Effect.void))
        )
      }
    }
    hot.on("crit:agent-activity", refreshActivity)
    return () => {
      hot.off("crit:canvas-changed", refreshChangedCanvas)
      hot.off("crit:agent-activity", refreshActivity)
    }
  }, [canvasId, session])

  if (error !== null) {
    return (
      <div className={className} role="alert" style={{ ...messageStyle, ...style }}>
        {errorFallback?.(error) ?? `Crit could not open this canvas: ${error}`}
      </div>
    )
  }

  if (session === null || document === null) {
    return (
      <div className={className} style={{ ...messageStyle, ...style }}>
        {loadingFallback ?? "Opening canvas…"}
      </div>
    )
  }

  return (
    <div className={classes("crit-root", className)} style={{ ...rootStyle, ...style }}>
      <CanvasViewport
        dispatch={session.dispatch}
        document={document}
        snapshotFrame={session.snapshotFrame}
        {...(frameChrome === undefined ? {} : { frameChrome })}
        {...(cameraOptions === undefined ? {} : { cameraOptions })}
        {...(iframeAllow === undefined ? {} : { iframeAllow })}
        {...(iframeSandbox === undefined ? {} : { iframeSandbox })}
        {...(onCommandError === undefined ? {} : { onCommandError })}
      />
      {sessionState?.agentActivity.active ? (
        <div
          aria-live="polite"
          className="crit-presence"
          role="status"
          title={sessionState.agentActivity.activeUntil ?? undefined}
        >
          <span className="crit-presence__dot" />
          Agent working
          {sessionState.agentActivity.detail === null
            ? ""
            : ` · ${sessionState.agentActivity.detail}`}
        </div>
      ) : null}
      {sessionState === null ? null : (
        <button
          aria-live="polite"
          className="crit-save-state"
          disabled={sessionState.saveStatus !== "conflict"}
          onClick={() => {
            if (sessionState.saveStatus === "conflict") {
              Effect.runFork(
                session.discardLocalChanges().pipe(
                  Effect.catch((cause) =>
                    Effect.sync(() => setError(errorMessage(cause)))
                  )
                )
              )
            }
          }}
          title={sessionState.detail ?? sessionState.recoveryDetail ?? undefined}
          type="button"
        >
          {sessionState.saveStatus === "clean"
            ? "Saved"
            : sessionState.saveStatus.replace("-", " ")}
          {sessionState.recoveryStatus === "recovered" ? " · draft recovered" : ""}
          {sessionState.saveStatus === "conflict" ? " · discard local changes" : ""}
        </button>
      )}
    </div>
  )
}
