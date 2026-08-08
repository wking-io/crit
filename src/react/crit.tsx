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
import { CanvasViewport } from "./canvas-viewport.js"

const rootStyle: CSSProperties = {
  height: "100%",
  minHeight: 420,
  position: "relative",
  width: "100%"
}

const messageStyle: CSSProperties = {
  alignItems: "center",
  background: "#f8fafc",
  color: "#475569",
  display: "flex",
  font: "500 13px/1.5 ui-sans-serif, system-ui, sans-serif",
  height: "100%",
  justifyContent: "center",
  minHeight: 420,
  padding: 24,
  textAlign: "center"
}

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
    return () => hot.off("crit:canvas-changed", refreshChangedCanvas)
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
    <div className={className} style={{ ...rootStyle, ...style }}>
      <CanvasViewport
        dispatch={session.dispatch}
        document={document}
        snapshotFrame={session.snapshotFrame}
        {...(iframeAllow === undefined ? {} : { iframeAllow })}
        {...(iframeSandbox === undefined ? {} : { iframeSandbox })}
        {...(onCommandError === undefined ? {} : { onCommandError })}
      />
      {sessionState === null ? null : (
        <button
          aria-live="polite"
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
          style={{
            background: "rgba(15, 23, 42, 0.84)",
            borderRadius: 999,
            bottom: 12,
            color: "#ffffff",
            font: "500 11px/1 ui-sans-serif, system-ui, sans-serif",
            padding: "7px 9px",
            border: 0,
            cursor:
              sessionState.saveStatus === "conflict" ? "pointer" : "default",
            position: "absolute",
            right: 12,
            textTransform: "capitalize",
            zIndex: 400
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
