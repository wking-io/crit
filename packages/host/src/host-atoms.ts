import {
  HostedAccessDenied,
  HostedReviewClient,
  HttpArtifactStore,
  LocalBrowserConnection,
  LocalCanvasClient,
  LocalRepresentationClient,
  RemoteAuthorityOptions,
  RemoteCanvasAuthority,
  type HostedReviewFailure,
  type LocalBrowserConnectionDescriptor,
  type StatusFailure
} from "@crit/client"
import { type CanvasId } from "@crit/domain"
import { formatProtocolFailure, isProtocolFailure } from "@crit/protocol"
import type { CanvasListing } from "@crit/replica/http"
import { layerMemory, layerStorage, type ReplicaSessionRun } from "@crit/react"
import { Cause, Data, Effect, Layer, Match, Result } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { KeyValueStore } from "effect/unstable/persistence"
import { Atom, AsyncResult } from "effect/unstable/reactivity"

import type { CritHostProps } from "./crit-host.js"
import { hostedFramePorts } from "./hosted-frame-ports.js"
import { hostedPersonPrincipal } from "./hosted-identity.js"
import { hostedReplicaSessionPorts } from "./hosted-replica-session-ports.js"
import { parseHostConnection } from "./host-connection.js"
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

const sessionStore = () => {
  try {
    const storage = globalThis.document?.defaultView?.sessionStorage
    return storage === undefined ? layerMemory : layerStorage(() => storage)
  } catch {
    return layerMemory
  }
}

const localLayer = (descriptor: LocalBrowserConnectionDescriptor) => {
  const options = LocalBrowserConnection.options(descriptor)
  const clients = Layer.merge(
    LocalCanvasClient.layer(options),
    LocalRepresentationClient.layer(options)
  ).pipe(Layer.provide(FetchHttpClient.layer))
  return Layer.merge(clients, sessionStore())
}

const hostedHttpLayer = Layer.mergeAll(
  FetchHttpClient.layer,
  Layer.succeed(FetchHttpClient.RequestInit, { credentials: "include" })
)

const hostedLayer = () => Layer.mergeAll(
  HostedReviewClient.layer({ baseUrl: "" }),
  RemoteCanvasAuthority.layer(RemoteAuthorityOptions.make({ baseUrl: "" })),
  HttpArtifactStore.layer({ baseUrl: "" }),
  sessionStore()
).pipe(Layer.provide(hostedHttpLayer))

const connectingScreen = HostScreen.connecting()
const connectingIndex = HostIndexScreen.connecting()
const connectionFailureReason = "Unable to connect to Crit."
const hostedOriginReason = "Hosted mode requires a non-loopback HTTPS origin."

const invalidCopy = (reason: string) =>
  reason === hostedOriginReason ? reason : connectionFailureReason

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

export const hostScreenAtom = Atom.family((fragment: string) =>
  Atom.family((origin: string) =>
    Atom.family((canvasId: CanvasId): Atom.Atom<HostScreen> => {
      const connection = parseHostConnection({ fragment, origin })
      return Match.value(connection).pipe(Match.tagsExhaustive({
        invalid: ({ reason }) => Atom.make((): HostScreen => HostScreen.invalid({
          reason: invalidCopy(reason)
        })),
        local: ({ descriptor }) => {
          const runtime = Atom.runtime(localLayer(descriptor))
          const boot = runtime.atom(Effect.gen(function*() {
            const client = yield* LocalCanvasClient
            const representations = yield* LocalRepresentationClient
            const store = yield* KeyValueStore.KeyValueStore
            const run: ReplicaSessionRun = (effect) =>
              Effect.runPromise(Effect.provideService(
                effect,
                KeyValueStore.KeyValueStore,
                store
              ))
            return {
              canvasId,
              ports: localReplicaSessionPorts(client),
              resolver: representations,
              snapshotter: representations,
              run
            }
          }))
          return Atom.map(boot, screenFromBoot)
        },
        hosted: () => {
          const runtime = Atom.runtime(hostedLayer())
          const boot = runtime.atom(Effect.gen(function*() {
            const client = yield* HostedReviewClient
            const authority = yield* RemoteCanvasAuthority
            const principal = yield* hostedPersonPrincipal(client)
            const frames = yield* hostedFramePorts(client)
            const store = yield* KeyValueStore.KeyValueStore
            const run: ReplicaSessionRun = (effect) =>
              Effect.runPromise(Effect.provideService(
                effect,
                KeyValueStore.KeyValueStore,
                store
              ))
            return {
              canvasId,
              ports: hostedReplicaSessionPorts({
                authority,
                principal,
                attend: (id) => client.attend(id)
              }),
              resolver: frames.resolver,
              snapshotter: frames.snapshotter,
              run
            }
          }))
          return Atom.map(boot, hostedScreenFromBoot)
        }
      }))
    })
  )
)

export const hostIndexAtom = Atom.family((fragment: string) =>
  Atom.family((origin: string): Atom.Atom<HostIndexScreen> => {
    const connection = parseHostConnection({ fragment, origin })
    return Match.value(connection).pipe(Match.tagsExhaustive({
      invalid: ({ reason }) => Atom.make((): HostIndexScreen => HostIndexScreen.invalid({
        reason: invalidCopy(reason)
      })),
      local: ({ descriptor }) => {
        const runtime = Atom.runtime(localLayer(descriptor))
        const boot = runtime.atom(Effect.gen(function*() {
          const client = yield* LocalCanvasClient
          return yield* client.list()
        }))
        return Atom.map(boot, localIndexFromList)
      },
      hosted: () => {
        const runtime = Atom.runtime(hostedLayer())
        const boot = runtime.atom(Effect.gen(function*() {
          const client = yield* HostedReviewClient
          return yield* client.directory()
        }))
        return Atom.map(boot, hostedIndexFromList)
      }
    }))
  })
)
