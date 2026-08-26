import {
  LocalBrowserConnection,
  LocalCanvasClient,
  LocalRepresentationClient,
  type LocalBrowserConnectionDescriptor,
  type StatusFailure
} from "@crit/client"
import { type CanvasId } from "@crit/domain"
import type { CanvasListing } from "@crit/replica/http"
import { layerMemory, layerStorage, type ReplicaSessionRun } from "@crit/react"
import { Cause, Data, Effect, Layer, Result } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { KeyValueStore } from "effect/unstable/persistence"
import { Atom, AsyncResult } from "effect/unstable/reactivity"

import type { CritHostProps } from "./crit-host.js"
import { hostConnectionFromFragment } from "./host-connection.js"
import { localReplicaSessionPorts, localTransportFailureReason } from "./local-replica-session-ports.js"

export type HostScreen = Data.TaggedEnum<{
  readonly invalid: {}
  readonly connecting: {}
  readonly ready: { readonly props: CritHostProps }
}>
export const HostScreen = Data.taggedEnum<HostScreen>()

export type HostIndexScreen = Data.TaggedEnum<{
  readonly invalid: {}
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

const hostLayer = (descriptor: LocalBrowserConnectionDescriptor) => {
  const options = LocalBrowserConnection.options(descriptor)
  const clients = Layer.merge(
    LocalCanvasClient.layer(options),
    LocalRepresentationClient.layer(options)
  ).pipe(Layer.provide(FetchHttpClient.layer))
  return Layer.merge(clients, sessionStore())
}

const invalidScreen = HostScreen.invalid()
const connectingScreen = HostScreen.connecting()
const invalidIndex = HostIndexScreen.invalid()
const connectingIndex = HostIndexScreen.connecting()

const screenFromBoot = (boot: AsyncResult.AsyncResult<CritHostProps>): HostScreen =>
  AsyncResult.match(boot, {
    onFailure: () => invalidScreen,
    onInitial: () => connectingScreen,
    onSuccess: ({ value }) => HostScreen.ready({ props: value })
  })

const reasonFromCause = (cause: Cause.Cause<StatusFailure>): string =>
  Result.match(Cause.findError(cause), {
    onFailure: () => "The local daemon is unreachable.",
    onSuccess: (failure) => localTransportFailureReason(failure)
  })

const screenFromList = (
  boot: AsyncResult.AsyncResult<ReadonlyArray<CanvasListing>, StatusFailure>
): HostIndexScreen =>
  AsyncResult.match(boot, {
    onFailure: ({ cause }) => HostIndexScreen.failed({ reason: reasonFromCause(cause) }),
    onInitial: () => connectingIndex,
    onSuccess: ({ value }) => HostIndexScreen.ready({ listings: value })
  })

export const hostScreenAtom = Atom.family((fragment: string) =>
  Atom.family((canvasId: CanvasId): Atom.Atom<HostScreen> => {
    const connection = hostConnectionFromFragment(fragment)
    if (Result.isFailure(connection)) {
      return Atom.make((): HostScreen => invalidScreen)
    }
    const runtime = Atom.runtime(hostLayer(connection.success))
    const boot = runtime.atom(Effect.gen(function*() {
      const client = yield* LocalCanvasClient
      const representations = yield* LocalRepresentationClient
      const store = yield* KeyValueStore.KeyValueStore
      const run: ReplicaSessionRun = (effect) =>
        Effect.runPromise(Effect.provideService(effect, KeyValueStore.KeyValueStore, store))
      return {
        canvasId,
        ports: localReplicaSessionPorts(client),
        resolver: representations,
        snapshotter: representations,
        run
      }
    }))
    return Atom.map(boot, screenFromBoot)
  }))

export const hostIndexAtom = Atom.family((fragment: string): Atom.Atom<HostIndexScreen> => {
  const connection = hostConnectionFromFragment(fragment)
  if (Result.isFailure(connection)) {
    return Atom.make((): HostIndexScreen => invalidIndex)
  }
  const runtime = Atom.runtime(hostLayer(connection.success))
  const boot = runtime.atom(Effect.gen(function*() {
    const client = yield* LocalCanvasClient
    return yield* client.list()
  }))
  return Atom.map(boot, screenFromList)
})
