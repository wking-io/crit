import type { CanvasChangeFailure, CanvasCommandBatch, CanvasId, PresenceRoster } from "@crit/domain"
import type { ReplicaView } from "@crit/replica"
import { Data, Effect, Result } from "effect"
import type { KeyValueStore } from "effect/unstable/persistence"

import { CanvasCamera } from "./canvas-camera.js"
import { getCanvasCameraSession } from "./canvas-camera-session.js"
import { CanvasSelection } from "./canvas-selection.js"
import { getCanvasSelectionSession } from "./canvas-selection-session.js"

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
  readonly attend: (
    canvasId: CanvasId,
    onRoster: (roster: PresenceRoster) => void
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

export interface ReplicaSessionHandle {
  readonly session: ReplicaSession
  readonly onCameraChange: (camera: CanvasCamera) => void
  readonly onSelectionChange: (selection: CanvasSelection) => void
  readonly submit: (
    commands: CanvasCommandBatch
  ) => Promise<Result.Result<ReplicaView, ReplicaSessionUnavailable | ReplicaChangeRejected>>
}

export const loadingReplicaSession = ReplicaSession.loading()

export const defaultReplicaCamera = CanvasCamera.make({ x: 0, y: 0, zoom: 1 })
export const defaultReplicaSelection = CanvasSelection.make([])
export const liveReplicaConnection = ReplicaConnection.live()

export const patchReadyReplicaSession = (
  previous: ReplicaSession,
  patch: {
    readonly view?: ReplicaView
    readonly camera?: CanvasCamera
    readonly selection?: CanvasSelection
    readonly connection?: ReplicaConnection
    readonly notice?: ReplicaChangeRejected | ReplicaSessionUnavailable | undefined
  }
): ReplicaSession => {
  if (!ReplicaSession.$is("ready")(previous)) return previous
  return ReplicaSession.ready({
    view: patch.view ?? previous.view,
    camera: patch.camera ?? previous.camera,
    selection: patch.selection ?? previous.selection,
    connection: patch.connection ?? previous.connection,
    notice: Object.hasOwn(patch, "notice") ? patch.notice : previous.notice
  })
}

export const applyOpenedReplicaSession = (
  previous: ReplicaSession,
  opened: Result.Result<ReplicaView, ReplicaSessionUnavailable>,
  chrome: {
    readonly camera: CanvasCamera
    readonly selection: CanvasSelection
  }
): ReplicaSession => {
  if (Result.isFailure(opened)) {
    return ReplicaSession.$is("ready")(previous)
      ? previous
      : ReplicaSession.unavailable({ reason: opened.failure.reason })
  }
  return ReplicaSession.ready({
    view: opened.success,
    camera: chrome.camera,
    selection: chrome.selection,
    connection: ReplicaSession.$is("ready")(previous)
      ? previous.connection
      : liveReplicaConnection,
    notice: ReplicaSession.$is("ready")(previous) ? previous.notice : undefined
  })
}

export const applyRefreshReplicaSession = (
  previous: ReplicaSession,
  opened: Result.Result<ReplicaView, ReplicaSessionUnavailable>
): ReplicaSession => {
  if (Result.isFailure(opened)) {
    return ReplicaSession.$is("ready")(previous)
      ? previous
      : ReplicaSession.unavailable({ reason: opened.failure.reason })
  }
  return ReplicaSession.$is("ready")(previous)
    ? patchReadyReplicaSession(previous, { view: opened.success })
    : ReplicaSession.ready({
      view: opened.success,
      camera: defaultReplicaCamera,
      selection: defaultReplicaSelection,
      connection: liveReplicaConnection,
      notice: undefined
    })
}

export const applySubmittedReplicaSession = (
  previous: ReplicaSession,
  result: Result.Result<ReplicaView, ReplicaChangeRejected | ReplicaSessionUnavailable>
): ReplicaSession => {
  if (Result.isFailure(result)) {
    return patchReadyReplicaSession(previous, { notice: result.failure })
  }
  return ReplicaSession.$is("ready")(previous)
    ? patchReadyReplicaSession(previous, { view: result.success, notice: undefined })
    : ReplicaSession.ready({
      view: result.success,
      camera: defaultReplicaCamera,
      selection: defaultReplicaSelection,
      connection: liveReplicaConnection,
      notice: undefined
    })
}

export const openedReplicaSession = (args: {
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
      return {
        opened,
        camera: defaultReplicaCamera,
        selection: defaultReplicaSelection
      }
    }
    const savedCamera = yield* getCanvasCameraSession({ canvasId: args.canvasId })
    const savedSelection = yield* getCanvasSelectionSession({
      canvasId: args.canvasId
    })
    return {
      opened,
      camera: savedCamera ?? defaultReplicaCamera,
      selection: savedSelection ?? defaultReplicaSelection
    }
  })
