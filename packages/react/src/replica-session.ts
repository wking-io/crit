import type { CanvasId } from "@crit/domain"
import type { ReplicaView } from "@crit/replica"
import { Data, Effect, Result } from "effect"
import type { KeyValueStore } from "effect/unstable/persistence"
import { useCallback, useEffect, useState } from "react"

import { CanvasCamera } from "./canvas-camera.js"
import {
  getCanvasCameraSession,
  setCanvasCameraSession
} from "./canvas-camera-session.js"

export class ReplicaSessionUnavailable extends Data.TaggedError("ReplicaSessionUnavailable")<{
  readonly canvasId: CanvasId
  readonly reason: string
}> {}

export interface ReplicaSessionPorts {
  readonly open: (canvasId: CanvasId) => Effect.Effect<ReplicaView, ReplicaSessionUnavailable>
  readonly subscribe: (canvasId: CanvasId, onChanged: () => void) => () => void
}

export type ReplicaSession =
  | { readonly _tag: "loading" }
  | { readonly _tag: "unavailable"; readonly reason: string }
  | { readonly _tag: "ready"; readonly view: ReplicaView; readonly camera: CanvasCamera }

export type ReplicaSessionRun = <A, E>(
  effect: Effect.Effect<A, E, KeyValueStore.KeyValueStore>
) => Promise<A>

export interface ReplicaSessionHandle {
  readonly session: ReplicaSession
  readonly onCameraChange: (camera: CanvasCamera) => void
}

const loading: ReplicaSession = { _tag: "loading" }

const unavailable = (reason: string): ReplicaSession => ({ _tag: "unavailable", reason })

const ready = (view: ReplicaView, camera: CanvasCamera): ReplicaSession => ({
  _tag: "ready",
  view,
  camera
})

const defaultCamera = CanvasCamera.make({ x: 0, y: 0, zoom: 1 })

const openedSession = (args: {
  readonly canvasId: CanvasId
  readonly ports: ReplicaSessionPorts
}): Effect.Effect<ReplicaSession, never, KeyValueStore.KeyValueStore> =>
  Effect.gen(function*() {
    const opened = yield* Effect.result(args.ports.open(args.canvasId))
    if (Result.isFailure(opened)) return unavailable(opened.failure.reason)
    const saved = yield* getCanvasCameraSession({ canvasId: args.canvasId })
    return ready(opened.success, saved ?? defaultCamera)
  })

const refreshed = (
  previous: ReplicaSession,
  opened: Result.Result<ReplicaView, ReplicaSessionUnavailable>
): ReplicaSession => {
  if (Result.isFailure(opened)) {
    return previous._tag === "ready" ? previous : unavailable(opened.failure.reason)
  }
  if (previous._tag === "ready") return ready(opened.success, previous.camera)
  return ready(opened.success, defaultCamera)
}

export const useReplicaSession = (args: {
  readonly canvasId: CanvasId
  readonly ports: ReplicaSessionPorts
  readonly run: ReplicaSessionRun
}): ReplicaSessionHandle => {
  const { canvasId, ports, run } = args
  const [session, setSession] = useState<ReplicaSession>(loading)

  useEffect(() => {
    let active = true
    setSession(loading)
    const unsubscribe = ports.subscribe(canvasId, () => {
      void run(Effect.result(ports.open(canvasId))).then((opened) => {
        if (active) setSession((previous) => refreshed(previous, opened))
      })
    })
    void run(openedSession({ canvasId, ports })).then((next) => {
      if (active) setSession(next)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [canvasId, ports, run])

  const onCameraChange = useCallback((camera: CanvasCamera) => {
    if (session._tag !== "ready") return
    setSession(ready(session.view, camera))
    void run(Effect.ignore(setCanvasCameraSession({ camera, canvasId })))
  }, [canvasId, run, session])

  return { session, onCameraChange }
}
