import {
  LocalBrowserConnection,
  LocalCanvasClient,
  LocalRepresentationClient,
  type LocalBrowserConnectionDescriptor
} from "@crit/client"
import { CanvasTitle, Id } from "@crit/domain"
import { layerMemory, layerStorage, type ReplicaSessionRun } from "@crit/react"
import { Effect, Layer, Result, Schema } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { KeyValueStore } from "effect/unstable/persistence"
import { Atom, AsyncResult } from "effect/unstable/reactivity"

import type { CritHostProps } from "./crit-host.js"
import { ensureLocalCanvas } from "./ensure-local-canvas.js"
import { hostConnectionFromFragment } from "./host-connection.js"
import { localReplicaSessionPorts } from "./local-replica-session-ports.js"

export const localCanvasId = Id.canvas("canvas_local")
const localCanvasTitle = Schema.decodeUnknownSync(CanvasTitle)("Untitled")

export type HostScreen =
  | { readonly _tag: "invalid" }
  | { readonly _tag: "connecting" }
  | { readonly _tag: "ready"; readonly props: CritHostProps }

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

const invalidScreen: HostScreen = { _tag: "invalid" }
const connectingScreen: HostScreen = { _tag: "connecting" }

export const hostScreenAtom = Atom.family((fragment: string): Atom.Atom<HostScreen> => {
  const connection = hostConnectionFromFragment(fragment)
  if (Result.isFailure(connection)) {
    return Atom.keepAlive(Atom.make((): HostScreen => invalidScreen))
  }
  const runtime = Atom.runtime(hostLayer(connection.success))
  const boot = runtime.atom(Effect.gen(function*() {
    const client = yield* LocalCanvasClient
    const resolver = yield* LocalRepresentationClient
    const store = yield* KeyValueStore.KeyValueStore
    yield* Effect.ignore(ensureLocalCanvas({
      canvasId: localCanvasId,
      client,
      title: localCanvasTitle
    }))
    const run: ReplicaSessionRun = (effect) =>
      Effect.runPromise(Effect.provideService(effect, KeyValueStore.KeyValueStore, store))
    return {
      canvasId: localCanvasId,
      ports: localReplicaSessionPorts(client),
      resolver,
      run
    }
  }))
  return Atom.keepAlive(Atom.make((get): HostScreen => {
    const bootResult = get(boot)
    if (AsyncResult.isFailure(bootResult)) return invalidScreen
    if (!AsyncResult.isSuccess(bootResult)) return connectingScreen
    return { _tag: "ready", props: bootResult.value }
  }))
})
