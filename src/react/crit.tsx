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
import type { CanvasDocument, CommentAuthor } from "../core/index.js"
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
import type { FrameLoadMode } from "./frame-card.js"
import {
  CanvasHelpPanel,
  CanvasHelpSurface
} from "./canvas-help.js"
import { GlyphProvider } from "./glyph.js"
import {
  AgentActivityIndicator,
  CanvasSaveIndicator,
  CritBoundaryMessage
} from "./canvas-feedback.js"

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
  readonly frameLoadMode?: FrameLoadMode
  readonly frameLoadOrigin?: string
  readonly frameChrome?: Partial<FrameChromeSettings>
  readonly cameraOptions?: Partial<CanvasCameraOptions>
  readonly author?: CommentAuthor
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
  frameLoadMode = "navigate",
  frameLoadOrigin,
  frameChrome,
  cameraOptions,
  author,
  onSession,
  onCommandError,
  loadingFallback,
  errorFallback
}: CritProps) {
  const [session, setSession] = useState<CanvasSessionHandle | null>(null)
  const [sessionState, setSessionState] = useState<CanvasSessionState | null>(null)
  const [document, setDocument] = useState<CanvasDocument | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resolvedAuthor, setResolvedAuthor] = useState<CommentAuthor | null>(
    author ?? null
  )
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
    if (author !== undefined) {
      setResolvedAuthor(author)
      return
    }
    const controller = new AbortController()
    const base = (apiPath ?? "/__crit/api").replace(/\/+$/, "")
    void fetch(`${base}/identity`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Git comment identity is unavailable")
        const value = await response.json() as Partial<CommentAuthor>
        if (typeof value.id !== "string" || typeof value.name !== "string") {
          throw new Error("Git comment identity is invalid")
        }
        setResolvedAuthor({ id: value.id, name: value.name })
      })
      .catch((cause: unknown) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError")) {
          onCommandError?.(errorMessage(cause))
        }
      })
    return () => controller.abort()
  }, [apiPath, author, onCommandError])

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
      <CritBoundaryMessage
        error
        {...(className === undefined ? {} : { className })}
        {...(style === undefined ? {} : { style })}
      >
        {errorFallback?.(error) ?? `Crit could not open this canvas: ${error}`}
      </CritBoundaryMessage>
    )
  }

  if (session === null || document === null) {
    return (
      <CritBoundaryMessage
        {...(className === undefined ? {} : { className })}
        {...(style === undefined ? {} : { style })}
      >
        {loadingFallback ?? "Opening canvas…"}
      </CritBoundaryMessage>
    )
  }

  return (
    <GlyphProvider>
      <CanvasHelpSurface
        className={classes("crit-root", className)}
        style={{ ...rootStyle, ...style }}
      >
      <CanvasViewport
        author={resolvedAuthor}
        dispatch={session.dispatch}
        document={document}
        snapshotFrame={session.snapshotFrame}
        {...(frameChrome === undefined ? {} : { frameChrome })}
        {...(cameraOptions === undefined ? {} : { cameraOptions })}
        {...(iframeAllow === undefined ? {} : { iframeAllow })}
        {...(iframeSandbox === undefined ? {} : { iframeSandbox })}
        frameLoadMode={frameLoadMode}
        {...(frameLoadOrigin === undefined ? {} : { frameLoadOrigin })}
        {...(onCommandError === undefined ? {} : { onCommandError })}
      />
      <CanvasHelpPanel />
      {sessionState?.agentActivity.active ? (
        <AgentActivityIndicator detail={sessionState.agentActivity.detail} />
      ) : null}
      {sessionState === null ? null : (
        <CanvasSaveIndicator
          onDiscardLocalChanges={() => {
            Effect.runFork(
              session.discardLocalChanges().pipe(
                Effect.catch((cause) =>
                  Effect.sync(() => setError(errorMessage(cause)))
                )
              )
            )
          }}
          recoveryStatus={sessionState.recoveryStatus}
          saveStatus={sessionState.saveStatus}
        />
      )}
      </CanvasHelpSurface>
    </GlyphProvider>
  )
}
