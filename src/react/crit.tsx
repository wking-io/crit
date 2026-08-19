import {
  Cause,
  Effect,
  Exit,
  Option,
  Predicate,
  Schema,
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
import type { Author, CanvasDocument } from "../core/index.js"
import {
  DEFAULT_CRIT_FEATURES,
  type CritFeatures
} from "../core/features.js"
import { HttpCritClient } from "../http/client.js"
import { GIT_AUTHOR_REMEDIATION_PROMPT } from "../runtime/author-identity.js"
import {
  critClientErrorMessage,
  isCurrentAuthorError,
  type CritClientError
} from "../runtime/canvas-failure.js"
import {
  defaultRuntimeCapabilities,
  runtimeId,
  type RuntimeCapabilities
} from "../runtime/runtime-capabilities.js"
import {
  CanvasSession,
  DEFAULT_CANVAS_SESSION_AUTOSAVE_DELAY,
  DEFAULT_CANVAS_SESSION_PRESENCE_INTERVAL,
  DEFAULT_CANVAS_SESSION_REFRESH_INTERVAL,
  type CanvasSession as CanvasSessionHandle,
  type CanvasSessionState
} from "../session/canvas-session.js"
import {
  CritActivityClient,
  CritClient,
  CritSnapshotClient,
  type CritClientServices
} from "../session/crit-client.js"
import { DraftJournal } from "../session/draft-journal.js"
import {
  CanvasViewport,
  type CanvasViewportProps,
  type FrameChromeSettings
} from "./canvas-viewport.js"
import type { CanvasCameraOptions } from "./canvas-camera.js"
import type { CanvasChoice } from "./canvas-toolbar.js"
import type { FrameLoadingPolicy } from "./frame-loading.js"
import {
  CanvasHelpPanel,
  CanvasHelpSurface
} from "./canvas-help.js"
import { GlyphProvider } from "./glyph.js"
import {
  CanvasSaveIndicator,
  CritBoundaryMessage,
  GitIdentityBoundary
} from "./canvas-feedback.js"
import { CritOverlayProvider } from "./overlay-container.js"

type CritHotModule = {
  readonly on: (
    event: string,
    listener: (data: { readonly id?: string }) => void
  ) => void
  readonly off: (
    event: string,
    listener: (data: { readonly id?: string }) => void
  ) => void
}

declare global {
  interface ImportMeta {
    readonly hot?: CritHotModule
  }
}

const rootStyle: CSSProperties = {
  background: "oklch(98.5% 0 none)",
  color: "#191918",
  fontFamily: "InterVariable, Inter, sans-serif",
  height: "100%",
  minHeight: 420,
  overflow: "hidden",
  overscrollBehavior: "none",
  overscrollBehaviorX: "none",
  position: "relative",
  width: "100%"
}

const classes = (...values: ReadonlyArray<string | undefined>) =>
  values.filter(Predicate.isNotUndefined).join(" ")

type CritSessionConfig = {
  readonly sessionId: string
  readonly autosaveDelay: Duration.Input
  readonly refreshInterval: Duration.Input | false
  readonly presenceRefreshInterval: Duration.Input | false
}

type SessionIdRuntime = Pick<
  RuntimeCapabilities,
  "now" | "random" | "randomUUID" | "sessionStorage"
>

export type CritOpeningFailure =
  | { readonly kind: "client"; readonly failure: CritClientError }
  | { readonly kind: "defect"; readonly message: string }

export const critOpeningFailure = (
  cause: Cause.Cause<CritClientError>
): CritOpeningFailure => {
  const defect = cause.reasons.find(Cause.isDieReason)
  if (defect !== undefined) {
    const decoded = Schema.decodeUnknownOption(Schema.ErrorInstance())(
      defect.defect
    )
    return {
      kind: "defect",
      message: Option.match(decoded, {
        onNone: () => String(defect.defect),
        onSome: (failure) => failure.message
      })
    }
  }
  const expected = cause.reasons.find(Cause.isFailReason)
  return expected === undefined
    ? { kind: "defect", message: Cause.pretty(cause) }
    : { kind: "client", failure: expected.error }
}

export const sessionIdForCanvas = (
  canvasId: string,
  runtime: SessionIdRuntime = defaultRuntimeCapabilities
) => {
  const key = `@riff-refine/crit/session/${canvasId}`
  try {
    const storage = runtime.sessionStorage()
    const existing = storage?.getItem(key)
    if (existing) return existing
    const created = runtimeId("session", runtime)
    storage?.setItem(key, created)
    return created
  } catch {
    return runtimeId("session", runtime)
  }
}

export interface CritProps {
  readonly canvasId: string
  readonly canvasChoices?: ReadonlyArray<CanvasChoice>
  readonly services?: CritClientServices
  readonly apiPath?: string
  readonly autosaveDelay?: Duration.Input
  readonly refreshInterval?: Duration.Input | false
  readonly presenceRefreshInterval?: Duration.Input | false
  readonly sessionId?: string
  readonly draftJournal?: DraftJournal["Service"] | false
  readonly className?: string
  readonly style?: CSSProperties
  readonly iframeAllow?: string
  readonly iframeSandbox?: string
  readonly frameLoading?: FrameLoadingPolicy
  readonly frameChrome?: Partial<FrameChromeSettings>
  readonly cameraOptions?: Partial<CanvasCameraOptions>
  readonly developerTools?: boolean
  readonly features?: CritFeatures
  readonly onSession?: (session: CanvasSessionHandle) => void
  readonly onCanvasSelect?: (canvasId: string) => void
  readonly onCommandError?: (message: string) => void
  readonly onSignIn?: (author: Author) => void
  readonly extraCanvasContextMenus?: CanvasViewportProps["extraCanvasContextMenus"]
  readonly focusItemId?: string
  readonly loadingFallback?: ReactNode
  readonly errorFallback?: (message: string) => ReactNode
}

export function Crit({
  canvasId,
  canvasChoices,
  services,
  apiPath,
  autosaveDelay,
  refreshInterval,
  presenceRefreshInterval,
  sessionId,
  draftJournal,
  className,
  style,
  iframeAllow,
  iframeSandbox,
  frameLoading,
  frameChrome,
  cameraOptions,
  developerTools = false,
  features = DEFAULT_CRIT_FEATURES,
  onSession,
  onCanvasSelect,
  onCommandError,
  onSignIn,
  extraCanvasContextMenus,
  focusItemId,
  loadingFallback,
  errorFallback
}: CritProps) {
  const [session, setSession] = useState<CanvasSessionHandle | null>(null)
  const [sessionState, setSessionState] = useState<CanvasSessionState | null>(null)
  const [document, setDocument] = useState<CanvasDocument | null>(null)
  const [error, setError] = useState<CritOpeningFailure | null>(null)
  const onSessionRef = useRef(onSession)
  onSessionRef.current = onSession
  const resolvedSessionId = useMemo(
    () => sessionId ?? sessionIdForCanvas(canvasId),
    [canvasId, sessionId]
  )
  const resolvedServices = useMemo<CritClientServices>(
    () => services ?? HttpCritClient.make(apiPath === undefined ? {} : { apiPath }),
    [apiPath, services]
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

    const sessionOptions: CritSessionConfig = {
      sessionId: resolvedSessionId,
      autosaveDelay:
        autosaveDelay ?? DEFAULT_CANVAS_SESSION_AUTOSAVE_DELAY,
      refreshInterval:
        refreshInterval ?? DEFAULT_CANVAS_SESSION_REFRESH_INTERVAL,
      presenceRefreshInterval:
        presenceRefreshInterval ?? DEFAULT_CANVAS_SESSION_PRESENCE_INTERVAL
    }
    let opening = CanvasSession.open(canvasId, sessionOptions).pipe(
      Effect.provideService(CritClient, resolvedServices.client),
      Effect.provideService(Scope.Scope, scope)
    )
    if (resolvedServices.snapshots !== null) {
      opening = opening.pipe(
        Effect.provideService(CritSnapshotClient, resolvedServices.snapshots)
      )
    }
    if (resolvedServices.activity !== null) {
      opening = opening.pipe(
        Effect.provideService(CritActivityClient, resolvedServices.activity)
      )
    }
    if (resolvedJournal !== undefined) {
      opening = opening.pipe(Effect.provideService(DraftJournal, resolvedJournal))
    }

    void Effect.runPromise(Effect.exit(opening)).then(
      (result) => {
        if (cancelled) return
        if (Exit.isFailure(result)) {
          setError(critOpeningFailure(result.cause))
          return
        }
        const opened = result.value
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
      }
    )

    return () => {
      cancelled = true
      Effect.runFork(Scope.close(scope, Exit.void))
    }
  }, [
    autosaveDelay,
    canvasId,
    presenceRefreshInterval,
    refreshInterval,
    resolvedServices,
    resolvedJournal,
    resolvedSessionId
  ])

  useEffect(() => {
    if (session === null) return
    const hot = import.meta.hot
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
          session.refreshPresence()
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
    const message = error.kind === "client"
      ? critClientErrorMessage(error.failure)
      : error.message
    return (
      <CritBoundaryMessage
        error
        className={className}
        style={style}
      >
        {errorFallback?.(message) ?? (
          error.kind === "client" && isCurrentAuthorError(error.failure) ? (
            <GitIdentityBoundary
              detail={message}
              prompt={GIT_AUTHOR_REMEDIATION_PROMPT}
            />
          ) : (
            `Crit could not open this canvas: ${message}`
          )
        )}
      </CritBoundaryMessage>
    )
  }

  if (session === null || document === null) {
    return (
      <CritBoundaryMessage
        className={className}
        style={style}
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
        <CritOverlayProvider>
          <CanvasViewport
            author={sessionState?.presence.currentAuthor ?? null}
            dispatch={session.dispatch}
            document={document}
            developerTools={developerTools}
            features={features}
            snapshotFrame={session.snapshotFrame}
            canvasChoices={canvasChoices}
            frameChrome={frameChrome}
            cameraOptions={cameraOptions}
            iframeAllow={iframeAllow}
            iframeSandbox={iframeSandbox}
            frameLoading={frameLoading}
            onCommandError={onCommandError}
            onCanvasSelect={onCanvasSelect}
            extraCanvasContextMenus={extraCanvasContextMenus}
            onSignIn={onSignIn}
            focusItemId={focusItemId}
            presence={sessionState?.presence}
          />
          <CanvasHelpPanel />
          {sessionState === null ? null : (
            <CanvasSaveIndicator
              onDiscardLocalChanges={() => {
                Effect.runFork(
                  session.discardLocalChanges().pipe(
                    Effect.catch((cause) =>
                      Effect.sync(() => setError({
                        kind: "client",
                        failure: cause
                      }))
                    )
                  )
                )
              }}
              recoveryStatus={sessionState.recoveryStatus}
              saveStatus={sessionState.saveStatus}
            />
          )}
        </CritOverlayProvider>
      </CanvasHelpSurface>
    </GlyphProvider>
  )
}
