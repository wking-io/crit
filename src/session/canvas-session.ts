import type { Store } from "@tldraw/store"
import type { TLRecord } from "@tldraw/tlschema"
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
  AssetUnsupported,
  Canvas,
  CanvasCommandFailed,
  CanvasDocumentTooLarge,
  CanvasOpenFailed,
  type CanvasChange,
  type CanvasCommand
} from "../core/index.js"
import { CanvasInternals } from "../core/canvas.js"
import {
  CritClient,
  CritClientConflict,
  CritClientInvalidDocument,
  type CritClientError
} from "./crit-client.js"
import {
  DraftJournal,
  type CanvasDraft,
  type DraftJournalFailed,
  type DraftJournalShape
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

export const CanvasSessionState = Schema.Struct({
  canvasId: Schema.String,
  revision: Schema.Number,
  mutation: Schema.Number,
  confirmedMutation: Schema.Number,
  saveStatus: CanvasSessionSaveStatus,
  detail: Schema.NullOr(Schema.String),
  recoveryStatus: CanvasSessionRecoveryStatus,
  recoveryDetail: Schema.NullOr(Schema.String)
})
export type CanvasSessionState = typeof CanvasSessionState.Type

export interface CanvasSession {
  readonly state: SubscriptionRef.SubscriptionRef<CanvasSessionState>
  readonly store: Store<TLRecord>
  readonly recoveryDraft: CanvasDraft | null
  readonly dispatch: (
    ...commands: ReadonlyArray<CanvasCommand>
  ) => Effect.Effect<CanvasChange, CanvasCommandFailed>
  readonly flush: () => Effect.Effect<void, CritClientError>
}

export type CanvasSessionOptions = {
  readonly autosaveDelay?: Duration.Input
  readonly sessionId?: string
}

const openFailureDetail = (
  cause: CanvasOpenFailed | AssetUnsupported | CanvasDocumentTooLarge
) =>
  cause._tag === "AssetUnsupported"
    ? `Asset records are unsupported: ${cause.assetIds.join(", ")}`
    : cause._tag === "CanvasDocumentTooLarge"
      ? `Canvas Document is ${cause.actualBytes} bytes; maximum is ${cause.maxBytes}`
      : cause.detail

const open = (
  canvasId: string,
  options: CanvasSessionOptions = {}
): Effect.Effect<CanvasSession, CritClientError, CritClient | Scope.Scope> =>
  Effect.gen(function*() {
    const client = yield* CritClient
    const scope = yield* Effect.scope
    const authoritative = yield* client.load(canvasId)
    const journalOption = yield* Effect.serviceOption(DraftJournal)
    const journal: DraftJournalShape | undefined = Option.getOrUndefined(journalOption)
    const sessionId = options.sessionId ?? crypto.randomUUID()
    let recoveryDraft: CanvasDraft | null = null
    let recoveryStatus: CanvasSessionRecoveryStatus =
      journal === undefined ? "unavailable" : "available"
    let recoveryDetail: string | null =
      journal === undefined ? "Draft recovery is unavailable" : null

    if (journal !== undefined) {
      const loaded = yield* journal.load(canvasId, sessionId).pipe(
        Effect.map((draft) => ({ _tag: "Loaded" as const, draft })),
        Effect.catch((cause) =>
          Effect.succeed({ _tag: "Failed" as const, cause })
        )
      )
      if (loaded._tag === "Failed") {
        recoveryStatus = "unavailable"
        recoveryDetail = loaded.cause.detail
      } else if (Option.isSome(loaded.draft)) {
        recoveryDraft = loaded.draft.value
        if (recoveryDraft.baseRevision === authoritative.revision) {
          recoveryStatus = "recovered"
        } else {
          recoveryStatus = "conflict"
          recoveryDetail = `Draft base revision ${recoveryDraft.baseRevision} does not match authoritative revision ${authoritative.revision}`
        }
      }
    }

    const document =
      recoveryStatus === "recovered" && recoveryDraft !== null
        ? recoveryDraft.document
        : authoritative
    const canvas = yield* Canvas.open(document).pipe(
      Effect.mapError(
        (cause) =>
          new CritClientInvalidDocument({
            id: canvasId,
            detail: openFailureDetail(cause)
          })
      )
    )
    const store = CanvasInternals.store(canvas)
    CanvasInternals.setRevision(canvas, authoritative.revision)
    const revision = yield* Ref.make(authoritative.revision)
    const initialMutation =
      recoveryStatus === "recovered" && recoveryDraft !== null
        ? recoveryDraft.mutation
        : 0
    const mutation = yield* Ref.make(initialMutation)
    const confirmedMutation = yield* Ref.make(0)
    const state = yield* SubscriptionRef.make<CanvasSessionState>({
      canvasId,
      revision: authoritative.revision,
      mutation: initialMutation,
      confirmedMutation: 0,
      saveStatus:
        recoveryStatus === "recovered"
          ? "dirty"
          : recoveryStatus === "conflict"
            ? "conflict"
            : "clean",
      detail: recoveryStatus === "conflict" ? recoveryDetail : null,
      recoveryStatus,
      recoveryDetail
    })
    const saveLock = yield* Semaphore.make(1)
    const dispatchLock = yield* Semaphore.make(1)
    let dispatching = false

    const exportDocument = Effect.try({
      try: () => Canvas.export(canvas),
      catch: (cause) =>
        new CritClientInvalidDocument({
          id: canvasId,
          detail: cause instanceof Error ? cause.message : String(cause)
        })
    })

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
            const currentMutation = yield* Ref.get(mutation)
            const confirmed = yield* Ref.get(confirmedMutation)
            if (currentMutation <= confirmed) return
            const snapshot = yield* exportDocument
            const baseRevision = yield* Ref.get(revision)
            yield* journal
              .save({
                schemaVersion: 1,
                canvasId,
                sessionId,
                baseRevision,
                mutation: currentMutation,
                document: snapshot
              })
              .pipe(Effect.catch(markJournalUnavailable))
          })

    const saveUntilClean = saveLock.withPermit(
      Effect.gen(function*() {
        while (true) {
          const pendingMutation = yield* Ref.get(mutation)
          const confirmed = yield* Ref.get(confirmedMutation)
          if (pendingMutation <= confirmed) return

          yield* SubscriptionRef.update(state, (current): CanvasSessionState => ({
            ...current,
            saveStatus: "saving",
            detail: null
          }))
          const expectedRevision = yield* Ref.get(revision)
          const snapshot = yield* exportDocument
          yield* writeLatestDraft
          const saved = yield* client.save(snapshot, expectedRevision).pipe(
            Effect.tapError((cause) =>
              SubscriptionRef.update(state, (current): CanvasSessionState => ({
                ...current,
                saveStatus:
                  cause instanceof CritClientConflict ? "conflict" : "save-error",
                detail:
                  cause instanceof CritClientConflict
                    ? `Expected revision ${cause.expectedRevision}; current revision is ${cause.currentRevision}`
                    : cause._tag === "CritClientNotFound"
                      ? `Canvas not found: ${cause.id}`
                      : cause.detail
              }))
            )
          )

          CanvasInternals.setRevision(canvas, saved.revision)
          yield* Ref.set(revision, saved.revision)
          yield* Ref.set(confirmedMutation, pendingMutation)
          if (journal !== undefined) {
            yield* journal
              .clear(canvasId, sessionId, pendingMutation)
              .pipe(Effect.catch(markJournalUnavailable))
          }
          const latestMutation = yield* Ref.get(mutation)
          yield* SubscriptionRef.update(state, (current): CanvasSessionState => ({
            ...current,
            revision: saved.revision,
            confirmedMutation: pendingMutation,
            saveStatus: latestMutation === pendingMutation ? "clean" : "dirty",
            detail: null
          }))
        }
      })
    )

    const scheduleSave = (delay: Duration.Input | undefined) =>
      Effect.forkIn(
        (delay === undefined ? Effect.void : Effect.sleep(delay)).pipe(
          Effect.andThen(saveUntilClean),
          Effect.catch(() => Effect.void)
        ),
        scope
      ).pipe(Effect.asVoid)

    const scheduleDraft = (delay: Duration.Input | undefined) =>
      Effect.forkIn(
        (delay === undefined ? Effect.void : Effect.sleep(delay)).pipe(
          Effect.andThen(writeLatestDraft),
          Effect.catch(() => Effect.void)
        ),
        scope
      ).pipe(Effect.asVoid)

    const markDirty = (delay: Duration.Input | undefined) =>
      Effect.gen(function*() {
        const before = yield* SubscriptionRef.get(state)
        const nextMutation = yield* Ref.updateAndGet(
          mutation,
          (current) => current + 1
        )
        yield* SubscriptionRef.update(state, (current): CanvasSessionState => ({
          ...current,
          mutation: nextMutation,
          saveStatus:
            current.saveStatus === "saving" || current.saveStatus === "conflict"
              ? current.saveStatus
              : "dirty",
          detail: current.saveStatus === "conflict" ? current.detail : null
        }))
        if (before.saveStatus !== "conflict") {
          yield* scheduleDraft(delay)
          yield* scheduleSave(delay)
        }
      })

    const removeListener = store.listen(
      () => {
        if (dispatching) return
        Effect.runFork(markDirty(options.autosaveDelay ?? 100))
      },
      { source: "user", scope: "document" }
    )
    yield* Effect.addFinalizer(() => Effect.sync(removeListener))
    if (recoveryStatus === "recovered") yield* scheduleSave(undefined)

    return {
      state,
      store,
      recoveryDraft,
      dispatch: (...commands) =>
        commands.length === 0
          ? Effect.fail(
              new CanvasCommandFailed({
                reason: "invalid-command",
                detail: "A Canvas Session dispatch requires at least one command"
              })
            )
          : dispatchLock.withPermit(
              Effect.sync(() => {
                dispatching = true
              }).pipe(
                Effect.andThen(Canvas.apply(canvas, ...commands)),
                Effect.ensuring(
                  Effect.sync(() => {
                    dispatching = false
                  })
                ),
                Effect.tap(() => markDirty(undefined))
              )
            ),
      flush: () => saveUntilClean
    }
  })

export const CanvasSession = { open } as const
