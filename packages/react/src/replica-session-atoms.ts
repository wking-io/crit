import type { CanvasCommandBatch, CanvasId } from "@crit/domain"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { Effect, Match, Result } from "effect"
import { Atom } from "effect/unstable/reactivity"
import type { AtomRegistry } from "effect/unstable/reactivity/AtomRegistry"

import { sessionStoreLayer } from "./browser-session.js"
import { CanvasCamera } from "./canvas-camera.js"
import { setCanvasCameraSession } from "./canvas-camera-session.js"
import { CanvasSelection } from "./canvas-selection.js"
import { setCanvasSelectionSession } from "./canvas-selection-session.js"
import {
  applyOpenedReplicaSession,
  applyRefreshReplicaSession,
  applySubmittedReplicaSession,
  defaultReplicaChrome,
  liveReplicaConnection,
  loadingReplicaSession,
  openedReplicaSession,
  patchReadyReplicaSession,
  ReplicaConnection,
  ReplicaSession,
  ReplicaSessionUnavailable,
  type ReplicaChrome,
  type ReplicaSessionHandle,
  type ReplicaSessionPorts
} from "./replica-session.js"

const replicaIdleTtl = 0

const writeSession = (
  registry: AtomRegistry,
  state: Atom.Writable<ReplicaSession>,
  next: ReplicaSession
) => {
  registry.set(state, next)
}

const refreshReplicaView = (
  registry: AtomRegistry,
  state: Atom.Writable<ReplicaSession>,
  canvasId: CanvasId,
  ports: ReplicaSessionPorts
) =>
  Effect.gen(function*() {
    const opened = yield* Effect.result(ports.open(canvasId))
    writeSession(
      registry,
      state,
      applyRefreshReplicaSession(registry.get(state), opened)
    )
  })

const subscribeReplica = (
  registry: AtomRegistry,
  state: Atom.Writable<ReplicaSession>,
  canvasId: CanvasId,
  ports: ReplicaSessionPorts,
  refresh: Atom.Writable<unknown, void>
) => {
  let refreshOnConnect = false
  return ports.subscribe(canvasId, (event) => {
    Match.value(event).pipe(Match.tagsExhaustive({
      changed: () => {
        registry.set(refresh, undefined)
      },
      connected: () => {
        writeSession(
          registry,
          state,
          patchReadyReplicaSession(registry.get(state), {
            connection: liveReplicaConnection
          })
        )
        if (refreshOnConnect) registry.set(refresh, undefined)
      },
      lost: ({ reason }) => {
        refreshOnConnect = true
        writeSession(
          registry,
          state,
          patchReadyReplicaSession(registry.get(state), {
            connection: ReplicaConnection.lost({ reason })
          })
        )
      }
    }))
  })
}

export const replicaSessionAtoms = Atom.family((canvasId: CanvasId) =>
  Atom.family((ports: ReplicaSessionPorts) => {
    const runtime = Atom.runtime(sessionStoreLayer())
    const state = Atom.make<ReplicaSession>(loadingReplicaSession)
    const chrome = Atom.make<ReplicaChrome>(defaultReplicaChrome)
    const refresh = runtime.fn((_: void, get) =>
      refreshReplicaView(get.registry, state, canvasId, ports)
    ).pipe(Atom.setIdleTTL(replicaIdleTtl))
    const lifecycle = runtime.atom((get) =>
      Effect.gen(function*() {
        yield* Effect.acquireRelease(
          Effect.sync(() =>
            subscribeReplica(get.registry, state, canvasId, ports, refresh)
          ),
          (close) => Effect.sync(close)
        )
        const opened = yield* openedReplicaSession({ canvasId, ports })
        get.registry.set(chrome, {
          camera: opened.camera,
          selection: opened.selection
        })
        writeSession(
          get.registry,
          state,
          applyOpenedReplicaSession(get.registry.get(state), opened.opened)
        )
        yield* Effect.never
      })
    ).pipe(Atom.setIdleTTL(replicaIdleTtl))
    const session = Atom.writable(
      (get) => {
        get(lifecycle)
        get.mount(refresh)
        return get(state)
      },
      (ctx, next: ReplicaSession) => ctx.set(state, next)
    ).pipe(Atom.setIdleTTL(replicaIdleTtl))
    const setCamera = runtime.fn((camera: CanvasCamera, get) =>
      Effect.gen(function*() {
        const current = get.registry.get(state)
        if (!ReplicaSession.$is("ready")(current)) return
        yield* Effect.ignore(setCanvasCameraSession({ camera, canvasId }))
      })
    ).pipe(Atom.setIdleTTL(replicaIdleTtl))
    const setSelection = runtime.fn((selection: CanvasSelection, get) =>
      Effect.gen(function*() {
        const current = get.registry.get(state)
        if (!ReplicaSession.$is("ready")(current)) return
        yield* Effect.ignore(setCanvasSelectionSession({ canvasId, selection }))
      })
    ).pipe(Atom.setIdleTTL(replicaIdleTtl))
    const submit = runtime.fn((commands: CanvasCommandBatch, get) =>
      Effect.gen(function*() {
        const current = get.registry.get(state)
        if (!ReplicaSession.$is("ready")(current)) {
          return Result.fail(new ReplicaSessionUnavailable({
            canvasId,
            reason: "The replica is not ready."
          }))
        }
        const changed = yield* Effect.result(ports.change({ canvasId, commands }))
        writeSession(
          get.registry,
          state,
          applySubmittedReplicaSession(get.registry.get(state), changed)
        )
        return changed
      })
    ).pipe(Atom.setIdleTTL(replicaIdleTtl))
    return { chrome, session, setCamera, setSelection, submit }
  })
)

export const useReplicaSession = (args: {
  readonly canvasId: CanvasId
  readonly ports: ReplicaSessionPorts
}): ReplicaSessionHandle => {
  const atoms = replicaSessionAtoms(args.canvasId)(args.ports)
  const session = useAtomValue(atoms.session)
  const chrome = useAtomValue(atoms.chrome)
  const onCameraChange = useAtomSet(atoms.setCamera)
  const onSelectionChange = useAtomSet(atoms.setSelection)
  const submit = useAtomSet(atoms.submit, { mode: "promise" })
  return { session, chrome, onCameraChange, onSelectionChange, submit }
}
