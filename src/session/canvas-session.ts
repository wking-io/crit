import {
  Duration,
  Effect,
  Option,
  Ref,
  Schema,
  Semaphore,
  SubscriptionRef,
  type Scope
} from "effect"

import {
  Canvas,
  CanvasCommandFailed,
  Author,
  type CanvasChange,
  type CanvasCommand,
  type CanvasDocument
} from "../core/index.js"
import { CanvasInternals } from "../core/canvas.js"
import {
  AgentActivity
} from "../runtime/agent-activity.js"
import { critClientErrorMessage } from "../runtime/canvas-failure.js"
import { runtimeId } from "../runtime/runtime-capabilities.js"
import {
  CritActivityClient,
  CritClient,
  CritClientCommandFailed,
  CritClientInvalidDocument,
  CritSnapshotClient,
  CritClientUnavailable,
  type CritClientError
} from "./crit-client.js"
import {
  DraftJournal,
  type CanvasDraft,
  type DraftJournalFailed
} from "./draft-journal.js"

export const CanvasSessionSaveStatus = Schema.Union([
  Schema.Literal("clean"),
  Schema.Literal("dirty"),
  Schema.Literal("saving"),
  Schema.Literal("save-error"),
  Schema.Literal("conflict")
])
export type CanvasSessionSaveStatus = typeof CanvasSessionSaveStatus.Type

export const CanvasSessionRecoveryStatus = Schema.Union([
  Schema.Literal("available"),
  Schema.Literal("unavailable"),
  Schema.Literal("recovered"),
  Schema.Literal("conflict")
])
export type CanvasSessionRecoveryStatus =
  typeof CanvasSessionRecoveryStatus.Type

export const CanvasPresenceAvailability = Schema.Union([
  Schema.Literal("available"),
  Schema.Literal("unavailable")
])
export type CanvasPresenceAvailability =
  typeof CanvasPresenceAvailability.Type

export const CanvasPresence = Schema.Struct({
  currentAuthor: Author,
  activities: Schema.Array(AgentActivity),
  availability: CanvasPresenceAvailability
})
export type CanvasPresence = typeof CanvasPresence.Type

export const CanvasSessionState = Schema.Struct({
  canvasId: Schema.String,
  revision: Schema.Number,
  mutation: Schema.Number,
  confirmedMutation: Schema.Number,
  saveStatus: CanvasSessionSaveStatus,
  detail: Schema.NullOr(Schema.String),
  recoveryStatus: CanvasSessionRecoveryStatus,
  recoveryDetail: Schema.NullOr(Schema.String),
  presence: CanvasPresence
})
export type CanvasSessionState = typeof CanvasSessionState.Type

export interface CanvasSession {
  readonly state: SubscriptionRef.SubscriptionRef<CanvasSessionState>
  readonly document: SubscriptionRef.SubscriptionRef<CanvasDocument>
  readonly recoveryDraft: CanvasDraft | null
  readonly dispatch: (
    ...commands: ReadonlyArray<CanvasCommand>
  ) => Effect.Effect<CanvasChange, CanvasCommandFailed>
  readonly flush: () => Effect.Effect<void, CritClientError>
  readonly refresh: () => Effect.Effect<boolean, CritClientError>
  readonly discardLocalChanges: () => Effect.Effect<void, CritClientError>
  readonly snapshotFrame: (
    frameId: string
  ) => Effect.Effect<CanvasDocument, CritClientError>
  readonly refreshPresence: () => Effect.Effect<boolean>
}

export type CanvasSessionOptions = {
  readonly autosaveDelay?: Duration.Input
  readonly refreshInterval?: Duration.Input | false
  readonly presenceRefreshInterval?: Duration.Input | false
  readonly sessionId?: string
}

export const DEFAULT_CANVAS_SESSION_AUTOSAVE_DELAY: Duration.Input = 100
export const DEFAULT_CANVAS_SESSION_REFRESH_INTERVAL: Duration.Input = 2_000
export const DEFAULT_CANVAS_SESSION_PRESENCE_INTERVAL: Duration.Input = 5_000

type PollingSchedule =
  | { readonly enabled: false }
  | { readonly enabled: true; readonly interval: Duration.Input }

const pollingSchedule = (
  input: Duration.Input | false | undefined,
  defaultInterval: Duration.Input
): PollingSchedule => input === false
  ? { enabled: false }
  : { enabled: true, interval: input ?? defaultInterval }

const invalidDocument = (canvasId: string, cause: unknown) =>
  new CritClientInvalidDocument({
    id: canvasId,
    detail:
      cause instanceof CanvasCommandFailed
        ? cause.detail
        : cause instanceof Error
          ? cause.message
          : String(cause)
  })

type PendingBatch = {
  readonly mutation: number
  readonly commands: ReadonlyArray<CanvasCommand>
}

const open = (
  canvasId: string,
  options: CanvasSessionOptions = {}
): Effect.Effect<CanvasSession, CritClientError, CritClient | Scope.Scope> =>
  Effect.gen(function*() {
    const client = yield* CritClient
    const scope = yield* Effect.scope
    const autosaveDelay =
      options.autosaveDelay ?? DEFAULT_CANVAS_SESSION_AUTOSAVE_DELAY
    const documentRefresh = pollingSchedule(
      options.refreshInterval,
      DEFAULT_CANVAS_SESSION_REFRESH_INTERVAL
    )
    const presenceRefresh = pollingSchedule(
      options.presenceRefreshInterval,
      DEFAULT_CANVAS_SESSION_PRESENCE_INTERVAL
    )
    const snapshotClient = Option.getOrNull(
      yield* Effect.serviceOption(CritSnapshotClient)
    )
    const activityClient = Option.getOrNull(
      yield* Effect.serviceOption(CritActivityClient)
    )
    const opened = yield* Effect.all({
      authoritative: client.load(canvasId),
      currentAuthor: client.currentAuthor()
    }, { concurrency: "unbounded" })
    const authoritative = opened.authoritative
    const currentAuthor = opened.currentAuthor
    const journalOption = yield* Effect.serviceOption(DraftJournal)
    const journal: DraftJournal["Service"] | undefined = Option.getOrUndefined(journalOption)
    const sessionId = options.sessionId ?? runtimeId("session")
    let recoveryDraft: CanvasDraft | null = null
    let recoveryStatus: CanvasSessionRecoveryStatus =
      journal === undefined ? "unavailable" : "available"
    let recoveryDetail: string | null =
      journal === undefined ? "Draft recovery is unavailable" : null

    if (journal !== undefined) {
      const loaded = yield* journal.load(canvasId, sessionId).pipe(
        Effect.map((draft) => ({ _tag: "Loaded" as const, draft })),
        Effect.catch((cause) => Effect.succeed({ _tag: "Failed" as const, cause }))
      )
      if (loaded._tag === "Failed") {
        recoveryStatus = "unavailable"
        recoveryDetail = loaded.cause.detail
      } else if (Option.isSome(loaded.draft)) {
        recoveryDraft = loaded.draft.value
      }
    }

    const canvas = Canvas.fromDocument(authoritative)
    let pending: Array<PendingBatch> = []
    let initialMutation = 0
    if (recoveryDraft !== null) {
      const recovered = yield* Canvas.apply(canvas, ...recoveryDraft.commands).pipe(
        Effect.as(true),
        Effect.catch((cause) =>
          Effect.sync(() => {
            recoveryStatus = "conflict"
            recoveryDetail = `Draft could not be replayed: ${cause.detail}`
            return false
          })
        )
      )
      if (recovered) {
        recoveryStatus = "recovered"
        initialMutation = recoveryDraft.mutation
        pending = [{ mutation: initialMutation, commands: recoveryDraft.commands }]
      }
    }

    const exported = yield* Effect.try({
      try: () => Canvas.export(canvas),
      catch: (cause) => invalidDocument(canvasId, cause)
    })
    const document = yield* SubscriptionRef.make(exported)
    const revision = yield* Ref.make(authoritative.revision)
    const mutation = yield* Ref.make(initialMutation)
    const confirmedMutation = yield* Ref.make(0)
    const initialRecoveryStatus =
      Schema.decodeUnknownSync(CanvasSessionRecoveryStatus)(recoveryStatus)
    const state = yield* SubscriptionRef.make<CanvasSessionState>({
      canvasId,
      revision: authoritative.revision,
      mutation: initialMutation,
      confirmedMutation: 0,
      saveStatus:
        initialRecoveryStatus === "recovered"
          ? "dirty"
          : initialRecoveryStatus === "conflict"
            ? "conflict"
            : "clean",
      detail: initialRecoveryStatus === "conflict" ? recoveryDetail : null,
      recoveryStatus: initialRecoveryStatus,
      recoveryDetail,
      presence: {
        currentAuthor,
        activities: [],
        availability: activityClient === null ? "unavailable" : "available"
      }
    })
    const saveLock = yield* Semaphore.make(1)
    const documentLock = yield* Semaphore.make(1)
    const refreshLock = yield* Semaphore.make(1)

    const publishDocument = Effect.try({
      try: () => Canvas.export(canvas),
      catch: (cause) => invalidDocument(canvasId, cause)
    }).pipe(
      Effect.flatMap((snapshot) => SubscriptionRef.set(document, snapshot))
    )

    const markJournalUnavailable = (cause: DraftJournalFailed) =>
      SubscriptionRef.update(state, (current): CanvasSessionState => ({
        ...current,
        recoveryStatus: "unavailable",
        recoveryDetail: cause.detail
      }))

    const writeLatestDraft =
      journal === undefined
        ? Effect.void
        : Effect.gen(function*() {
            const batches = pending
            if (batches.length === 0) return
            const currentMutation = batches.at(-1)!.mutation
            const baseRevision = yield* Ref.get(revision)
            yield* journal
              .save({
                schemaVersion: 1,
                canvasId,
                sessionId,
                baseRevision,
                mutation: currentMutation,
                commands: batches.flatMap((batch) => batch.commands)
              })
              .pipe(Effect.catch(markJournalUnavailable))
          })

    const saveUntilClean = saveLock.withPermit(
      Effect.gen(function*() {
        while (pending.length > 0) {
          const sending = pending
          const throughMutation = sending.at(-1)!.mutation
          const commands = sending.flatMap((batch) => batch.commands)
          yield* SubscriptionRef.update(state, (current): CanvasSessionState => ({
            ...current,
            saveStatus: "saving",
            detail: null
          }))
          yield* writeLatestDraft
          const saved = yield* client.apply(canvasId, commands).pipe(
            Effect.tapError((cause) =>
              SubscriptionRef.update(state, (current): CanvasSessionState => ({
                ...current,
                saveStatus:
                  cause instanceof CritClientCommandFailed
                    ? "conflict"
                    : "save-error",
                detail:
                  cause._tag === "CritClientNotFound"
                      ? `Canvas not found: ${cause.id}`
                      : cause.detail
              }))
            )
          )

          yield* documentLock.withPermit(
            Effect.gen(function*() {
              pending = pending.filter((batch) => batch.mutation > throughMutation)
              const rebased = Canvas.fromDocument(saved)
              if (pending.length > 0) {
                yield* Canvas.apply(
                  rebased,
                  ...pending.flatMap((batch) => batch.commands)
                ).pipe(Effect.mapError((cause) => invalidDocument(canvasId, cause)))
              }
              CanvasInternals.adoptDocument(canvas, rebased)
              yield* Ref.set(revision, saved.revision)
              yield* Ref.set(confirmedMutation, throughMutation)
              yield* publishDocument
              const latestMutation = yield* Ref.get(mutation)
              yield* SubscriptionRef.update(
                state,
                (current): CanvasSessionState => ({
                  ...current,
                  revision: saved.revision,
                  confirmedMutation: throughMutation,
                  saveStatus:
                    latestMutation === throughMutation ? "clean" : "dirty",
                  detail: null
                })
              )
            })
          )
          if (journal !== undefined) {
            yield* journal
              .clear(canvasId, sessionId, throughMutation)
              .pipe(Effect.catch(markJournalUnavailable))
          }
        }
      })
    )

    const schedule = (effect: Effect.Effect<void, unknown>, delay: Duration.Input) =>
      Effect.forkIn(
        Effect.sleep(delay).pipe(
          Effect.andThen(effect),
          Effect.catch(() => Effect.void)
        ),
        scope
      ).pipe(Effect.asVoid)

    const refresh = refreshLock.withPermit(
      Effect.gen(function*() {
        if (pending.length > 0) return false
        const localRevision = yield* Ref.get(revision)
        const remote = yield* client.load(canvasId)
        if (remote.revision <= localRevision) return false
        const remoteCanvas = Canvas.fromDocument(remote)

        return yield* documentLock.withPermit(
          Effect.gen(function*() {
            if (pending.length > 0) return false
            CanvasInternals.adoptDocument(canvas, remoteCanvas)
            yield* Ref.set(revision, remote.revision)
            yield* publishDocument
            yield* SubscriptionRef.update(
              state,
              (current): CanvasSessionState => ({
                ...current,
                revision: remote.revision,
                detail: null
              })
            )
            return true
          })
        )
      })
    )

    const markPresenceUnavailable = (cause: CritClientError | null) =>
      Effect.gen(function*() {
        const current = yield* SubscriptionRef.get(state)
        yield* SubscriptionRef.update(
          state,
          (latest): CanvasSessionState => ({
            ...latest,
            presence: {
              ...latest.presence,
              activities: [],
              availability: "unavailable"
            }
          })
        )
        if (
          cause !== null &&
          current.presence.availability !== "unavailable"
        ) {
          yield* Effect.logWarning(
            `Canvas Presence is unavailable for ${canvasId}: ${
              critClientErrorMessage(cause)
            }`
          )
        }
        return false
      })

    const refreshPresence = () =>
      activityClient === null
        ? markPresenceUnavailable(null)
        : activityClient.activities(canvasId).pipe(
            Effect.tap((collection) =>
              SubscriptionRef.update(
                state,
                (current): CanvasSessionState => ({
                  ...current,
                  presence: {
                    ...current.presence,
                    activities: collection.activities,
                    availability: "available"
                  }
                })
              )
            ),
            Effect.map((collection) => collection.activities.length > 0),
            Effect.catch((cause) => markPresenceUnavailable(cause))
          )

    const discardLocalChanges = saveLock.withPermit(
      documentLock.withPermit(Effect.gen(function*() {
        const remote = yield* client.load(canvasId)
        const remoteCanvas = Canvas.fromDocument(remote)
        pending = []
        CanvasInternals.adoptDocument(canvas, remoteCanvas)
        yield* Ref.set(revision, remote.revision)
        const currentMutation = yield* Ref.get(mutation)
        yield* Ref.set(confirmedMutation, currentMutation)
        yield* publishDocument
        if (journal !== undefined) {
          yield* journal
            .clear(canvasId, sessionId, currentMutation)
            .pipe(Effect.catch(markJournalUnavailable))
        }
        yield* SubscriptionRef.update(
          state,
          (current): CanvasSessionState => ({
            ...current,
            revision: remote.revision,
            confirmedMutation: currentMutation,
            saveStatus: "clean",
            detail: null,
            recoveryStatus:
              current.recoveryStatus === "unavailable"
                ? "unavailable"
                : "available",
            recoveryDetail:
              current.recoveryStatus === "unavailable"
                ? current.recoveryDetail
                : null
          })
        )
      }))
    )

    const snapshotFrame = (frameId: string) =>
      Effect.gen(function*() {
        if (snapshotClient === null) {
          return yield* new CritClientUnavailable({
            operation: "snapshot",
            id: canvasId,
            detail: "This Crit client does not provide snapshot capture"
          })
        }
        yield* saveUntilClean
        const saved = yield* snapshotClient.snapshot(canvasId, frameId)
        yield* documentLock.withPermit(
          Effect.gen(function*() {
            const rebased = Canvas.fromDocument(saved)
            if (pending.length > 0) {
              yield* Canvas.apply(
                rebased,
                ...pending.flatMap((batch) => batch.commands)
              ).pipe(Effect.mapError((cause) => invalidDocument(canvasId, cause)))
            }
            CanvasInternals.adoptDocument(canvas, rebased)
            yield* Ref.set(revision, saved.revision)
            yield* publishDocument
            yield* SubscriptionRef.update(
              state,
              (current): CanvasSessionState => ({
                ...current,
                revision: saved.revision,
                detail: null
              })
            )
          })
        )
        return saved
      })

    if (recoveryStatus === "recovered") {
      yield* Effect.forkIn(saveUntilClean.pipe(Effect.catch(() => Effect.void)), scope)
    }
    yield* Effect.forkIn(
      refreshPresence().pipe(Effect.asVoid),
      scope
    )
    if (documentRefresh.enabled) {
      yield* Effect.forkIn(
        Effect.gen(function*() {
          while (true) {
            yield* Effect.sleep(documentRefresh.interval)
            yield* refresh.pipe(Effect.catch(() => Effect.void))
          }
        }),
        scope
      )
    }
    if (presenceRefresh.enabled) {
      yield* Effect.forkIn(
        Effect.gen(function*() {
          while (true) {
            yield* Effect.sleep(presenceRefresh.interval)
            yield* refreshPresence()
          }
        }),
        scope
      )
    }

    return {
      state,
      document,
      recoveryDraft,
      dispatch: (...commands) =>
        commands.length === 0
          ? Effect.fail(
              new CanvasCommandFailed({
                reason: "invalid-command",
                detail: "A Canvas Session dispatch requires at least one command"
              })
            )
          : documentLock.withPermit(
              Effect.gen(function*() {
                const change = yield* Canvas.apply(canvas, ...commands)
                const nextMutation = yield* Ref.updateAndGet(
                  mutation,
                  (current) => current + 1
                )
                pending = [...pending, { mutation: nextMutation, commands }]
                yield* publishDocument.pipe(
                  Effect.mapError(
                    (cause) =>
                      new CanvasCommandFailed({
                        reason: "apply-failed",
                        detail: cause.detail
                      })
                  )
                )
                yield* SubscriptionRef.update(
                  state,
                  (current): CanvasSessionState => ({
                    ...current,
                    mutation: nextMutation,
                    saveStatus:
                      current.saveStatus === "saving" ? "saving" : "dirty",
                    detail: null
                  })
                )
                yield* schedule(writeLatestDraft, autosaveDelay)
                yield* schedule(saveUntilClean, autosaveDelay)
                return change
              })
            ),
      flush: () => saveUntilClean,
      refresh: () => refresh,
      discardLocalChanges: () => discardLocalChanges,
      snapshotFrame,
      refreshPresence
    }
  })

export const CanvasSession = { open } as const
