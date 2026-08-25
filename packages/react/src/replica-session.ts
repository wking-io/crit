import type { CanvasChangeFailure, CanvasCommandBatch, CanvasId } from "@crit/domain"
import type { ReplicaView } from "@crit/replica"
import { Data, Effect, Match, Result } from "effect"
import type { KeyValueStore } from "effect/unstable/persistence"
import { useCallback, useEffect, useState } from "react"

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

type ReplicaSessionAction = Data.TaggedEnum<{
  readonly reset: {}
  readonly openFailed: { readonly reason: string }
  readonly opened: {
    readonly view: ReplicaView
    readonly camera: CanvasCamera
    readonly selection: CanvasSelection
  }
  readonly refreshed: {
    readonly opened: Result.Result<ReplicaView, ReplicaSessionUnavailable>
  }
  readonly subscription: { readonly event: ReplicaSubscriptionEvent }
  readonly cameraChanged: { readonly camera: CanvasCamera }
  readonly selectionChanged: { readonly selection: CanvasSelection }
  readonly submitted: { readonly view: ReplicaView }
}>
const ReplicaSessionAction = Data.taggedEnum<ReplicaSessionAction>()

const ready = (args: {
  readonly view: ReplicaView
  readonly camera: CanvasCamera
  readonly selection: CanvasSelection
  readonly connection: ReplicaConnection
}): ReplicaSession => ReplicaSession.ready(args)

const reduceSession = (
  previous: ReplicaSession,
  action: ReplicaSessionAction
): ReplicaSession => Match.value(action).pipe(Match.tagsExhaustive({
  reset: () => loading,
  openFailed: ({ reason }) =>
    previous._tag === "ready" ? previous : ReplicaSession.unavailable({ reason }),
  opened: ({ camera, selection, view }) => ready({
    view,
    camera,
    selection,
    connection: previous._tag === "ready" ? previous.connection : liveConnection
  }),
  refreshed: ({ opened }) => {
    if (Result.isFailure(opened)) {
      return previous._tag === "ready"
        ? previous
        : ReplicaSession.unavailable({ reason: opened.failure.reason })
    }
    return previous._tag === "ready"
      ? ready({
        view: opened.success,
        camera: previous.camera,
        selection: previous.selection,
        connection: previous.connection
      })
      : ready({
        view: opened.success,
        camera: defaultCamera,
        selection: defaultSelection,
        connection: liveConnection
      })
  },
  subscription: ({ event }) => Match.value(event).pipe(Match.tagsExhaustive({
    changed: () => previous,
    connected: () => previous._tag === "ready"
      ? ready({
        view: previous.view,
        camera: previous.camera,
        selection: previous.selection,
        connection: liveConnection
      })
      : previous,
    lost: ({ reason }) => previous._tag === "ready"
      ? ready({
        view: previous.view,
        camera: previous.camera,
        selection: previous.selection,
        connection: ReplicaConnection.lost({ reason })
      })
      : previous
  })),
  cameraChanged: ({ camera }) => previous._tag === "ready"
    ? ready({
      view: previous.view,
      camera,
      selection: previous.selection,
      connection: previous.connection
    })
    : previous,
  selectionChanged: ({ selection }) => previous._tag === "ready"
    ? ready({
      view: previous.view,
      camera: previous.camera,
      selection,
      connection: previous.connection
    })
    : previous,
  submitted: ({ view }) => previous._tag === "ready"
    ? ready({
      view,
      camera: previous.camera,
      selection: previous.selection,
      connection: previous.connection
    })
    : ready({
      view,
      camera: defaultCamera,
      selection: defaultSelection,
      connection: liveConnection
    })
}))

const openedSessionAction = (args: {
  readonly canvasId: CanvasId
  readonly ports: ReplicaSessionPorts
}): Effect.Effect<ReplicaSessionAction, never, KeyValueStore.KeyValueStore> =>
  Effect.gen(function*() {
    const opened = yield* Effect.result(args.ports.open(args.canvasId))
    if (Result.isFailure(opened)) {
      return ReplicaSessionAction.openFailed({ reason: opened.failure.reason })
    }
    const savedCamera = yield* getCanvasCameraSession({ canvasId: args.canvasId })
    const savedSelection = yield* getCanvasSelectionSession({
      canvasId: args.canvasId
    })
    return ReplicaSessionAction.opened({
      view: opened.success,
      camera: savedCamera ?? defaultCamera,
      selection: savedSelection ?? defaultSelection
    })
  })

export const useReplicaSession = (args: {
  readonly canvasId: CanvasId
  readonly ports: ReplicaSessionPorts
  readonly run: ReplicaSessionRun
}): ReplicaSessionHandle => {
  const { canvasId, ports, run } = args
  const [session, setSession] = useState<ReplicaSession>(loading)

  useEffect(() => {
    let active = true
    setSession((previous) => reduceSession(previous, ReplicaSessionAction.reset()))
    const refresh = () => {
      void run(Effect.result(ports.open(canvasId))).then((opened) => {
        if (active) {
          setSession((previous) => reduceSession(
            previous,
            ReplicaSessionAction.refreshed({ opened })
          ))
        }
      })
    }
    const unsubscribe = ports.subscribe(canvasId, (event) => {
      setSession((previous) => reduceSession(
        previous,
        ReplicaSessionAction.subscription({ event })
      ))
      const shouldRefresh = Match.value(event).pipe(Match.tagsExhaustive({
        changed: () => true,
        connected: () => true,
        lost: () => false
      }))
      if (shouldRefresh) refresh()
    })
    void run(openedSessionAction({ canvasId, ports })).then((action) => {
      if (active) setSession((previous) => reduceSession(previous, action))
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [canvasId, ports, run])

  const onCameraChange = useCallback((camera: CanvasCamera) => {
    if (session._tag !== "ready") return
    setSession((previous) => reduceSession(
      previous,
      ReplicaSessionAction.cameraChanged({ camera })
    ))
    void run(Effect.ignore(setCanvasCameraSession({ camera, canvasId })))
  }, [canvasId, run, session])

  const onSelectionChange = useCallback((selection: CanvasSelection) => {
    if (session._tag !== "ready") return
    setSession((previous) => reduceSession(
      previous,
      ReplicaSessionAction.selectionChanged({ selection })
    ))
    void run(Effect.ignore(setCanvasSelectionSession({ canvasId, selection })))
  }, [canvasId, run, session])

  const submit = useCallback((commands: CanvasCommandBatch) => {
    if (session._tag !== "ready") {
      return Promise.resolve(Result.fail(new ReplicaSessionUnavailable({
        canvasId,
        reason: "The replica is not ready."
      })))
    }
    return run(Effect.result(ports.change({ canvasId, commands }))).then((changed) => {
      if (Result.isSuccess(changed)) {
        setSession((previous) => reduceSession(
          previous,
          ReplicaSessionAction.submitted({ view: changed.success })
        ))
      }
      return changed
    })
  }, [canvasId, ports, run, session])

  return { session, onCameraChange, onSelectionChange, submit }
}
