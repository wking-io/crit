import {
  Effect,
  Exit,
  Scope,
  Stream,
  SubscriptionRef,
  type Duration
} from "effect"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from "react"
import {
  Tldraw,
  type Editor,
  type TLComponents,
  type TLOnMountHandler,
  type TLStore,
  type TLUiOverrides
} from "tldraw"
import "tldraw/tldraw.css"

import { IndexedDbDraftJournal } from "../browser/indexeddb-draft-journal.js"
import { HttpCritClient } from "../http/client.js"
import {
  CanvasSession,
  type CanvasSession as CanvasSessionHandle,
  type CanvasSessionState
} from "../session/canvas-session.js"
import { CritClient, type CritClientShape } from "../session/crit-client.js"
import {
  DraftJournal,
  type DraftJournalShape
} from "../session/draft-journal.js"
import { CritFrameShapeUtil } from "./crit-frame.js"

const shapeUtils = [CritFrameShapeUtil]

const defaultComponents: TLComponents = {
  MainMenu: null,
  PageMenu: null
}

const critUiOverrides: TLUiOverrides = {
  tools(_editor, tools) {
    delete tools.asset
    delete tools.embed
    delete tools.frame
    return tools
  }
}

const disabledExternalContentTypes = [
  "files",
  "file-replace",
  "embed",
  "url"
] as const

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
    const created =
      typeof globalThis.crypto?.randomUUID === "function"
        ? globalThis.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    globalThis.sessionStorage?.setItem(key, created)
    return created
  } catch {
    return typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
}

const errorMessage = (cause: unknown) => {
  if (cause instanceof Error) return cause.message
  if (typeof cause === "object" && cause !== null && "detail" in cause) {
    return String(cause.detail)
  }
  return String(cause)
}

const combineOverrides = (
  overrides: TLUiOverrides | ReadonlyArray<TLUiOverrides> | undefined
) =>
  overrides === undefined
    ? critUiOverrides
    : Array.isArray(overrides)
      ? [critUiOverrides, ...overrides]
      : [critUiOverrides, overrides]

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
  readonly components?: TLComponents
  readonly hideUi?: boolean
  readonly licenseKey?: string
  readonly overrides?: TLUiOverrides | ReadonlyArray<TLUiOverrides>
  readonly onMount?: TLOnMountHandler
  readonly onSession?: (session: CanvasSessionHandle) => void
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
  components,
  hideUi,
  licenseKey,
  overrides,
  onMount,
  onSession,
  loadingFallback,
  errorFallback
}: CritProps) {
  const [session, setSession] = useState<CanvasSessionHandle | null>(null)
  const [sessionState, setSessionState] = useState<CanvasSessionState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const onSessionRef = useRef(onSession)
  onSessionRef.current = onSession
  const resolvedSessionId = useMemo(
    () => sessionId ?? sessionIdForCanvas(canvasId),
    [canvasId, sessionId]
  )
  const resolvedClient = useMemo(
    () =>
      client ??
      HttpCritClient.make(apiPath === undefined ? {} : { apiPath }),
    [apiPath, client]
  )
  const resolvedJournal = useMemo(
    () =>
      draftJournal === false
        ? undefined
        : (draftJournal ?? IndexedDbDraftJournal.make()),
    [draftJournal]
  )
  const resolvedComponents = useMemo(
    () => ({ ...defaultComponents, ...components }),
    [components]
  )
  const resolvedOverrides = useMemo(
    () => combineOverrides(overrides),
    [overrides]
  )

  useEffect(() => {
    const scope = Effect.runSync(Scope.make())
    let cancelled = false
    setSession(null)
    setSessionState(null)
    setError(null)

    const sessionOptions = {
      sessionId: resolvedSessionId,
      ...(autosaveDelay === undefined ? {} : { autosaveDelay }),
      ...(refreshInterval === undefined ? {} : { refreshInterval })
    }
    let openSession = CanvasSession.open(canvasId, sessionOptions).pipe(
      Effect.provideService(CritClient, resolvedClient),
      Effect.provideService(Scope.Scope, scope)
    )
    if (resolvedJournal !== undefined) {
      openSession = openSession.pipe(
        Effect.provideService(DraftJournal, resolvedJournal)
      )
    }

    void Effect.runPromise(openSession).then(
      (opened) => {
        if (cancelled) return
        setSession(opened)
        setSessionState(opened.state.value)
        onSessionRef.current?.(opened)
        Effect.runFork(
          Effect.forkIn(
            SubscriptionRef.changes(opened.state).pipe(
              Stream.runForEach((next) =>
                Effect.sync(() => {
                  if (!cancelled) setSessionState(next)
                })
              )
            ),
            scope
          )
        )
      },
      (cause) => {
        if (!cancelled) setError(errorMessage(cause))
      }
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

  const mountEditor = useCallback(
    (editor: Editor) => {
      for (const type of disabledExternalContentTypes) {
        editor.registerExternalContentHandler(type, null)
      }
      return onMount?.(editor)
    },
    [onMount]
  )

  if (error !== null) {
    return (
      <div className={className} role="alert" style={{ ...messageStyle, ...style }}>
        {errorFallback?.(error) ?? `Crit could not open this canvas: ${error}`}
      </div>
    )
  }

  if (session === null) {
    return (
      <div className={className} style={{ ...messageStyle, ...style }}>
        {loadingFallback ?? "Opening canvas…"}
      </div>
    )
  }

  return (
    <div className={className} style={{ ...rootStyle, ...style }}>
      <Tldraw
        components={resolvedComponents}
        onMount={mountEditor}
        overrides={resolvedOverrides}
        shapeUtils={shapeUtils}
        store={session.store as TLStore}
        {...(hideUi === undefined ? {} : { hideUi })}
        {...(licenseKey === undefined ? {} : { licenseKey })}
      />
      {sessionState === null ? null : (
        <div
          aria-live="polite"
          style={{
            background: "rgba(15, 23, 42, 0.84)",
            borderRadius: 999,
            bottom: 12,
            color: "#ffffff",
            font: "500 11px/1 ui-sans-serif, system-ui, sans-serif",
            padding: "7px 9px",
            pointerEvents: "none",
            position: "absolute",
            right: 12,
            textTransform: "capitalize",
            zIndex: 400
          }}
          title={sessionState.detail ?? sessionState.recoveryDetail ?? undefined}
        >
          {sessionState.saveStatus === "clean"
            ? "Saved"
            : sessionState.saveStatus.replace("-", " ")}
          {sessionState.recoveryStatus === "recovered" ? " · draft recovered" : ""}
        </div>
      )}
    </div>
  )
}
