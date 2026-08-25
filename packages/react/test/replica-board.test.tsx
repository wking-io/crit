import {
  CanvasChangeFailureSchema,
  decodeCanvasCommandBatch,
  decodeCanvasProjection,
  decodePresenceRoster,
  Id
} from "@crit/domain"
import {
  AcceptedUnconfirmed,
  Blocked,
  Conflicted,
  Ready,
  PendingAuthor,
  ReplicaView,
  type PendingState
} from "@crit/replica"
import {
  IframeRenderPlan,
  type RenderPlan
} from "@crit/representations"
import {
  notifyManager,
  QueryClient,
  QueryClientProvider
} from "@tanstack/react-query"
import { Effect, Schema } from "effect"
import { StrictMode, act, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  ReplicaBoard,
  type FrameRepresentationResolver
} from "../src/index.js"
import { requiredBoard } from "./required-board.js"

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true })
notifyManager.setNotifyFunction((callback) => act(callback))
notifyManager.setScheduler(queueMicrotask)

const url = "https://example.com/checkout"
const projection = decodeCanvasProjection({
  schemaVersion: 3,
  canvasId: "canvas_review",
  title: "Review",
  frames: [{
    frameId: "frame_checkout",
    title: "Checkout",
    representation: { _tag: "web-url", url },
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
    { _tag: "frame", frameId: "frame_checkout" }
  ],
  stackChangedByChangeId: "change_1",
  issuedIds: {
    frameIds: ["frame_checkout"]
  }
})

const empty = decodeCanvasProjection({
  schemaVersion: 3,
  canvasId: "canvas_empty",
  title: "Empty",
  frames: [],
  stack: [],
  stackChangedByChangeId: null,
  issuedIds: { frameIds: [] }
})

const decodeView = Schema.decodeUnknownSync(ReplicaView)

const decodeFailure = Schema.decodeUnknownSync(CanvasChangeFailureSchema)

const decodeAuthor = Schema.decodeUnknownSync(PendingAuthor)
const personAuthor = decodeAuthor({ _tag: "person", displayName: "Ada" })
const agentAuthor = decodeAuthor({
  _tag: "agent",
  displayName: "Codex",
  runBy: "Ada",
  executionId: "execution_9f3abcde"
})

const pendingChange = (
  changeId: string,
  state: PendingState,
  commands: ReturnType<typeof decodeCanvasCommandBatch>,
  author: typeof PendingAuthor.Type,
  dependencies: readonly string[] = []
) => ({
  proposal: {
    changeId,
    canvasId: projection.canvasId,
    observedCursor: "cursor_ack",
    commands
  },
  dependencies,
  state,
  author
})

const rename = decodeCanvasCommandBatch([{
  _tag: "rename-canvas",
  expectedTitle: "Review",
  title: "Review"
}])

const addMissingFrame = decodeCanvasCommandBatch([{
  _tag: "add-frame",
  frameId: "frame_missing",
  title: "Missing",
  representation: { _tag: "web-url", url: "https://example.com/missing" },
  status: "in-progress",
  geometry: { x: 0, y: 0, width: 100, height: 100 }
}])

const synchronized = decodeView({
  _tag: "replica-view",
  canvasId: projection.canvasId,
  acknowledgedCursor: "cursor_ack",
  projection,
  pending: []
})

const emptySynchronized = decodeView({
  _tag: "replica-view",
  canvasId: empty.canvasId,
  acknowledgedCursor: "cursor_ack",
  projection: empty,
  pending: []
})

const presence = decodePresenceRoster({
  _tag: "presence-roster",
  canvasId: projection.canvasId,
  people: [{
    _tag: "connected-person",
    person: {
      _tag: "person",
      personId: "person_presence",
      displayName: "Ada",
      email: { _tag: "unspecified" }
    }
  }]
})

const emptyPresence = decodePresenceRoster({
  _tag: "presence-roster",
  canvasId: projection.canvasId,
  people: []
})

const mixed = decodeView({
  _tag: "replica-view",
  canvasId: projection.canvasId,
  acknowledgedCursor: "cursor_ack",
  projection,
  pending: [
    pendingChange("change_ready", Ready.make({}), rename, personAuthor),
    pendingChange("change_unconfirmed", AcceptedUnconfirmed.make({}), rename, personAuthor),
    pendingChange("change_conflicted", Conflicted.make({
      failure: decodeFailure({
        _tag: "precondition-failed",
        commandIndex: 0,
        field: "title",
        expected: "Review",
        actual: "Other"
      })
    }), rename, personAuthor),
    pendingChange("change_blocked", Blocked.make({
      blockedBy: [Id.change("change_conflicted")]
    }), rename, personAuthor, ["change_conflicted"])
  ]
})

const missingFrame = decodeView({
  _tag: "replica-view",
  canvasId: projection.canvasId,
  acknowledgedCursor: "cursor_ack",
  projection,
  pending: [
    pendingChange("change_missing", Conflicted.make({
      failure: decodeFailure({
        _tag: "entity-not-found",
        commandIndex: 0,
        entity: "frame",
        id: "frame_missing"
      })
    }), addMissingFrame, personAuthor)
  ]
})

let container: HTMLDivElement
let queryClient: QueryClient
let root: Root

const render = (element: ReactElement) => root.render(
  <QueryClientProvider client={queryClient}>
    <StrictMode>{element}</StrictMode>
  </QueryClientProvider>
)
const waitFor = (assertion: () => void) => act(async() => vi.waitFor(assertion))

const checkoutResolver: FrameRepresentationResolver = {
  resolve: () => Effect.succeed(IframeRenderPlan.make({
    representation: projection.frames[0]!.representation,
    url
  }) satisfies RenderPlan)
}

const unusedResolver: FrameRepresentationResolver = {
  resolve: () => Effect.die("empty canvas must not resolve a Frame")
}

const syncRegion = () => {
  const region = container.querySelector("[aria-label$='sync status']")
  expect(region).toBeInstanceOf(HTMLElement)
  return region
}

beforeEach(() => {
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  })
})

afterEach(async() => {
  await act(async() => root.unmount())
  queryClient.clear()
  container.remove()
  vi.restoreAllMocks()
})

describe("ReplicaBoard", () => {
  it("lists connected people", async() => {
    await act(async() => render(
      <ReplicaBoard
        {...requiredBoard}
        presence={presence}
        resolver={checkoutResolver}
        view={synchronized}
      />
    ))
    const region = container.querySelector("[aria-label='Review presence']")
    expect(region?.getAttribute("role")).toBe("status")
    expect([...region?.querySelectorAll("li") ?? []].map((row) => row.textContent))
      .toEqual(["Ada"])
    expect(region?.textContent).not.toContain("run by")
    expect(region?.textContent).not.toContain("Proposed by")
  })

  it("hides presence when the roster is absent or empty", async() => {
    await act(async() => render(
      <ReplicaBoard
        {...requiredBoard}
        resolver={checkoutResolver}
        view={synchronized}
      />
    ))
    expect(container.querySelector("[aria-label='Review presence']")).toBeNull()

    await act(async() => render(
      <ReplicaBoard
        {...requiredBoard}
        presence={emptyPresence}
        resolver={checkoutResolver}
        view={synchronized}
      />
    ))
    expect(container.querySelector("[aria-label='Review presence']")).toBeNull()
  })

  it("shows synchronized copy and the existing board", async() => {
    await act(async() => render(
      <ReplicaBoard {...requiredBoard}  className="workspace" resolver={checkoutResolver} view={synchronized} />
    ))
    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull())

    const region = syncRegion()
    expect(region?.querySelector("[role='status']")?.textContent).toBe(
      "Review is synchronized."
    )
    expect(region?.querySelector("ul")).toBeNull()
    expect(container.querySelector(".workspace")).not.toBeNull()
    expect(container.querySelector("[aria-label='Checkout']")).toBeInstanceOf(HTMLElement)
    expect(container.querySelector("iframe")?.getAttribute("src")).toBe(url)
  })

  it("keeps the empty-board copy when the replica is synchronized", async() => {
    await act(async() => render(
      <ReplicaBoard {...requiredBoard}  resolver={unusedResolver} view={emptySynchronized} />
    ))
    const boardStatus = [...container.querySelectorAll("[role='status']")]
      .map((node) => node.textContent)
    expect(boardStatus).toContain("Empty is synchronized.")
    expect(boardStatus).toContain("Empty has no Frames.")
    expect(container.querySelector("iframe")).toBeNull()
  })

  it("lists mixed pending states in replica order", async() => {
    await act(async() => render(
      <ReplicaBoard {...requiredBoard}  resolver={checkoutResolver} view={mixed} />
    ))
    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull())

    const region = syncRegion()
    expect(region?.querySelector("[role='alert']")?.textContent).toBe(
      "Review has conflicted changes."
    )
    const rows = [...region?.querySelectorAll("li") ?? []].map((node) => node.textContent)
    expect(rows).toEqual([
      "Waiting to sync. Proposed by Ada.",
      "Accepted, awaiting confirmation. Proposed by Ada.",
      "Rejected because title changed since this was proposed. Proposed by Ada.",
      "Blocked by 1 change ahead of it. Proposed by Ada."
    ])
    expect(container.querySelector("[aria-label='Checkout']")).toBeInstanceOf(HTMLElement)
  })

  it("still lists a conflicted add-frame that never landed on the board", async() => {
    await act(async() => render(
      <ReplicaBoard {...requiredBoard}  resolver={checkoutResolver} view={missingFrame} />
    ))
    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull())

    expect(syncRegion()?.querySelector("[role='alert']")?.textContent).toBe(
      "Review has conflicted changes."
    )
    expect(syncRegion()?.querySelector("li")?.textContent).toBe(
      "Rejected because its frame no longer exists. Proposed by Ada."
    )
    expect(container.querySelector("[aria-label='Missing']")).toBeNull()
    expect(container.querySelector("[aria-label='Checkout']")).toBeInstanceOf(HTMLElement)
  })

  it("names an agent proposal with the runner and execution detail", async() => {
    const agentProposed = decodeView({
      _tag: "replica-view",
      canvasId: projection.canvasId,
      acknowledgedCursor: "cursor_ack",
      projection,
      pending: [pendingChange("change_agent", Ready.make({}), rename, agentAuthor)]
    })
    await act(async() => render(
      <ReplicaBoard {...requiredBoard}  resolver={checkoutResolver} view={agentProposed} />
    ))
    const region = syncRegion()
    expect(region?.querySelector("[role='status']")?.textContent).toBe(
      "Review has pending changes."
    )
    expect(region?.querySelector("li")?.textContent).toBe(
      "Waiting to sync. Proposed by Agent Codex. Run by Ada. Run execution_9f3a…"
    )
    expect(region?.textContent).toContain("Run by")
  })

  it("appends reported runtime only for present fields", async() => {
    const agentWithRuntime = decodeAuthor({
      _tag: "agent",
      displayName: "Codex",
      runBy: "Ada",
      executionId: "execution_9f3abcde",
      reportedRuntime: {
        _tag: "reported-runtime",
        source: "client-reported",
        harness: { name: "claude-code" },
        model: { name: "claude-fable-5" },
        sessionId: "sess_1"
      }
    })
    const agentProposed = decodeView({
      _tag: "replica-view",
      canvasId: projection.canvasId,
      acknowledgedCursor: "cursor_ack",
      projection,
      pending: [pendingChange("change_agent_runtime", Ready.make({}), rename, agentWithRuntime)]
    })
    await act(async() => render(
      <ReplicaBoard {...requiredBoard} resolver={checkoutResolver} view={agentProposed} />
    ))
    expect(syncRegion()?.querySelector("li")?.textContent).toBe(
      "Waiting to sync. Proposed by Agent Codex. Run by Ada. Via reported claude-code (claude-fable-5). Reported session sess_1. Run execution_9f3a…"
    )
    expect(syncRegion()?.textContent).not.toContain("Reported task")
  })

  it("distinguishes a Person named Codex from an Agent named Codex", async() => {
    const personCodex = decodeAuthor({ _tag: "person", displayName: "Codex" })
    const sameNameAuthors = decodeView({
      _tag: "replica-view",
      canvasId: projection.canvasId,
      acknowledgedCursor: "cursor_ack",
      projection,
      pending: [
        pendingChange("change_person_codex", Ready.make({}), rename, personCodex),
        pendingChange("change_agent_codex", Ready.make({}), rename, agentAuthor)
      ]
    })
    await act(async() => render(
      <ReplicaBoard {...requiredBoard} resolver={checkoutResolver} view={sameNameAuthors} />
    ))

    const rows = [...syncRegion()?.querySelectorAll("li") ?? []]
      .map((node) => node.textContent)
    expect(rows).toEqual([
      "Waiting to sync. Proposed by Codex.",
      "Waiting to sync. Proposed by Agent Codex. Run by Ada. Run execution_9f3a…"
    ])
    expect(rows[1]).toContain("Run by")
    expect(rows[0]).not.toContain("Run by")
  })

  it("drops the queue when a later view is synchronized", async() => {
    await act(async() => render(
      <ReplicaBoard {...requiredBoard}  resolver={checkoutResolver} view={mixed} />
    ))
    expect(syncRegion()?.querySelector("ul")).not.toBeNull()

    await act(async() => render(
      <ReplicaBoard {...requiredBoard}  resolver={checkoutResolver} view={synchronized} />
    ))
    const region = syncRegion()
    expect(region?.querySelector("[role='status']")?.textContent).toBe(
      "Review is synchronized."
    )
    expect(region?.querySelector("ul")).toBeNull()
    expect(region?.querySelector("[role='alert']")).toBeNull()
  })
})
