import type { LocalCanvasClientService, OpenFailure } from "@crit/client"
import {
  ReplicaChangeRejected,
  ReplicaSubscriptionEvent,
  ReplicaSessionUnavailable,
  type ReplicaSessionPorts
} from "@crit/react"
import { Cause, Effect, Fiber, Match, Stream } from "effect"
import * as Socket from "effect/unstable/socket/Socket"

const openFailureReason = (failure: OpenFailure): string =>
  Match.value(failure).pipe(Match.tagsExhaustive({
    "canvas-not-found": () => "The canvas does not exist on the local daemon.",
    HttpClientError: () => "The local daemon is unreachable.",
    LocalApiOriginRejected: () => "The local daemon rejected this origin.",
    LocalApiUnauthorized: () => "The browser session is no longer authorized.",
    LocalApiVersionUnsupported: () => "The local daemon speaks an unsupported API version.",
    SchemaError: () => "The local daemon sent an unexpected response."
  }))

const subscriptionLostReason = "The local daemon is unreachable."
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
    const subscribeOnce = Effect.scoped(client.subscribe(canvasId).pipe(
      Effect.tap(() => emit(ReplicaSubscriptionEvent.connected())),
      Effect.tap(() => client.open(canvasId).pipe(
        Effect.tap(() => emit(ReplicaSubscriptionEvent.changed())),
        Effect.ignore
      )),
      Effect.flatMap(Stream.runForEach(() => emit(ReplicaSubscriptionEvent.changed())))
    )).pipe(Effect.provide(Socket.layerWebSocketConstructorGlobal))
    const loop = (delay: number): Effect.Effect<void> => subscribeOnce.pipe(
      Effect.matchCauseEffect({
        onFailure: (cause) => Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : reconnect(delay),
        onSuccess: () => reconnect(delay)
      })
    )
    const reconnect = (delay: number): Effect.Effect<void> => emit(
      ReplicaSubscriptionEvent.lost({ reason: subscriptionLostReason })
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
    client.change({ _tag: "replica-change", canvasId, commands }).pipe(
      Effect.map((receipt) => receipt.view),
      Effect.mapError((failure) => {
        if (failure._tag === "change-rejected") {
          return new ReplicaChangeRejected({ canvasId, failure: failure.failure })
        }
        return new ReplicaSessionUnavailable({
          canvasId,
          reason: openFailureReason(failure)
        })
      })
    )
})
