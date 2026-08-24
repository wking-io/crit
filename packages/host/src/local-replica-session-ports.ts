import type { LocalCanvasClientService, OpenFailure } from "@crit/client"
import { ReplicaSessionUnavailable, type ReplicaSessionPorts } from "@crit/react"
import { Effect, Fiber, Match, Stream } from "effect"
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

export const localReplicaSessionPorts = (
  client: LocalCanvasClientService
): ReplicaSessionPorts => ({
  open: (canvasId) => client.open(canvasId).pipe(
    Effect.mapError((failure) => new ReplicaSessionUnavailable({
      canvasId,
      reason: openFailureReason(failure)
    }))
  ),
  subscribe: (canvasId, onChanged) => {
    const fiber = Effect.runFork(
      Effect.scoped(client.subscribe(canvasId).pipe(
        Effect.flatMap(Stream.runForEach(() => Effect.sync(onChanged)))
      )).pipe(
        Effect.provide(Socket.layerWebSocketConstructorGlobal),
        Effect.ignore
      )
    )
    return () => {
      Effect.runFork(Fiber.interrupt(fiber))
    }
  }
})
