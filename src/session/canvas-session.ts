import type { Store } from "@tldraw/store"
import type { TLRecord } from "@tldraw/tlschema"
import {
  Duration,
  Effect,
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

export const CanvasSessionSaveStatus = Schema.Union([
  Schema.Literal("clean"),
  Schema.Literal("dirty"),
  Schema.Literal("saving"),
  Schema.Literal("save-error"),
  Schema.Literal("conflict")
])
export type CanvasSessionSaveStatus = typeof CanvasSessionSaveStatus.Type

export const CanvasSessionState = Schema.Struct({
  canvasId: Schema.String,
  revision: Schema.Number,
  mutation: Schema.Number,
  confirmedMutation: Schema.Number,
  saveStatus: CanvasSessionSaveStatus,
  detail: Schema.NullOr(Schema.String)
})
export type CanvasSessionState = typeof CanvasSessionState.Type

export interface CanvasSession {
  readonly state: SubscriptionRef.SubscriptionRef<CanvasSessionState>
  readonly store: Store<TLRecord>
  readonly dispatch: (
    ...commands: ReadonlyArray<CanvasCommand>
  ) => Effect.Effect<CanvasChange, CanvasCommandFailed>
  readonly flush: () => Effect.Effect<void, CritClientError>
}

export type CanvasSessionOptions = {
  readonly autosaveDelay?: Duration.Input
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
    const document = yield* client.load(canvasId)
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
    const revision = yield* Ref.make(document.revision)
    const mutation = yield* Ref.make(0)
    const confirmedMutation = yield* Ref.make(0)
    const state = yield* SubscriptionRef.make<CanvasSessionState>({
      canvasId,
      revision: document.revision,
      mutation: 0,
      confirmedMutation: 0,
      saveStatus: "clean",
      detail: null
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
        if (before.saveStatus !== "conflict") yield* scheduleSave(delay)
      })

    const removeListener = store.listen(
      () => {
        if (dispatching) return
        Effect.runFork(markDirty(options.autosaveDelay ?? 100))
      },
      { source: "user", scope: "document" }
    )
    yield* Effect.addFinalizer(() => Effect.sync(removeListener))

    return {
      state,
      store,
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
