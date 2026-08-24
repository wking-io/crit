import {
  CanvasChangeFailureSchema,
  Id,
  decodeCanvasCommandBatch,
  decodeCanvasProjection
} from "@crit/domain"
import type { CanvasId } from "@crit/domain"
import { ReplicaView } from "@crit/replica"
import { Effect, Layer, Result, Schema } from "effect"
import { StrictMode, act, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  CanvasCamera,
  CanvasSelection,
  ReplicaChangeRejected,
  ReplicaSessionUnavailable,
  getCanvasCameraSession,
  getCanvasSelectionSession,
  layerMemory,
  setCanvasCameraSession,
  setCanvasSelectionSession,
  useReplicaSession,
  type ReplicaSessionHandle,
  type ReplicaSessionPorts,
  type ReplicaSessionRun
} from "../src/index.js"

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true })

const canvasA = Id.canvas("canvas_review")
const canvasB = Id.canvas("canvas_other")

const makeView = (args: {
  readonly canvasId: CanvasId
  readonly cursor: string
}): ReplicaView =>
  Schema.decodeUnknownSync(ReplicaView)({
    _tag: "replica-view",
    canvasId: args.canvasId,
    acknowledgedCursor: args.cursor,
    projection: decodeCanvasProjection({
      schemaVersion: 2,
      canvasId: args.canvasId,
      title: "Review",
      frames: [{
        frameId: "frame_checkout",
        title: "Checkout",
        representation: { _tag: "web-url", url: "https://example.com/checkout" },
        status: "in-progress",
        geometry: { x: 40, y: 80, width: 320, height: 200 },
        createdByChangeId: "change_1",
        updatedByChangeId: "change_1",
        titleChangedByChangeId: "change_1",
        representationChangedByChangeId: "change_1",
        statusChangedByChangeId: "change_1",
        geometryChangedByChangeId: "change_1"
      }],
      notes: [],
      threads: [],
      stack: [{ _tag: "frame", frameId: "frame_checkout" }],
      stackChangedByChangeId: "change_1",
      issuedIds: {
        frameIds: ["frame_checkout"],
        noteIds: [],
        threadIds: [],
        commentIds: []
      }
    }),
    pending: []
  })

const viewOne = makeView({ canvasId: canvasA, cursor: "cursor_one" })
const viewTwo = makeView({ canvasId: canvasA, cursor: "cursor_two" })
const viewOther = makeView({ canvasId: canvasB, cursor: "cursor_other" })

const addFrame = decodeCanvasCommandBatch([{
  _tag: "add-frame",
  frameId: "frame_added",
  title: "Added",
  representation: { _tag: "web-url", url: "https://example.com/added" },
  status: "in-progress",
  geometry: { x: 400, y: 80, width: 320, height: 200 }
}])

const viewAfterAdd = Schema.decodeUnknownSync(ReplicaView)({
  _tag: "replica-view",
  canvasId: canvasA,
  acknowledgedCursor: "cursor_after_add",
  projection: decodeCanvasProjection({
    schemaVersion: 2,
    canvasId: canvasA,
    title: "Review",
    frames: [{
      frameId: "frame_added",
      title: "Added",
      representation: { _tag: "web-url", url: "https://example.com/added" },
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
      representation: { _tag: "web-url", url: "https://example.com/checkout" },
      status: "in-progress",
      geometry: { x: 40, y: 80, width: 320, height: 200 },
      createdByChangeId: "change_1",
      updatedByChangeId: "change_1",
      titleChangedByChangeId: "change_1",
      representationChangedByChangeId: "change_1",
      statusChangedByChangeId: "change_1",
      geometryChangedByChangeId: "change_1"
    }],
    notes: [],
    threads: [],
    stack: [
      { _tag: "frame", frameId: "frame_checkout" },
      { _tag: "frame", frameId: "frame_added" }
    ],
    stackChangedByChangeId: "change_2",
    issuedIds: {
      frameIds: ["frame_added", "frame_checkout"],
      noteIds: [],
      threadIds: [],
      commentIds: []
    }
  }),
  pending: []
})

const rejectedFailure = Schema.decodeUnknownSync(CanvasChangeFailureSchema)({
  _tag: "entity-not-found",
  commandIndex: 0,
  entity: "frame",
  id: "frame_missing"
})

const makeRun = (): ReplicaSessionRun => {
  const services = Effect.runSync(Effect.scoped(Layer.build(layerMemory)))
  return (effect) => Effect.runPromise(Effect.provide(effect, services))
}

const makeReplica = (initial: ReadonlyArray<ReplicaView>) => {
  const views = new Map(initial.map((view) => [view.canvasId, view]))
  const listeners = new Map<CanvasId, Set<() => void>>()
  const ports: ReplicaSessionPorts = {
    open: (canvasId) => {
      const view = views.get(canvasId)
      return view === undefined
        ? Effect.fail(new ReplicaSessionUnavailable({ canvasId, reason: "replica missing" }))
        : Effect.succeed(view)
    },
    subscribe: (canvasId, onChanged) => {
      const existing = listeners.get(canvasId)
      const set = existing ?? new Set()
      if (existing === undefined) listeners.set(canvasId, set)
      set.add(onChanged)
      return () => {
        set.delete(onChanged)
      }
    },
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
    notify: (canvasId: CanvasId) => {
      for (const listener of listeners.get(canvasId) ?? []) listener()
    },
    activeSubscriptions: (canvasId: CanvasId) => listeners.get(canvasId)?.size ?? 0
  }
}

let latest: ReplicaSessionHandle | undefined

const Probe = (props: {
  readonly canvasId: CanvasId
  readonly ports: ReplicaSessionPorts
  readonly run: ReplicaSessionRun
}): ReactElement => {
  latest = useReplicaSession(props)
  return <output>{latest.session._tag}</output>
}

let container: HTMLDivElement
let root: Root

const render = (element: ReactElement) => root.render(<StrictMode>{element}</StrictMode>)
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
  vi.restoreAllMocks()
})

const savedCamera = CanvasCamera.make({ x: 12, y: -8, zoom: 0.5 })
const defaultCamera = CanvasCamera.make({ x: 0, y: 0, zoom: 1 })
const savedSelection = CanvasSelection.make([
  { _tag: "frame", frameId: "frame_checkout" }
])
const defaultSelection = CanvasSelection.make([])

describe("useReplicaSession", () => {
  it("restores a saved camera and selection when open succeeds", async() => {
    const run = makeRun()
    await run(setCanvasCameraSession({ camera: savedCamera, canvasId: canvasA }))
    await run(setCanvasSelectionSession({
      canvasId: canvasA,
      selection: savedSelection
    }))
    const replica = makeReplica([viewOne])

    await act(async() => render(
      <Probe canvasId={canvasA} ports={replica.ports} run={run} />
    ))

    await waitFor(() =>
      expect(latest?.session).toEqual({
        _tag: "ready",
        view: viewOne,
        camera: savedCamera,
        selection: savedSelection
      })
    )
  })

  it("uses the default camera and selection when none are saved", async() => {
    const replica = makeReplica([viewOne])

    await act(async() => render(
      <Probe canvasId={canvasA} ports={replica.ports} run={makeRun()} />
    ))

    await waitFor(() =>
      expect(latest?.session).toEqual({
        _tag: "ready",
        view: viewOne,
        camera: defaultCamera,
        selection: defaultSelection
      })
    )
  })

  it("reports unavailable when open fails", async() => {
    const replica = makeReplica([])

    await act(async() => render(
      <Probe canvasId={canvasA} ports={replica.ports} run={makeRun()} />
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
      <Probe canvasId={canvasA} ports={replica.ports} run={makeRun()} />
    ))
    await waitFor(() => expect(latest?.session._tag).toBe("unavailable"))

    replica.views.set(canvasA, viewOne)
    await act(async() => replica.notify(canvasA))

    await waitFor(() =>
      expect(latest?.session).toEqual({
        _tag: "ready",
        view: viewOne,
        camera: defaultCamera,
        selection: defaultSelection
      })
    )
  })

  it("keeps the last ready view when a refresh open fails", async() => {
    const run = makeRun()
    await run(setCanvasCameraSession({ camera: savedCamera, canvasId: canvasA }))
    await run(setCanvasSelectionSession({
      canvasId: canvasA,
      selection: savedSelection
    }))
    const replica = makeReplica([viewOne])

    await act(async() => render(
      <Probe canvasId={canvasA} ports={replica.ports} run={run} />
    ))
    await waitFor(() => expect(latest?.session._tag).toBe("ready"))

    replica.views.delete(canvasA)
    await act(async() => replica.notify(canvasA))

    await waitFor(() =>
      expect(latest?.session).toEqual({
        _tag: "ready",
        view: viewOne,
        camera: savedCamera,
        selection: savedSelection
      })
    )
  })

  it("re-opens on change and replaces the view without moving the camera or selection", async() => {
    const run = makeRun()
    await run(setCanvasCameraSession({ camera: savedCamera, canvasId: canvasA }))
    await run(setCanvasSelectionSession({
      canvasId: canvasA,
      selection: savedSelection
    }))
    const replica = makeReplica([viewOne])

    await act(async() => render(
      <Probe canvasId={canvasA} ports={replica.ports} run={run} />
    ))
    await waitFor(() => expect(latest?.session._tag).toBe("ready"))

    replica.views.set(canvasA, viewTwo)
    await act(async() => replica.notify(canvasA))

    await waitFor(() =>
      expect(latest?.session).toEqual({
        _tag: "ready",
        view: viewTwo,
        camera: savedCamera,
        selection: savedSelection
      })
    )
  })

  it("persists onCameraChange through the camera session", async() => {
    const run = makeRun()
    const replica = makeReplica([viewOne])
    const moved = CanvasCamera.make({ x: 40, y: 40, zoom: 2 })

    await act(async() => render(
      <Probe canvasId={canvasA} ports={replica.ports} run={run} />
    ))
    await waitFor(() => expect(latest?.session._tag).toBe("ready"))

    await act(async() => latest?.onCameraChange(moved))

    await waitFor(() =>
      expect(latest?.session).toEqual({
        _tag: "ready",
        view: viewOne,
        camera: moved,
        selection: defaultSelection
      })
    )
    await waitFor(async() =>
      expect(await run(getCanvasCameraSession({ canvasId: canvasA }))).toEqual(moved)
    )
  })

  it("persists onSelectionChange through the selection session", async() => {
    const run = makeRun()
    const replica = makeReplica([viewOne])

    await act(async() => render(
      <Probe canvasId={canvasA} ports={replica.ports} run={run} />
    ))
    await waitFor(() => expect(latest?.session._tag).toBe("ready"))

    await act(async() => latest?.onSelectionChange(savedSelection))

    await waitFor(() =>
      expect(latest?.session).toEqual({
        _tag: "ready",
        view: viewOne,
        camera: defaultCamera,
        selection: savedSelection
      })
    )
    await waitFor(async() =>
      expect(await run(getCanvasSelectionSession({ canvasId: canvasA }))).toEqual(
        savedSelection
      )
    )
  })

  it("unsubscribes the previous canvas when canvasId changes", async() => {
    const run = makeRun()
    const replica = makeReplica([viewOne, viewOther])

    await act(async() => render(
      <Probe canvasId={canvasA} ports={replica.ports} run={run} />
    ))
    await waitFor(() => expect(latest?.session._tag).toBe("ready"))
    expect(replica.activeSubscriptions(canvasA)).toBe(1)

    await act(async() => render(
      <Probe canvasId={canvasB} ports={replica.ports} run={run} />
    ))

    expect(replica.activeSubscriptions(canvasA)).toBe(0)
    expect(replica.activeSubscriptions(canvasB)).toBe(1)
    await waitFor(() =>
      expect(latest?.session).toEqual({
        _tag: "ready",
        view: viewOther,
        camera: defaultCamera,
        selection: defaultSelection
      })
    )
  })

  it("replaces the ready view from submit and keeps camera and selection", async() => {
    const run = makeRun()
    await run(setCanvasCameraSession({ camera: savedCamera, canvasId: canvasA }))
    await run(setCanvasSelectionSession({
      canvasId: canvasA,
      selection: savedSelection
    }))
    const replica = makeReplica([viewOne])

    await act(async() => render(
      <Probe canvasId={canvasA} ports={replica.ports} run={run} />
    ))
    await waitFor(() => expect(latest?.session._tag).toBe("ready"))

    replica.views.set(canvasA, viewAfterAdd)
    let submitted: Awaited<ReturnType<ReplicaSessionHandle["submit"]>> | undefined
    await act(async() => {
      submitted = await latest?.submit(addFrame)
    })

    expect(submitted).toEqual(Result.succeed(viewAfterAdd))
    expect(latest?.session).toEqual({
      _tag: "ready",
      view: viewAfterAdd,
      camera: savedCamera,
      selection: savedSelection
    })
  })

  it("keeps the last ready view when submit is rejected", async() => {
    const run = makeRun()
    await run(setCanvasCameraSession({ camera: savedCamera, canvasId: canvasA }))
    await run(setCanvasSelectionSession({
      canvasId: canvasA,
      selection: savedSelection
    }))
    const replica = makeReplica([viewOne])
    const rejected = new ReplicaChangeRejected({
      canvasId: canvasA,
      failure: rejectedFailure
    })
    const ports: ReplicaSessionPorts = {
      open: replica.ports.open,
      subscribe: replica.ports.subscribe,
      change: () => Effect.fail(rejected)
    }

    await act(async() => render(
      <Probe canvasId={canvasA} ports={ports} run={run} />
    ))
    await waitFor(() => expect(latest?.session._tag).toBe("ready"))

    let submitted: Awaited<ReturnType<ReplicaSessionHandle["submit"]>> | undefined
    await act(async() => {
      submitted = await latest?.submit(addFrame)
    })

    expect(submitted).toEqual(Result.fail(rejected))
    expect(latest?.session).toEqual({
      _tag: "ready",
      view: viewOne,
      camera: savedCamera,
      selection: savedSelection
    })
  })

  it("still replaces the view from a later subscribe notify after submit", async() => {
    const run = makeRun()
    const replica = makeReplica([viewOne])

    await act(async() => render(
      <Probe canvasId={canvasA} ports={replica.ports} run={run} />
    ))
    await waitFor(() => expect(latest?.session._tag).toBe("ready"))

    replica.views.set(canvasA, viewAfterAdd)
    await act(async() => {
      await latest?.submit(addFrame)
    })
    await waitFor(() =>
      expect(latest?.session).toEqual({
        _tag: "ready",
        view: viewAfterAdd,
        camera: defaultCamera,
        selection: defaultSelection
      })
    )

    replica.views.set(canvasA, viewTwo)
    await act(async() => replica.notify(canvasA))

    await waitFor(() =>
      expect(latest?.session).toEqual({
        _tag: "ready",
        view: viewTwo,
        camera: defaultCamera,
        selection: defaultSelection
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
      change
    }

    await act(async() => render(
      <Probe canvasId={canvasA} ports={ports} run={makeRun()} />
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
    await waitFor(() => expect(latest?.session._tag).toBe("ready"))

    const unavailable = makeReplica([])
    const unavailableChange = vi.fn(() => Effect.die("change must not run"))
    const unavailablePorts: ReplicaSessionPorts = {
      open: unavailable.ports.open,
      subscribe: unavailable.ports.subscribe,
      change: unavailableChange
    }

    await act(async() => render(
      <Probe canvasId={canvasA} ports={unavailablePorts} run={makeRun()} />
    ))
    await waitFor(() => expect(latest?.session._tag).toBe("unavailable"))

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
})
