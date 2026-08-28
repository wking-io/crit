import {
  HostedAccessDenied,
  HostedReviewClient,
  HttpArtifactStore,
  LocalCanvasClient,
  LocalRepresentationClient,
  RemoteAuthorityOptions,
  RemoteCanvasAuthority,
  type HostedReviewFailure,
  type LocalClientOptions,
  type StatusFailure
} from "@crit/client"
import { type CanvasId } from "@crit/domain"
import { formatProtocolFailure, isProtocolFailure } from "@crit/protocol"
import type { CanvasListing } from "@crit/replica/http"
import { Cause, Data, Effect, Layer, Match, Result } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { Atom, AsyncResult } from "effect/unstable/reactivity"

import type { CritHostProps } from "./crit-host.js"
import { hostedFramePorts } from "./hosted-frame-ports.js"
import { hostedPersonPrincipal } from "./hosted-identity.js"
import { hostedReplicaSessionPorts } from "./hosted-replica-session-ports.js"
import { localClientOptionsFor, type HostRuntime } from "./host-connection.js"
import {
  localReplicaSessionPorts,
  localTransportFailureReason
} from "./local-replica-session-ports.js"

export type HostScreen = Data.TaggedEnum<{
  readonly invalid: { readonly reason: string }
  readonly connecting: {}
  readonly ready: { readonly props: CritHostProps }
}>
export const HostScreen = Data.taggedEnum<HostScreen>()

export type HostIndexScreen = Data.TaggedEnum<{
  readonly invalid: { readonly reason: string }
  readonly connecting: {}
  readonly ready: { readonly listings: ReadonlyArray<CanvasListing> }
  readonly failed: { readonly reason: string }
}>
export const HostIndexScreen = Data.taggedEnum<HostIndexScreen>()

const localLayer = (options: LocalClientOptions) => {
  return Layer.merge(
    LocalCanvasClient.layer(options),
    LocalRepresentationClient.layer(options)
  ).pipe(Layer.provide(FetchHttpClient.layer))
}

const hostedHttpLayer = Layer.mergeAll(
  FetchHttpClient.layer,
  Layer.succeed(FetchHttpClient.RequestInit, { credentials: "include" })
)

const hostedLayer = () => Layer.mergeAll(
  HostedReviewClient.layer({ baseUrl: "" }),
  RemoteCanvasAuthority.layer(RemoteAuthorityOptions.make({ baseUrl: "" })),
  HttpArtifactStore.layer({ baseUrl: "" })
).pipe(Layer.provide(hostedHttpLayer))

const connectingScreen = HostScreen.connecting()
const connectingIndex = HostIndexScreen.connecting()
const connectionFailureReason = "Unable to connect to Crit."
const hostedOriginReason = "Hosted mode requires a non-loopback HTTPS origin."
const disconnectedReason = "This Crit host is not connected. Run crit dev."

const invalidCopy = (reason: string) =>
  reason === hostedOriginReason || reason === disconnectedReason
    ? reason
    : connectionFailureReason

const screenFromBoot = <E>(
  boot: AsyncResult.AsyncResult<CritHostProps, E>
): HostScreen => AsyncResult.match(boot, {
  onFailure: () => HostScreen.invalid({ reason: connectionFailureReason }),
  onInitial: () => connectingScreen,
  onSuccess: ({ value }) => HostScreen.ready({ props: value })
})

const localReasonFromCause = (cause: Cause.Cause<StatusFailure>): string =>
  Result.match(Cause.findError(cause), {
    onFailure: () => "The local daemon is unreachable.",
    onSuccess: (failure) => localTransportFailureReason(failure)
  })

const hostedReasonFromCause = (
  cause: Cause.Cause<HostedReviewFailure>
): string => Result.match(Cause.findError(cause), {
  onFailure: () => "The hosted service is unreachable.",
  onSuccess: (failure) => {
    if (failure instanceof HostedAccessDenied) {
      return "Crit Access denied this browser session."
    }
    if (isProtocolFailure(failure)) return formatProtocolFailure(failure)
    return failure.reason
  }
})

const localIndexFromList = (
  boot: AsyncResult.AsyncResult<ReadonlyArray<CanvasListing>, StatusFailure>
): HostIndexScreen => AsyncResult.match(boot, {
  onFailure: ({ cause }) => HostIndexScreen.failed({
    reason: localReasonFromCause(cause)
  }),
  onInitial: () => connectingIndex,
  onSuccess: ({ value }) => HostIndexScreen.ready({ listings: value })
})

const hostedIndexFromList = (
  boot: AsyncResult.AsyncResult<
    ReadonlyArray<CanvasListing>,
    HostedReviewFailure
  >
): HostIndexScreen => AsyncResult.match(boot, {
  onFailure: ({ cause }) => HostIndexScreen.failed({
    reason: hostedReasonFromCause(cause)
  }),
  onInitial: () => connectingIndex,
  onSuccess: ({ value }) => HostIndexScreen.ready({ listings: value })
})

const hostedScreenFromBoot = (
  boot: AsyncResult.AsyncResult<CritHostProps, HostedReviewFailure>
): HostScreen => AsyncResult.match(boot, {
  onFailure: ({ cause }) => HostScreen.invalid({
    reason: hostedReasonFromCause(cause)
  }),
  onInitial: () => connectingScreen,
  onSuccess: ({ value }) => HostScreen.ready({ props: value })
})

const localScreenAtom = (options: LocalClientOptions, canvasId: CanvasId) => {
  const runtime = Atom.runtime(localLayer(options))
  const boot = runtime.atom(Effect.gen(function*() {
    const client = yield* LocalCanvasClient
    const representations = yield* LocalRepresentationClient
    return {
      canvasId,
      ports: localReplicaSessionPorts(client),
      resolver: representations,
      snapshotter: representations
    }
  }))
  return Atom.map(boot, screenFromBoot)
}

const localIndexAtom = (options: LocalClientOptions) => {
  const runtime = Atom.runtime(localLayer(options))
  const boot = runtime.atom(Effect.gen(function*() {
    const client = yield* LocalCanvasClient
    return yield* client.list()
  }))
  return Atom.map(boot, localIndexFromList)
}

export const hostScreenAtom = Atom.family((runtime: HostRuntime) =>
  Atom.family((canvasId: CanvasId): Atom.Atom<HostScreen> =>
    Match.value(runtime).pipe(Match.tagsExhaustive({
      invalid: ({ reason }) => Atom.make((): HostScreen => HostScreen.invalid({
        reason: invalidCopy(reason)
      })),
      integrated: (integrated) => localScreenAtom(localClientOptionsFor(integrated), canvasId),
      standalone: (standalone) => localScreenAtom(localClientOptionsFor(standalone), canvasId),
      hosted: () => {
        const hosted = Atom.runtime(hostedLayer())
        const boot = hosted.atom(Effect.gen(function*() {
          const client = yield* HostedReviewClient
          const authority = yield* RemoteCanvasAuthority
          const principal = yield* hostedPersonPrincipal(client)
          const frames = yield* hostedFramePorts(client)
          return {
            canvasId,
            ports: hostedReplicaSessionPorts({
              authority,
              principal,
              attend: (id) => client.attend(id)
            }),
            resolver: frames.resolver,
            snapshotter: frames.snapshotter
          }
        }))
        return Atom.map(boot, hostedScreenFromBoot)
      }
    }))
  )
)

export const hostIndexAtom = Atom.family((runtime: HostRuntime): Atom.Atom<HostIndexScreen> =>
  Match.value(runtime).pipe(Match.tagsExhaustive({
    invalid: ({ reason }) => Atom.make((): HostIndexScreen => HostIndexScreen.invalid({
      reason: invalidCopy(reason)
    })),
    integrated: (integrated) => localIndexAtom(localClientOptionsFor(integrated)),
    standalone: (standalone) => localIndexAtom(localClientOptionsFor(standalone)),
    hosted: () => {
      const hosted = Atom.runtime(hostedLayer())
      const boot = hosted.atom(Effect.gen(function*() {
        const client = yield* HostedReviewClient
        return yield* client.directory()
      }))
      return Atom.map(boot, hostedIndexFromList)
    }
  }))
)
