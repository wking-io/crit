import {
  LocalBrowserConnection,
  LocalCanvasClient,
  LocalRepresentationClient,
  type LocalBrowserConnectionDescriptor
} from "@crit/client"
import { CanvasTitle, type CanvasId } from "@crit/domain"
import { layerMemory, layerStorage, type ReplicaSessionRun } from "@crit/react"
import { Data, Effect, Layer, Result, Schema } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { KeyValueStore } from "effect/unstable/persistence"
import { Atom, AsyncResult } from "effect/unstable/reactivity"

import type { CritHostProps } from "./crit-host.js"
import { ensureLocalCanvas } from "./ensure-local-canvas.js"
import { localCanvasId } from "./host-canvas-id.js"
import { hostConnectionFromFragment } from "./host-connection.js"
import { localReplicaSessionPorts } from "./local-replica-session-ports.js"

export { localCanvasId }

const localCanvasTitle = Schema.decodeUnknownSync(CanvasTitle)("Untitled")

export type HostScreen = Data.TaggedEnum<{
  readonly invalid: {}
  readonly connecting: {}
  readonly ready: { readonly props: CritHostProps }
}>
export const HostScreen = Data.taggedEnum<HostScreen>()

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

const screenFromBoot = (boot: AsyncResult.AsyncResult<CritHostProps>): HostScreen =>
  AsyncResult.match(boot, {
    onFailure: () => invalidScreen,
    onInitial: () => connectingScreen,
    onSuccess: ({ value }) => HostScreen.ready({ props: value })
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
      if (canvasId === localCanvasId) {
        yield* Effect.ignore(ensureLocalCanvas({
          canvasId,
          client,
          title: localCanvasTitle
        }))
      }
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
