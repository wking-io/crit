import {
  CanvasChangeFailureSchema,
  decodeCanvasCommandBatch,
  decodeCanvasProjection,
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
  schemaVersion: 2,
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
  notes: [{
    noteId: "note_price",
    text: "Check the price",
    geometry: { x: 400, y: 80, width: 160, height: 80 },
    attachedFrameId: "frame_checkout",
    createdByChangeId: "change_1",
    updatedByChangeId: "change_1",
    textChangedByChangeId: "change_1",
    geometryChangedByChangeId: "change_1",
    attachmentChangedByChangeId: "change_1"
  }],
  threads: [],
  stack: [
    { _tag: "frame", frameId: "frame_checkout" },
    { _tag: "note", noteId: "note_price" }
  ],
  stackChangedByChangeId: "change_1",
  issuedIds: {
    frameIds: ["frame_checkout"],
    noteIds: ["note_price"],
    threadIds: [],
    commentIds: []
  }
})

const empty = decodeCanvasProjection({
  schemaVersion: 2,
  canvasId: "canvas_empty",
  title: "Empty",
  frames: [],
  notes: [],
  threads: [],
  stack: [],
  stackChangedByChangeId: null,
  issuedIds: { frameIds: [], noteIds: [], threadIds: [], commentIds: [] }
})

const decodeView = Schema.decodeUnknownSync(ReplicaView)

const decodeFailure = Schema.decodeUnknownSync(CanvasChangeFailureSchema)

const decodeAuthor = Schema.decodeUnknownSync(PendingAuthor)
const personAuthor = decodeAuthor({ _tag: "person", displayName: "Ada" })
const agentAuthor = decodeAuthor({ _tag: "agent", displayName: "Codex" })

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
    expect(boardStatus).toContain("Empty has no Frames or Notes.")
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

  it("names an agent proposal by the agent, not a delegating person", async() => {
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
      "Waiting to sync. Proposed by Codex."
    )
    expect(region?.textContent).not.toContain("Ada")
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
