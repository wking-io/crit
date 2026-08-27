import {
  AuthorityModel,
  type AuthorityView,
  type SubmitCanvasChangeFailure
} from "@crit/authority"
import type { RemoteCanvasAuthorityService } from "@crit/client"
import {
  Id,
  type CanvasId,
  type ChangeId,
  type PersonPrincipal
} from "@crit/domain"
import {
  formatProtocolFailure,
  isProtocolFailure,
  type Cursor
} from "@crit/protocol"
import {
  ReplicaView
} from "@crit/replica"
import {
  ReplicaChangeRejected,
  ReplicaSessionUnavailable,
  ReplicaSubscriptionEvent,
  type ReplicaSessionPorts
} from "@crit/react"
import { Cause, Effect, Fiber, Result } from "effect"

export interface HostedReplicaSessionDeps {
  readonly authority: RemoteCanvasAuthorityService
  readonly principal: PersonPrincipal
  readonly pollIntervalMs?: number
}

const maximumPollIntervalMs = 30_000

const widen = (view: AuthorityView): ReplicaView => ReplicaView.make({
  canvasId: view.canvasId,
  acknowledgedCursor: view.cursor,
  projection: view.projection,
  pending: []
})

const unavailable = (
  canvasId: CanvasId,
  reason: string
) => new ReplicaSessionUnavailable({ canvasId, reason })

const mintChangeId = (): ChangeId =>
  Id.change(`change_${crypto.randomUUID().replaceAll("-", "")}`)

export const hostedReplicaSessionPorts = (
  deps: HostedReplicaSessionDeps
): ReplicaSessionPorts => {
  const cursors = new Map<CanvasId, Cursor>()
  const pollIntervalMs = deps.pollIntervalMs ?? 3_000

  const open: ReplicaSessionPorts["open"] = (canvasId) =>
    deps.authority.open(canvasId).pipe(
      Effect.matchCauseEffect({
        onFailure: (cause) => {
          const found = Cause.findError(cause)
          if (Result.isSuccess(found) && found.success._tag === "canvasNotFound") {
            return Effect.fail(unavailable(canvasId, "The canvas does not exist."))
          }
          if (Result.isSuccess(found) && isProtocolFailure(found.success)) {
            return Effect.fail(unavailable(canvasId, formatProtocolFailure(found.success)))
          }
          return Effect.fail(unavailable(canvasId, "The hosted service is unreachable."))
        },
        onSuccess: (view) => Effect.sync(() => {
          cursors.set(canvasId, view.cursor)
          return widen(view)
        })
      })
    )

  const subscribe: ReplicaSessionPorts["subscribe"] = (
    canvasId,
    onEvent
  ) => {
    const emit = (event: ReplicaSubscriptionEvent) =>
      Effect.sync(() => onEvent(event))
    const poll = (delay: number) => Effect.sleep(delay).pipe(
      Effect.andThen(Effect.suspend(() => {
        const cursor = cursors.get(canvasId)
        if (cursor === undefined) return Effect.succeed(false)
        return deps.authority.changesAfter(AuthorityModel.changesAfter({
          canvasId,
          after: cursor,
          limit: AuthorityModel.pageLimit(1)
        })).pipe(
          Effect.tap((page) => page.changes.length === 0
            ? Effect.void
            : emit(ReplicaSubscriptionEvent.changed())),
          Effect.as(true)
        )
      }))
    )
    function loop(
      delay: number,
      connected: boolean
    ): Effect.Effect<void> {
      return poll(delay).pipe(Effect.matchCauseEffect({
        onFailure: (cause) => {
          if (Cause.hasInterruptsOnly(cause)) return Effect.void
          const found = Cause.findError(cause)
          const reason = Result.isSuccess(found) && isProtocolFailure(found.success)
            ? formatProtocolFailure(found.success)
            : "The hosted service is unreachable."
          return emit(ReplicaSubscriptionEvent.lost({
            reason
          })).pipe(
            Effect.andThen(loop(
              Math.min(delay * 2, maximumPollIntervalMs),
              false
            ))
          )
        },
        onSuccess: (polled) => {
          const announce = polled && !connected
            ? emit(ReplicaSubscriptionEvent.connected())
            : Effect.void
          return announce.pipe(
            Effect.andThen(loop(pollIntervalMs, connected || polled))
          )
        }
      }))
    }
    const fiber = Effect.runFork(loop(pollIntervalMs, false))
    return () => {
      Effect.runFork(Fiber.interrupt(fiber))
    }
  }

  const change: ReplicaSessionPorts["change"] = ({
    canvasId,
    commands
  }) => {
    const changed: Effect.Effect<
      ReplicaView,
      SubmitCanvasChangeFailure
    > = Effect.gen(function*() {
      const receipt = yield* deps.authority.submit({
        changeId: mintChangeId(),
        canvasId,
        observedCursor: cursors.get(canvasId) ?? null,
        commands
      }, AuthorityModel.personInvocation({ principal: deps.principal }))
      cursors.set(canvasId, receipt.change.cursor)
      const view = yield* deps.authority.open(canvasId)
      cursors.set(canvasId, view.cursor)
      return widen(view)
    })
    return changed.pipe(Effect.matchCauseEffect({
      onFailure: (
        cause
      ): Effect.Effect<
        never,
        ReplicaSessionUnavailable | ReplicaChangeRejected
      > => {
        const found = Cause.findError(cause)
        if (Result.isSuccess(found) && found.success._tag === "changeRejected") {
          return Effect.fail(new ReplicaChangeRejected({
            canvasId,
            failure: found.success.failure
          }))
        }
        if (Result.isSuccess(found) && found.success._tag === "canvasNotFound") {
          return Effect.fail(unavailable(canvasId, "The canvas does not exist."))
        }
        if (Result.isSuccess(found) && isProtocolFailure(found.success)) {
          return Effect.fail(unavailable(canvasId, formatProtocolFailure(found.success)))
        }
        return Effect.fail(unavailable(canvasId, "The hosted service is unreachable."))
      },
      onSuccess: (view) => Effect.succeed(view)
    }))
  }

  return { open, subscribe, change }
}
