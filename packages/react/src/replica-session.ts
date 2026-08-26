import type { CanvasChangeFailure, CanvasCommandBatch, CanvasId } from "@crit/domain"
import type { ReplicaView } from "@crit/replica"
import { Data, Effect, Match, Result } from "effect"
import type { KeyValueStore } from "effect/unstable/persistence"
import { useCallback, useEffect, useRef, useState } from "react"

import { CanvasCamera } from "./canvas-camera.js"
import {
  getCanvasCameraSession,
  setCanvasCameraSession
} from "./canvas-camera-session.js"
import { CanvasSelection } from "./canvas-selection.js"
import {
  getCanvasSelectionSession,
  setCanvasSelectionSession
} from "./canvas-selection-session.js"

export class ReplicaSessionUnavailable extends Data.TaggedError("ReplicaSessionUnavailable")<{
  readonly canvasId: CanvasId
  readonly reason: string
}> {}

export class ReplicaChangeRejected extends Data.TaggedError("ReplicaChangeRejected")<{
  readonly canvasId: CanvasId
  readonly failure: CanvasChangeFailure
}> {}

export type ReplicaConnection = Data.TaggedEnum<{
  readonly live: {}
  readonly lost: { readonly reason: string }
}>
export const ReplicaConnection = Data.taggedEnum<ReplicaConnection>()

export type ReplicaSubscriptionEvent = Data.TaggedEnum<{
  readonly changed: {}
  readonly connected: {}
  readonly lost: { readonly reason: string }
}>
export const ReplicaSubscriptionEvent = Data.taggedEnum<ReplicaSubscriptionEvent>()

export interface ReplicaSessionPorts {
  readonly open: (canvasId: CanvasId) => Effect.Effect<ReplicaView, ReplicaSessionUnavailable>
  readonly subscribe: (
    canvasId: CanvasId,
    onEvent: (event: ReplicaSubscriptionEvent) => void
  ) => () => void
  readonly change: (input: {
    readonly canvasId: CanvasId
    readonly commands: CanvasCommandBatch
  }) => Effect.Effect<ReplicaView, ReplicaSessionUnavailable | ReplicaChangeRejected>
}

export type ReplicaSession = Data.TaggedEnum<{
  readonly loading: {}
  readonly unavailable: { readonly reason: string }
  readonly ready: {
    readonly view: ReplicaView
    readonly camera: CanvasCamera
    readonly selection: CanvasSelection
    readonly connection: ReplicaConnection
    readonly notice: ReplicaChangeRejected | ReplicaSessionUnavailable | undefined
  }
}>
export const ReplicaSession = Data.taggedEnum<ReplicaSession>()

export type ReplicaSessionRun = <A, E>(
  effect: Effect.Effect<A, E, KeyValueStore.KeyValueStore>
) => Promise<A>

export interface ReplicaSessionHandle {
  readonly session: ReplicaSession
  readonly onCameraChange: (camera: CanvasCamera) => void
  readonly onSelectionChange: (selection: CanvasSelection) => void
  readonly submit: (
    commands: CanvasCommandBatch
  ) => Promise<Result.Result<ReplicaView, ReplicaSessionUnavailable | ReplicaChangeRejected>>
}

const loading = ReplicaSession.loading()

const defaultCamera = CanvasCamera.make({ x: 0, y: 0, zoom: 1 })
const defaultSelection = CanvasSelection.make([])
const liveConnection = ReplicaConnection.live()

const patchReady = (
  previous: ReplicaSession,
  patch: {
    readonly view?: ReplicaView
    readonly camera?: CanvasCamera
    readonly selection?: CanvasSelection
    readonly connection?: ReplicaConnection
    readonly notice?: ReplicaChangeRejected | ReplicaSessionUnavailable | undefined
  }
): ReplicaSession => {
  if (previous._tag !== "ready") return previous
  return ReplicaSession.ready({
    view: patch.view ?? previous.view,
    camera: patch.camera ?? previous.camera,
    selection: patch.selection ?? previous.selection,
    connection: patch.connection ?? previous.connection,
    notice: Object.hasOwn(patch, "notice") ? patch.notice : previous.notice
  })
}

const applyOpened = (
  previous: ReplicaSession,
  opened: Result.Result<ReplicaView, ReplicaSessionUnavailable>,
  chrome: {
    readonly camera: CanvasCamera
    readonly selection: CanvasSelection
  }
): ReplicaSession => {
  if (Result.isFailure(opened)) {
    return previous._tag === "ready"
      ? previous
      : ReplicaSession.unavailable({ reason: opened.failure.reason })
  }
  return ReplicaSession.ready({
    view: opened.success,
    camera: chrome.camera,
    selection: chrome.selection,
    connection: previous._tag === "ready" ? previous.connection : liveConnection,
    notice: previous._tag === "ready" ? previous.notice : undefined
  })
}

const applyRefresh = (
  previous: ReplicaSession,
  opened: Result.Result<ReplicaView, ReplicaSessionUnavailable>
): ReplicaSession => {
  if (Result.isFailure(opened)) {
    return previous._tag === "ready"
      ? previous
      : ReplicaSession.unavailable({ reason: opened.failure.reason })
  }
  return previous._tag === "ready"
    ? patchReady(previous, { view: opened.success })
    : ReplicaSession.ready({
      view: opened.success,
      camera: defaultCamera,
      selection: defaultSelection,
      connection: liveConnection,
      notice: undefined
    })
}

const applySubmitted = (
  previous: ReplicaSession,
  result: Result.Result<ReplicaView, ReplicaChangeRejected | ReplicaSessionUnavailable>
): ReplicaSession => {
  if (Result.isFailure(result)) {
    return patchReady(previous, { notice: result.failure })
  }
  return previous._tag === "ready"
    ? patchReady(previous, { view: result.success, notice: undefined })
    : ReplicaSession.ready({
      view: result.success,
      camera: defaultCamera,
      selection: defaultSelection,
      connection: liveConnection,
      notice: undefined
    })
}

const openedSession = (args: {
  readonly canvasId: CanvasId
  readonly ports: ReplicaSessionPorts
}): Effect.Effect<{
  readonly opened: Result.Result<ReplicaView, ReplicaSessionUnavailable>
  readonly camera: CanvasCamera
  readonly selection: CanvasSelection
}, never, KeyValueStore.KeyValueStore> =>
  Effect.gen(function*() {
    const opened = yield* Effect.result(args.ports.open(args.canvasId))
    if (Result.isFailure(opened)) {
      return { opened, camera: defaultCamera, selection: defaultSelection }
    }
    const savedCamera = yield* getCanvasCameraSession({ canvasId: args.canvasId })
    const savedSelection = yield* getCanvasSelectionSession({
      canvasId: args.canvasId
    })
    return {
      opened,
      camera: savedCamera ?? defaultCamera,
      selection: savedSelection ?? defaultSelection
    }
  })

export const useReplicaSession = (args: {
  readonly canvasId: CanvasId
  readonly ports: ReplicaSessionPorts
  readonly run: ReplicaSessionRun
}): ReplicaSessionHandle => {
  const { canvasId, ports, run } = args
  const [session, setSession] = useState<ReplicaSession>(loading)
  const generationRef = useRef(0)

  useEffect(() => {
    const generation = generationRef.current + 1
    generationRef.current = generation
    const isCurrent = () => generationRef.current === generation
    setSession(loading)
    let refreshOnConnect = false
    const refresh = () => {
      void run(Effect.result(ports.open(canvasId))).then((opened) => {
        if (isCurrent()) setSession((previous) => applyRefresh(previous, opened))
      })
    }
    const unsubscribe = ports.subscribe(canvasId, (event) => {
      if (!isCurrent()) return
      Match.value(event).pipe(Match.tagsExhaustive({
        changed: () => {
          refresh()
        },
        connected: () => {
          setSession((previous) => patchReady(previous, { connection: liveConnection }))
          if (refreshOnConnect) refresh()
        },
        lost: ({ reason }) => {
          refreshOnConnect = true
          setSession((previous) => patchReady(previous, {
            connection: ReplicaConnection.lost({ reason })
          }))
        }
      }))
    })
    void run(openedSession({ canvasId, ports })).then((opened) => {
      if (isCurrent()) {
        setSession((previous) => applyOpened(previous, opened.opened, opened))
      }
    })
    return () => {
      generationRef.current = generation + 1
      unsubscribe()
    }
  }, [canvasId, ports, run])

  const onCameraChange = useCallback((camera: CanvasCamera) => {
    if (session._tag !== "ready") return
    setSession((previous) => patchReady(previous, { camera }))
    void run(Effect.ignore(setCanvasCameraSession({ camera, canvasId })))
  }, [canvasId, run, session])

  const onSelectionChange = useCallback((selection: CanvasSelection) => {
    if (session._tag !== "ready") return
    setSession((previous) => patchReady(previous, { selection }))
    void run(Effect.ignore(setCanvasSelectionSession({ canvasId, selection })))
  }, [canvasId, run, session])

  const submit = useCallback((commands: CanvasCommandBatch) => {
    if (session._tag !== "ready") {
      return Promise.resolve(Result.fail(new ReplicaSessionUnavailable({
        canvasId,
        reason: "The replica is not ready."
      })))
    }
    const generation = generationRef.current
    return run(Effect.result(ports.change({ canvasId, commands }))).then((changed) => {
      if (generationRef.current === generation) {
        setSession((previous) => applySubmitted(previous, changed))
      }
      return changed
    })
  }, [canvasId, ports, run, session])

  return { session, onCameraChange, onSelectionChange, submit }
}
