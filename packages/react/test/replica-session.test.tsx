import {
  CanvasChangeFailureSchema,
  Id,
  decodeCanvasCommandBatch,
  decodeCanvasProjection
} from "@crit/domain"
import type { CanvasId } from "@crit/domain"
import { ReplicaView } from "@crit/replica"
import { Effect, Match, Result, Schema } from "effect"
import type { KeyValueStore } from "effect/unstable/persistence"
import { StrictMode, act, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  CanvasCamera,
  CanvasSelection,
  ReplicaConnection,
  ReplicaChangeRejected,
  ReplicaSubscriptionEvent,
  ReplicaSession,
  ReplicaSessionUnavailable,
  getCanvasCameraSession,
  getCanvasSelectionSession,
  layerStorage,
  setCanvasCameraSession,
  setCanvasSelectionSession,
  useReplicaSession,
  type ReplicaSessionHandle,
  type ReplicaSessionPorts
} from "../src/index.js"
import { CritRegistry } from "./crit-registry.js"

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true })

const canvasA = Id.canvas("canvas_review")
const canvasB = Id.canvas("canvas_other")

const makeView = (args: {
  readonly canvasId: CanvasId
  readonly cursor: string
}): ReplicaView =>
  Schema.decodeUnknownSync(ReplicaView)({
    _tag: "replicaView",
    canvasId: args.canvasId,
    acknowledgedCursor: args.cursor,
    projection: decodeCanvasProjection({
      schemaVersion: 3,
      canvasId: args.canvasId,
      title: "Review",
      frames: [{
        frameId: "frame_checkout",
        title: "Checkout",
        representation: { _tag: "webUrl", url: "https://example.com/checkout" },
        status: "in-progress",
        geometry: { x: 40, y: 80, width: 320, height: 200 },
        createdByChangeId: "change_1",
        updatedByChangeId: "change_1",
        titleChangedByChangeId: "change_1",
        representationChangedByChangeId: "change_1",
        statusChangedByChangeId: "change_1",
        geometryChangedByChangeId: "change_1"
      }],
      stack: [{ _tag: "frame", frameId: "frame_checkout" }],
      stackChangedByChangeId: "change_1",
      issuedIds: {
        frameIds: ["frame_checkout"]
      }
    }),
    pending: []
  })

const viewOne = makeView({ canvasId: canvasA, cursor: "cursor_one" })
const viewTwo = makeView({ canvasId: canvasA, cursor: "cursor_two" })
const viewOther = makeView({ canvasId: canvasB, cursor: "cursor_other" })

const addFrame = decodeCanvasCommandBatch([{
  _tag: "addFrame",
  frameId: "frame_added",
  title: "Added",
  representation: { _tag: "webUrl", url: "https://example.com/added" },
  status: "in-progress",
  geometry: { x: 400, y: 80, width: 320, height: 200 }
}])

const viewAfterAdd = Schema.decodeUnknownSync(ReplicaView)({
  _tag: "replicaView",
  canvasId: canvasA,
  acknowledgedCursor: "cursor_after_add",
  projection: decodeCanvasProjection({
    schemaVersion: 3,
    canvasId: canvasA,
    title: "Review",
    frames: [{
      frameId: "frame_added",
      title: "Added",
      representation: { _tag: "webUrl", url: "https://example.com/added" },
      status: "in-progress",
      geometry: { x: 400, y: 80, width: 320, height: 200 },
      createdByChangeId: "change_2",
      updatedByChangeId: "change_2",
      titleChangedByChangeId: "change_2",
      representationChangedByChangeId: "change_2",
      statusChangedByChangeId: "change_2",
      geometryChangedByChangeId: "change_2"
    }, {
      frameId: "frame_checkout",
      title: "Checkout",
      representation: { _tag: "webUrl", url: "https://example.com/checkout" },
      status: "in-progress",
      geometry: { x: 40, y: 80, width: 320, height: 200 },
      createdByChangeId: "change_1",
      updatedByChangeId: "change_1",
      titleChangedByChangeId: "change_1",
      representationChangedByChangeId: "change_1",
      statusChangedByChangeId: "change_1",
      geometryChangedByChangeId: "change_1"
    }],
    stack: [
      { _tag: "frame", frameId: "frame_checkout" },
      { _tag: "frame", frameId: "frame_added" }
    ],
    stackChangedByChangeId: "change_2",
    issuedIds: {
      frameIds: ["frame_added", "frame_checkout"]
    }
  }),
  pending: []
})

const rejectedFailure = Schema.decodeUnknownSync(CanvasChangeFailureSchema)({
  _tag: "entityNotFound",
  commandIndex: 0,
  entity: "frame",
  id: "frame_missing"
})

const sessionLayer = layerStorage(() => sessionStorage)
const seedSession = <A, E>(
  effect: Effect.Effect<A, E, KeyValueStore.KeyValueStore>
) => Effect.runPromise(Effect.provide(effect, sessionLayer))

const makeReplica = (initial: ReadonlyArray<ReplicaView>) => {
  const views = new Map(initial.map((view) => [view.canvasId, view]))
  let openCalls = 0
  const listeners = new Map<
    CanvasId,
    Set<(event: ReplicaSubscriptionEvent) => void>
  >()
  const ports: ReplicaSessionPorts = {
    open: (canvasId) => {
      openCalls += 1
      const view = views.get(canvasId)
      return view === undefined
        ? Effect.fail(new ReplicaSessionUnavailable({ canvasId, reason: "replica missing" }))
        : Effect.succeed(view)
    },
    subscribe: (canvasId, onEvent) => {
      const existing = listeners.get(canvasId)
      const set = existing ?? new Set()
      if (existing === undefined) listeners.set(canvasId, set)
      set.add(onEvent)
      return () => {
        set.delete(onEvent)
      }
    },
    attend: () => () => undefined,
    change: ({ canvasId }) => {
      const view = views.get(canvasId)
      return view === undefined
        ? Effect.fail(new ReplicaSessionUnavailable({ canvasId, reason: "replica missing" }))
        : Effect.succeed(view)
    }
  }
  return {
    ports,
    views,
    notify: (
      canvasId: CanvasId,
      event: ReplicaSubscriptionEvent = ReplicaSubscriptionEvent.changed()
    ) => {
      for (const listener of listeners.get(canvasId) ?? []) listener(event)
    },
    activeSubscriptions: (canvasId: CanvasId) => listeners.get(canvasId)?.size ?? 0,
    openCalls: () => openCalls
  }
}

let latest: ReplicaSessionHandle | undefined

const Probe = (props: {
  readonly canvasId: CanvasId
  readonly ports: ReplicaSessionPorts
}): ReactElement => {
  latest = useReplicaSession(props)
  return <output>{Match.value(latest.session).pipe(Match.tagsExhaustive({
    loading: () => "loading",
    ready: () => "ready",
    unavailable: () => "unavailable"
  }))}</output>
}

let container: HTMLDivElement
let root: Root

const render = (element: ReactElement) =>
  root.render(<CritRegistry><StrictMode>{element}</StrictMode></CritRegistry>)
const waitFor = (assertion: () => void | Promise<void>) =>
  act(async() => vi.waitFor(assertion))

beforeEach(() => {
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async() => {
  await act(async() => root.unmount())
  container.remove()
  latest = undefined
  sessionStorage.clear()
  vi.restoreAllMocks()
})

const savedCamera = CanvasCamera.make({ x: 12, y: -8, zoom: 0.5 })
const defaultCamera = CanvasCamera.make({ x: 0, y: 0, zoom: 1 })
const savedSelection = CanvasSelection.make([
  { _tag: "frame", frameId: "frame_checkout" }
])
const defaultSelection = CanvasSelection.make([])
const liveConnection = ReplicaConnection.live()

describe("useReplicaSession", () => {
  it("leaves loading after a successful open under HostRoot's microtask scheduler", async() => {
    let release!: (view: typeof viewOne) => void
    const gate = new Promise<typeof viewOne>((resolve) => {
      release = resolve
    })
    const ports: ReplicaSessionPorts = {
      open: () => Effect.promise(() => gate),
      subscribe: () => () => undefined,
      attend: () => () => undefined,
      change: () => Effect.die("change must not run")
    }

    await act(async() => render(
      <Probe canvasId={canvasA} ports={ports} />
    ))
    expect(container.querySelector("output")?.textContent).toBe("loading")
    expect(latest?.session).toEqual({ _tag: "loading" })

    await act(async() => release(viewOne))

    await waitFor(() =>
      expect(container.querySelector("output")?.textContent).toBe("ready")
    )
    expect(latest?.session).toEqual({
      _tag: "ready",
      view: viewOne,
      connection: liveConnection,
      notice: undefined
    })
    expect(latest?.chrome).toEqual({
      camera: defaultCamera,
      selection: defaultSelection
    })
  })

  it("restores a saved camera and selection when open succeeds", async() => {
    await seedSession(setCanvasCameraSession({ camera: savedCamera, canvasId: canvasA }))
    await seedSession(setCanvasSelectionSession({
      canvasId: canvasA,
      selection: savedSelection
    }))
    const replica = makeReplica([viewOne])

    await act(async() => render(
      <Probe canvasId={canvasA} ports={replica.ports}  />
    ))

    await waitFor(() => {
      expect(latest?.session).toEqual({
        _tag: "ready",
        view: viewOne,
        connection: liveConnection,
        notice: undefined
      })
      expect(latest?.chrome).toEqual({
        camera: savedCamera,
        selection: savedSelection
      })
    })
  })

  it("uses the default camera and selection when none are saved", async() => {
    const replica = makeReplica([viewOne])

    await act(async() => render(
      <Probe canvasId={canvasA} ports={replica.ports}  />
    ))

    await waitFor(() => {
      expect(latest?.session).toEqual({
        _tag: "ready",
        view: viewOne,
        connection: liveConnection,
        notice: undefined
      })
      expect(latest?.chrome).toEqual({
        camera: defaultCamera,
        selection: defaultSelection
      })
    })
  })

  it("reports unavailable when open fails", async() => {
    const replica = makeReplica([])

    await act(async() => render(
      <Probe canvasId={canvasA} ports={replica.ports}  />
    ))

    await waitFor(() =>
      expect(latest?.session).toEqual({
        _tag: "unavailable",
        reason: "replica missing"
      })
    )
  })

  it("recovers to ready when a later open succeeds", async() => {
    const replica = makeReplica([])

    await act(async() => render(
      <Probe canvasId={canvasA} ports={replica.ports}  />
    ))
    await waitFor(() => expect(ReplicaSession.$is("unavailable")(latest?.session)).toBe(true))

    replica.views.set(canvasA, viewOne)
    await act(async() => replica.notify(canvasA))

    await waitFor(() =>
      expect(latest?.session).toEqual({
        _tag: "ready",
        view: viewOne,
        connection: liveConnection,
        notice: undefined
      })
    )
  })

  it("keeps the last ready view when a refresh open fails", async() => {
    await seedSession(setCanvasCameraSession({ camera: savedCamera, canvasId: canvasA }))
    await seedSession(setCanvasSelectionSession({
      canvasId: canvasA,
      selection: savedSelection
    }))
    const replica = makeReplica([viewOne])

    await act(async() => render(
      <Probe canvasId={canvasA} ports={replica.ports}  />
    ))
    await waitFor(() => expect(ReplicaSession.$is("ready")(latest?.session)).toBe(true))

    await act(async() => replica.notify(
      canvasA,
      ReplicaSubscriptionEvent.lost({ reason: "socket closed" })
    ))
    replica.views.delete(canvasA)
    await act(async() => replica.notify(canvasA))

    await waitFor(() => {
      expect(latest?.session).toEqual({
        _tag: "ready",
        view: viewOne,
        connection: ReplicaConnection.lost({ reason: "socket closed" }),
        notice: undefined
      })
      expect(latest?.chrome).toEqual({
        camera: savedCamera,
        selection: savedSelection
      })
    })
  })

  it("keeps the ready payload when the subscription is lost", async() => {
    const replica = makeReplica([viewOne])

    await act(async() => render(
      <Probe canvasId={canvasA} ports={replica.ports}  />
    ))
    await waitFor(() => expect(ReplicaSession.$is("ready")(latest?.session)).toBe(true))
    const previous = latest?.session
    expect(ReplicaSession.$is("ready")(previous)).toBe(true)

    await act(async() => replica.notify(
      canvasA,
      ReplicaSubscriptionEvent.lost({ reason: "socket closed" })
    ))

    expect(latest?.session).toEqual({
      _tag: "ready",
      view: viewOne,
      connection: ReplicaConnection.lost({ reason: "socket closed" }),
      notice: undefined
    })
    if (ReplicaSession.$is("ready")(previous) && ReplicaSession.$is("ready")(latest?.session)) {
      expect(latest.session.view).toBe(previous.view)
    }
  })

  it("refreshes the view when the subscription reconnects", async() => {
    const replica = makeReplica([viewOne])

    await act(async() => render(
      <Probe canvasId={canvasA} ports={replica.ports}  />
    ))
    await waitFor(() => expect(ReplicaSession.$is("ready")(latest?.session)).toBe(true))
    await act(async() => replica.notify(
      canvasA,
      ReplicaSubscriptionEvent.lost({ reason: "socket closed" })
    ))
    replica.views.set(canvasA, viewTwo)

    await act(async() => replica.notify(canvasA, ReplicaSubscriptionEvent.connected()))

    await waitFor(() =>
      expect(latest?.session).toEqual({
        _tag: "ready",
        view: viewTwo,
        connection: liveConnection,
        notice: undefined
      })
    )
  })

  it("re-opens on change and replaces the view without moving the camera or selection", async() => {
    await seedSession(setCanvasCameraSession({ camera: savedCamera, canvasId: canvasA }))
    await seedSession(setCanvasSelectionSession({
      canvasId: canvasA,
      selection: savedSelection
    }))
    const replica = makeReplica([viewOne])

    await act(async() => render(
      <Probe canvasId={canvasA} ports={replica.ports}  />
    ))
    await waitFor(() => expect(ReplicaSession.$is("ready")(latest?.session)).toBe(true))

    replica.views.set(canvasA, viewTwo)
    await act(async() => replica.notify(canvasA))

    await waitFor(() => {
      expect(latest?.session).toEqual({
        _tag: "ready",
        view: viewTwo,
        connection: liveConnection,
        notice: undefined
      })
      expect(latest?.chrome).toEqual({
        camera: savedCamera,
        selection: savedSelection
      })
    })
  })

  it("persists onCameraChange through the camera session", async() => {
    const replica = makeReplica([viewOne])
    const moved = CanvasCamera.make({ x: 40, y: 40, zoom: 2 })

    await act(async() => render(
      <Probe canvasId={canvasA} ports={replica.ports}  />
    ))
    await waitFor(() => expect(ReplicaSession.$is("ready")(latest?.session)).toBe(true))

    await act(async() => latest?.onCameraChange(moved))

    expect(latest?.session).toEqual({
      _tag: "ready",
      view: viewOne,
      connection: liveConnection,
      notice: undefined
    })
    expect(latest?.chrome).toEqual({
      camera: defaultCamera,
      selection: defaultSelection
    })
    await waitFor(async() =>
      expect(await seedSession(getCanvasCameraSession({ canvasId: canvasA }))).toEqual(moved)
    )
  })

  it("persists onSelectionChange through the selection session", async() => {
    const replica = makeReplica([viewOne])

    await act(async() => render(
      <Probe canvasId={canvasA} ports={replica.ports}  />
    ))
    await waitFor(() => expect(ReplicaSession.$is("ready")(latest?.session)).toBe(true))

    await act(async() => latest?.onSelectionChange(savedSelection))

    expect(latest?.session).toEqual({
      _tag: "ready",
      view: viewOne,
      connection: liveConnection,
      notice: undefined
    })
    expect(latest?.chrome).toEqual({
      camera: defaultCamera,
      selection: defaultSelection
    })
    await waitFor(async() =>
      expect(await seedSession(getCanvasSelectionSession({ canvasId: canvasA }))).toEqual(
        savedSelection
      )
    )
  })

  it("unsubscribes the previous canvas when canvasId changes", async() => {
    const replica = makeReplica([viewOne, viewOther])

    await act(async() => render(
      <Probe canvasId={canvasA} ports={replica.ports}  />
    ))
    await waitFor(() => expect(ReplicaSession.$is("ready")(latest?.session)).toBe(true))
    expect(replica.activeSubscriptions(canvasA)).toBe(1)

    await act(async() => render(
      <Probe canvasId={canvasB} ports={replica.ports}  />
    ))

    expect(replica.activeSubscriptions(canvasB)).toBe(1)
    await act(async() => vi.waitFor(
      () => expect(replica.activeSubscriptions(canvasA)).toBe(0),
      { timeout: 2_500 }
    ))
    await waitFor(() =>
      expect(latest?.session).toEqual({
        _tag: "ready",
        view: viewOther,
        connection: liveConnection,
        notice: undefined
      })
    )
  })

  it("replaces the ready view from submit and keeps camera and selection", async() => {
    await seedSession(setCanvasCameraSession({ camera: savedCamera, canvasId: canvasA }))
    await seedSession(setCanvasSelectionSession({
      canvasId: canvasA,
      selection: savedSelection
    }))
    const replica = makeReplica([viewOne])

    await act(async() => render(
      <Probe canvasId={canvasA} ports={replica.ports}  />
    ))
    await waitFor(() => expect(ReplicaSession.$is("ready")(latest?.session)).toBe(true))

    replica.views.set(canvasA, viewAfterAdd)
    let submitted: Awaited<ReturnType<ReplicaSessionHandle["submit"]>> | undefined
    await act(async() => {
      submitted = await latest?.submit(addFrame)
    })

    expect(submitted).toEqual(Result.succeed(viewAfterAdd))
    expect(latest?.session).toEqual({
      _tag: "ready",
      view: viewAfterAdd,
      connection: liveConnection,
      notice: undefined
    })
    expect(latest?.chrome).toEqual({
      camera: savedCamera,
      selection: savedSelection
    })
  })

  it("never returns to loading while a submitted change notification refreshes", async() => {
    const replica = makeReplica([viewOne])
    const rendered: string[] = []
    const SessionProbe = (): ReactElement => {
      const handle = useReplicaSession({ canvasId: canvasA, ports: replica.ports })
      const tag = handle.session._tag
      rendered.push(tag)
      latest = handle
      return <output>{tag}</output>
    }

    await act(async() => render(<SessionProbe />))
    await waitFor(() => expect(ReplicaSession.$is("ready")(latest?.session)).toBe(true))
    const manipulationStart = rendered.length
    replica.views.set(canvasA, viewAfterAdd)

    await act(async() => {
      await latest?.submit(addFrame)
      replica.notify(canvasA)
    })
    await waitFor(() => expect(replica.openCalls()).toBe(2))

    expect(rendered.slice(manipulationStart)).not.toContain("loading")
    expect(replica.activeSubscriptions(canvasA)).toBe(1)
  })

  it("keeps the ready session across transient React subscription churn", async() => {
    const replica = makeReplica([viewOne])

    await act(async() => render(
      <Probe canvasId={canvasA} ports={replica.ports} />
    ))
    await waitFor(() => expect(ReplicaSession.$is("ready")(latest?.session)).toBe(true))
    expect(replica.openCalls()).toBe(1)

    await act(async() => render(<></>))
    await act(async() => render(
      <Probe canvasId={canvasA} ports={replica.ports} />
    ))

    expect(container.querySelector("output")?.textContent).toBe("ready")
    expect(replica.openCalls()).toBe(1)
    expect(replica.activeSubscriptions(canvasA)).toBe(1)
  })

  it("sets a rejection notice and clears it after the next successful submit", async() => {
    await seedSession(setCanvasCameraSession({ camera: savedCamera, canvasId: canvasA }))
    await seedSession(setCanvasSelectionSession({
      canvasId: canvasA,
      selection: savedSelection
    }))
    const replica = makeReplica([viewOne])
    const rejected = new ReplicaChangeRejected({
      canvasId: canvasA,
      failure: rejectedFailure
    })
    let rejectNext = true
    const ports: ReplicaSessionPorts = {
      open: replica.ports.open,
      subscribe: replica.ports.subscribe,
      attend: replica.ports.attend,
      change: () => {
        if (rejectNext) {
          rejectNext = false
          return Effect.fail(rejected)
        }
        return Effect.succeed(viewAfterAdd)
      }
    }

    await act(async() => render(
      <Probe canvasId={canvasA} ports={ports}  />
    ))
    await waitFor(() => expect(ReplicaSession.$is("ready")(latest?.session)).toBe(true))

    let submitted: Awaited<ReturnType<ReplicaSessionHandle["submit"]>> | undefined
    await act(async() => {
      submitted = await latest?.submit(addFrame)
    })

    expect(submitted).toEqual(Result.fail(rejected))
    expect(latest?.session).toEqual({
      _tag: "ready",
      view: viewOne,
      connection: liveConnection,
      notice: rejected
    })

    await act(async() => {
      submitted = await latest?.submit(addFrame)
    })

    expect(submitted).toEqual(Result.succeed(viewAfterAdd))
    expect(latest?.session).toEqual({
      _tag: "ready",
      view: viewAfterAdd,
      connection: liveConnection,
      notice: undefined
    })
    expect(latest?.chrome).toEqual({
      camera: savedCamera,
      selection: savedSelection
    })
  })

  it("keeps an unavailable notice through a failed refresh", async() => {
    const replica = makeReplica([viewOne])
    const failure = new ReplicaSessionUnavailable({
      canvasId: canvasA,
      reason: "daemon unavailable"
    })
    const ports: ReplicaSessionPorts = {
      open: replica.ports.open,
      subscribe: replica.ports.subscribe,
      attend: replica.ports.attend,
      change: () => Effect.fail(failure)
    }

    await act(async() => render(
      <Probe canvasId={canvasA} ports={ports}  />
    ))
    await waitFor(() => expect(ReplicaSession.$is("ready")(latest?.session)).toBe(true))
    await act(async() => {
      await latest?.submit(addFrame)
    })
    replica.views.delete(canvasA)
    await act(async() => replica.notify(canvasA))

    await waitFor(() => expect(latest?.session).toEqual({
      _tag: "ready",
      view: viewOne,
      connection: liveConnection,
      notice: failure
    }))
  })

  it("still replaces the view from a later subscribe notify after submit", async() => {
    const replica = makeReplica([viewOne])

    await act(async() => render(
      <Probe canvasId={canvasA} ports={replica.ports}  />
    ))
    await waitFor(() => expect(ReplicaSession.$is("ready")(latest?.session)).toBe(true))

    replica.views.set(canvasA, viewAfterAdd)
    await act(async() => {
      await latest?.submit(addFrame)
    })
    await waitFor(() =>
      expect(latest?.session).toEqual({
        _tag: "ready",
        view: viewAfterAdd,
        connection: liveConnection,
        notice: undefined
      })
    )

    replica.views.set(canvasA, viewTwo)
    await act(async() => replica.notify(canvasA))

    await waitFor(() =>
      expect(latest?.session).toEqual({
        _tag: "ready",
        view: viewTwo,
        connection: liveConnection,
        notice: undefined
      })
    )
  })

  it("does not call change when submit runs before the replica is ready", async() => {
    let release!: (view: typeof viewOne) => void
    const gate = new Promise<typeof viewOne>((resolve) => {
      release = resolve
    })
    const change = vi.fn(() => Effect.die("change must not run"))
    const ports: ReplicaSessionPorts = {
      open: () => Effect.promise(() => gate),
      subscribe: () => () => undefined,
      attend: () => () => undefined,
      change
    }

    await act(async() => render(
      <Probe canvasId={canvasA} ports={ports}  />
    ))
    expect(latest?.session).toEqual({ _tag: "loading" })

    let loadingSubmit: Awaited<ReturnType<ReplicaSessionHandle["submit"]>> | undefined
    await act(async() => {
      loadingSubmit = await latest?.submit(addFrame)
    })
    expect(loadingSubmit).toEqual(Result.fail(new ReplicaSessionUnavailable({
      canvasId: canvasA,
      reason: "The replica is not ready."
    })))
    expect(change).not.toHaveBeenCalled()

    await act(async() => release(viewOne))
    await waitFor(() => expect(ReplicaSession.$is("ready")(latest?.session)).toBe(true))

    const unavailable = makeReplica([])
    const unavailableChange = vi.fn(() => Effect.die("change must not run"))
    const unavailablePorts: ReplicaSessionPorts = {
      open: unavailable.ports.open,
      subscribe: unavailable.ports.subscribe,
      attend: unavailable.ports.attend,
      change: unavailableChange
    }

    await act(async() => render(
      <Probe canvasId={canvasA} ports={unavailablePorts}  />
    ))
    await waitFor(() => expect(ReplicaSession.$is("unavailable")(latest?.session)).toBe(true))

    let unavailableSubmit: Awaited<ReturnType<ReplicaSessionHandle["submit"]>> | undefined
    await act(async() => {
      unavailableSubmit = await latest?.submit(addFrame)
    })
    expect(unavailableSubmit).toEqual(Result.fail(new ReplicaSessionUnavailable({
      canvasId: canvasA,
      reason: "The replica is not ready."
    })))
    expect(unavailableChange).not.toHaveBeenCalled()
  })

  it("does not apply a late submit after the canvas changes", async() => {
    let release!: (view: typeof viewAfterAdd) => void
    const gate = new Promise<typeof viewAfterAdd>((resolve) => {
      release = resolve
    })
    const replica = makeReplica([viewOne, viewOther])
    const ports: ReplicaSessionPorts = {
      open: replica.ports.open,
      subscribe: replica.ports.subscribe,
      attend: replica.ports.attend,
      change: ({ canvasId }) => canvasId === canvasA
        ? Effect.promise(() => gate)
        : replica.ports.change({ canvasId, commands: addFrame })
    }
    await act(async() => render(
      <Probe canvasId={canvasA} ports={ports} />
    ))
    await waitFor(() => expect(ReplicaSession.$is("ready")(latest?.session)).toBe(true))

    let submitted: Awaited<ReturnType<ReplicaSessionHandle["submit"]>> | undefined
    const pending = latest?.submit(addFrame)
    await act(async() => render(
      <Probe canvasId={canvasB} ports={ports}  />
    ))
    await waitFor(() =>
      expect(latest?.session).toEqual({
        _tag: "ready",
        view: viewOther,
        connection: liveConnection,
        notice: undefined
      })
    )

    await act(async() => {
      release(viewAfterAdd)
      submitted = await pending
    })

    expect(submitted).toEqual(Result.succeed(viewAfterAdd))
    expect(latest?.session).toEqual({
      _tag: "ready",
      view: viewOther,
      connection: liveConnection,
      notice: undefined
    })
  })
})
