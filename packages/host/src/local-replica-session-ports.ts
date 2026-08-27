import {
  ReplicaChange,
  type LocalCanvasClientService,
  type OpenFailure,
  type StatusFailure,
  type SubscriptionFailure
} from "@crit/client"
import {
  ReplicaChangeRejected,
  ReplicaSubscriptionEvent,
  ReplicaSessionUnavailable,
  type ReplicaSessionPorts
} from "@crit/react"
import { formatLocalApiVersionUnsupported } from "@crit/replica/http"
import { Cause, Effect, Fiber, Match, Result, Stream } from "effect"
import * as Socket from "effect/unstable/socket/Socket"

export const localTransportFailureReason = (failure: StatusFailure): string =>
  Match.value(failure).pipe(Match.tagsExhaustive({
    HttpClientError: () => "The local daemon is unreachable.",
    LocalApiOriginRejected: () => "The local daemon rejected this origin.",
    LocalApiUnauthorized: () => "The browser session is no longer authorized.",
    LocalApiVersionUnsupported: formatLocalApiVersionUnsupported,
    SchemaError: () => "The local daemon sent an unexpected response."
  }))

const openFailureReason = (failure: OpenFailure): string =>
  failure._tag === "canvasNotFound"
    ? "The canvas does not exist on the local daemon."
    : localTransportFailureReason(failure)

const subscriptionLostReason = (failure: SubscriptionFailure): string =>
  Match.value(failure).pipe(
    Match.tag("LocalApiUnauthorized", () => "The browser session is no longer authorized."),
    Match.tag("ReplicaNotOpen", () => "The canvas does not exist on the local daemon."),
    Match.tag("LocalSubscriptionProtocolError", () =>
      "The local daemon sent an unexpected response."),
    Match.tag("SchemaError", () => "The local daemon sent an unexpected response."),
    Match.orElse(() => "The local daemon is unreachable.")
  )

const initialReconnectDelay = 500
const maximumReconnectDelay = 5_000

export const localReplicaSessionPorts = (
  client: LocalCanvasClientService
): ReplicaSessionPorts => ({
  open: (canvasId) => client.open(canvasId).pipe(
    Effect.mapError((failure) => new ReplicaSessionUnavailable({
      canvasId,
      reason: openFailureReason(failure)
    }))
  ),
  subscribe: (canvasId, onEvent) => {
    const emit = (event: ReplicaSubscriptionEvent) => Effect.sync(() => onEvent(event))
    const subscribeOnce: Effect.Effect<void, SubscriptionFailure> = Effect.scoped(
      client.subscribe(canvasId).pipe(
        Effect.tap(() => emit(ReplicaSubscriptionEvent.connected())),
        Effect.flatMap(Stream.runForEach(() => emit(ReplicaSubscriptionEvent.changed())))
      )
    ).pipe(Effect.provide(Socket.layerWebSocketConstructorGlobal))
    const loop = (delay: number): Effect.Effect<void> => subscribeOnce.pipe(
      Effect.matchCauseEffect({
        onFailure: (cause) => {
          if (Cause.hasInterruptsOnly(cause)) return Effect.void
          const found = Cause.findError(cause)
          return reconnect(delay, Result.getOrUndefined(found))
        },
        onSuccess: () => reconnect(delay)
      })
    )
    const reconnect = (
      delay: number,
      failure?: SubscriptionFailure
    ): Effect.Effect<void> => emit(
      ReplicaSubscriptionEvent.lost({
        reason: failure === undefined
          ? "The local daemon is unreachable."
          : subscriptionLostReason(failure)
      })
    ).pipe(
      Effect.andThen(Effect.sleep(delay)),
      Effect.andThen(loop(Math.min(delay * 2, maximumReconnectDelay)))
    )
    const fiber = Effect.runFork(
      loop(initialReconnectDelay)
    )
    return () => {
      Effect.runFork(Fiber.interrupt(fiber))
    }
  },
  change: ({ canvasId, commands }) =>
    client.change(ReplicaChange.make({ canvasId, commands })).pipe(
      Effect.map((receipt) => receipt.view),
      Effect.mapError((failure) => {
        if (failure._tag === "changeRejected") {
          return new ReplicaChangeRejected({ canvasId, failure: failure.failure })
        }
        return new ReplicaSessionUnavailable({
          canvasId,
          reason: openFailureReason(failure)
        })
      })
    )
})
