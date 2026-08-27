import { AuthorityView } from "@crit/authority"
import {
  ApplicationRouteRepresentation,
  Id,
  decodeCanvasProjection
} from "@crit/domain"
import { ChangeProtocol } from "@crit/protocol"
import {
  IframeRenderPlan,
  RenderPlan
} from "@crit/representations"
import { createMemoryHistory } from "@tanstack/react-router"
import { Schema } from "effect"
import { StrictMode, act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { HostRoot, resolveHostRuntime } from "../src/index.js"

const fetchMock = vi.hoisted(() => {
  const mock = vi.fn<typeof globalThis.fetch>()
  vi.stubGlobal("fetch", mock)
  return mock
})

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true })
const IntersectionObserverStub = class {
  disconnect() {}
  observe() {}
}

const hostedCanvasId = Id.canvas("canvas_shop")
const hostedRepresentation = ApplicationRouteRepresentation.make({
  applicationId: Id.application("application_checkout"),
  route: "/checkout"
})
const hostedAuthorityView = Schema.decodeUnknownSync(AuthorityView)({
  _tag: "authorityView",
  canvasId: hostedCanvasId,
  createdAt: "2026-08-27T00:00:00.000Z",
  createdBy: {
    _tag: "person",
    person: {
      _tag: "person",
      personId: "person_author",
      displayName: "Ada",
      email: { _tag: "access", address: "ada@acme.com" }
    }
  },
  cursor: "cursor_hosted",
  projection: decodeCanvasProjection({
    schemaVersion: 3,
    canvasId: hostedCanvasId,
    title: "Hosted review",
    frames: [{
      frameId: "frame_checkout",
      title: "Checkout",
      representation: hostedRepresentation,
      status: "ready-for-review",
      geometry: { x: 40, y: 80, width: 320, height: 200 },
      createdByChangeId: "change_frame",
      updatedByChangeId: "change_frame",
      titleChangedByChangeId: "change_frame",
      representationChangedByChangeId: "change_frame",
      statusChangedByChangeId: "change_frame",
      geometryChangedByChangeId: "change_frame"
    }],
    stack: [{ _tag: "frame", frameId: "frame_checkout" }],
    stackChangedByChangeId: "change_frame",
    issuedIds: { frameIds: ["frame_checkout"] }
  })
})

const jsonResponse = (body: Schema.Json) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { "content-type": "application/json" }
})

const hostedCanvasFetch = async(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> => {
  const url = new URL(String(input))
  const method = init?.method ?? "GET"
  if (url.pathname === "/identity") {
    return jsonResponse({
      kind: "access-authenticated-person",
      schemaVersion: 1,
      address: "grace@acme.com"
    })
  }
  if (url.pathname === "/canvas/canvas_shop/changes" && method === "GET") {
    return jsonResponse(ChangeProtocol.page.encode({
      canvasId: hostedCanvasId,
      after: hostedAuthorityView.cursor,
      changes: [],
      cursor: hostedAuthorityView.cursor,
      hasMore: false
    }))
  }
  if (url.pathname === "/canvas/canvas_shop" && method === "GET") {
    return jsonResponse(Schema.encodeSync(AuthorityView)(hostedAuthorityView))
  }
  if (url.pathname === "/representations/application-route" && method === "POST") {
    return jsonResponse(Schema.encodeSync(RenderPlan)(IframeRenderPlan.make({
      representation: hostedRepresentation,
      url: "https://preview.example/checkout"
    })))
  }
  return new Response(null, { status: 404 })
}

let container: HTMLDivElement
let root: Root

const fetched = (url: string): boolean => fetchMock.mock.calls.some(
  ([input, init]) => String(input) === url && (init?.method ?? "GET") === "GET"
)

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", IntersectionObserverStub)
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async() => {
  await act(async() => root.unmount())
  container.remove()
  fetchMock.mockReset()
})

describe("HostRoot hosted canvas", () => {
  it("assigns the registered preview URL to the Frame iframe", async() => {
    fetchMock.mockImplementation(hostedCanvasFetch)

    await act(async() => root.render(
      <StrictMode>
        <HostRoot
          history={createMemoryHistory({ initialEntries: ["/canvas/canvas_shop"] })}
          runtime={resolveHostRuntime({
            fragment: "",
            injected: undefined,
            origin: "https://crit.example"
          })}
        />
      </StrictMode>
    ))

    await act(async() => vi.waitFor(() => {
      expect(fetched("http://localhost:3000/identity")).toBe(true)
      expect(fetched("http://localhost:3000/canvas/canvas_shop")).toBe(true)
      expect(container.querySelector("iframe")?.src).toBe(
        "https://preview.example/checkout"
      )
    }, { timeout: 4_000 }))
  })
})
