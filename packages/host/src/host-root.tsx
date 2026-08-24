import {
  LocalBrowserConnection,
  LocalCanvasClient,
  LocalRepresentationClient,
  type LocalBrowserConnectionDescriptor
} from "@crit/client"
import { CanvasTitle, Id } from "@crit/domain"
import { layerMemory, layerStorage, type ReplicaSessionRun } from "@crit/react"
import { Context, Effect, Layer, Result, Schema } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { useEffect, useMemo, useState, type ReactElement } from "react"

import { CritHost } from "./crit-host.js"
import { ensureLocalCanvas } from "./ensure-local-canvas.js"
import { hostConnectionFromFragment } from "./host-connection.js"
import { localReplicaSessionPorts } from "./local-replica-session-ports.js"

export const localCanvasId = Id.canvas("canvas_local")
const localCanvasTitle = Schema.decodeUnknownSync(CanvasTitle)("Untitled")

const sessionStore = () => {
  try {
    const storage = globalThis.document?.defaultView?.sessionStorage
    return storage === undefined ? layerMemory : layerStorage(() => storage)
  } catch {
    return layerMemory
  }
}

const hostServices = (descriptor: LocalBrowserConnectionDescriptor) => {
  const options = LocalBrowserConnection.options(descriptor)
  const clients = Effect.runSync(Effect.scoped(Layer.build(
    Layer.merge(
      LocalCanvasClient.layer(options),
      LocalRepresentationClient.layer(options)
    ).pipe(Layer.provide(FetchHttpClient.layer))
  )))
  const client = Context.get(clients, LocalCanvasClient)
  const stores = Effect.runSync(Effect.scoped(Layer.build(sessionStore())))
  const run: ReplicaSessionRun = (effect) => Effect.runPromise(Effect.provide(effect, stores))
  return {
    ports: localReplicaSessionPorts(client),
    prepare: () => Effect.runPromise(Effect.result(ensureLocalCanvas({
      canvasId: localCanvasId,
      client,
      title: localCanvasTitle
    }))),
    resolver: Context.get(clients, LocalRepresentationClient),
    run
  }
}

function ConnectedHost({ descriptor }: {
  readonly descriptor: LocalBrowserConnectionDescriptor
}): ReactElement {
  const services = useMemo(() => hostServices(descriptor), [descriptor])
  const [prepared, setPrepared] = useState(false)

  useEffect(() => {
    let active = true
    void services.prepare().then(() => {
      if (active) setPrepared(true)
    })
    return () => {
      active = false
    }
  }, [services])

  if (!prepared) return <p role="status">Connecting to Crit…</p>
  return (
    <CritHost
      canvasId={localCanvasId}
      ports={services.ports}
      resolver={services.resolver}
      run={services.run}
    />
  )
}

export function HostRoot({ fragment }: { readonly fragment: string }): ReactElement {
  const connection = useMemo(() => hostConnectionFromFragment(fragment), [fragment])
  return Result.isFailure(connection)
    ? <p role="alert">Unable to connect to Crit.</p>
    : <ConnectedHost descriptor={connection.success} />
}
