import { assert, describe, expect, it } from "vitest"

import { CanvasEngine, decodeCanvasChange, decodeCanvasProjection } from "../src/index.js"

const empty = () => decodeCanvasProjection({
  schemaVersion: 3,
  canvasId: "canvas_review",
  title: "Review",
  frames: [],
  stack: [],
  stackChangedByChangeId: null,
  issuedIds: { frameIds: [] }
})
const geometry = (x = 0, y = 0) => ({ x, y, width: 100, height: 80 })
const representation = { _tag: "application-route", applicationId: "application_shop", route: "/checkout" }
const change = (changeId: string, commands: readonly unknown[]) =>
  decodeCanvasChange({ canvasId: "canvas_review", changeId, commands })
const apply = (
  projection: ReturnType<typeof empty>,
  changeId: string,
  commands: readonly unknown[]
) => {
  const result = CanvasEngine.apply(projection, change(changeId, commands))
  assert(result._tag === "applied")
  return result.projection
}

describe("Canvas content", () => {
  it("composes Frame mutations with change provenance and stable ordering", () => {
    const first = apply(empty(), "change_create", [
      { _tag: "addFrame", frameId: "frame_b", title: "Checkout", representation, status: "in-progress", geometry: geometry(10, 20) }
    ])
    expect(first).toMatchObject({
      stackChangedByChangeId: "change_create",
      stack: [{ _tag: "frame", frameId: "frame_b" }],
      frames: [{ createdByChangeId: "change_create", updatedByChangeId: "change_create" }]
    })

    const second = apply(first, "change_edit", [
      { _tag: "setFrameTitle", frameId: "frame_b", expectedChangedByChangeId: "change_create", title: "Payment" },
      { _tag: "setFrameStatus", frameId: "frame_b", expectedChangedByChangeId: "change_create", status: "ready-for-review" },
      { _tag: "setFrameGeometry", frameId: "frame_b", expectedChangedByChangeId: "change_create", geometry: geometry(20, 30) }
    ])
    expect(second.frames[0]).toMatchObject({
      title: "Payment",
      status: "ready-for-review",
      geometry: geometry(20, 30),
      updatedByChangeId: "change_edit"
    })
    expect(() => decodeCanvasProjection(JSON.parse(JSON.stringify(second)))).not.toThrow()
  })

  it("rejects stale Frame edits atomically", () => {
    const initial = apply(empty(), "change_create", [
      { _tag: "addFrame", frameId: "frame_a", title: "Old", representation, status: "in-progress", geometry: geometry() }
    ])
    const result = CanvasEngine.apply(initial, change("change_stale", [
      { _tag: "setFrameTitle", frameId: "frame_a", expectedChangedByChangeId: "change_create", title: "New" },
      { _tag: "setFrameTitle", frameId: "frame_a", expectedChangedByChangeId: "change_create", title: "Lost" }
    ]))
    expect(result).toMatchObject({
      _tag: "rejected",
      failure: { _tag: "precondition-failed", commandIndex: 1, field: "titleChangedByChangeId" }
    })
    expect(initial.frames[0]?.title).toBe("Old")
  })

  it("preserves stamps for no-ops and lifetime IDs after deletion", () => {
    const created = apply(empty(), "change_create", [
      { _tag: "addFrame", frameId: "frame_a", title: "Same", representation, status: "in-progress", geometry: geometry() }
    ])
    const noop = apply(created, "change_noop", [
      { _tag: "setFrameTitle", frameId: "frame_a", expectedChangedByChangeId: "change_create", title: "Same" }
    ])
    expect(noop).toBe(created)
    const removed = apply(created, "change_remove", [
      { _tag: "removeFrame", frameId: "frame_a", expectedUpdatedByChangeId: "change_create" }
    ])
    expect(CanvasEngine.apply(removed, change("change_reuse", [
      { _tag: "addFrame", frameId: "frame_a", title: "Again", representation, status: "in-progress", geometry: geometry() }
    ]))).toMatchObject({ _tag: "rejected", failure: { _tag: "id-already-issued" } })
    expect(() => decodeCanvasProjection(JSON.parse(JSON.stringify(removed)))).not.toThrow()
  })

  it("rejects malformed geometry and relational projection corruption", () => {
    for (const bad of [
      { x: Number.NaN, y: 0, width: 1, height: 1 },
      { x: Number.POSITIVE_INFINITY, y: 0, width: 1, height: 1 },
      { x: 0, y: Number.NEGATIVE_INFINITY, width: 1, height: 1 },
      { x: 0, y: 0, width: 0, height: 1 },
      { x: 0, y: 0, width: -1, height: 1 },
      { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 1 },
      { x: 0, y: 0, width: 1, height: 0 },
      { x: 0, y: 0, width: 1, height: -1 },
      { x: 0, y: 0, width: 1, height: Number.POSITIVE_INFINITY }
    ]) {
      expect(() => change("change_bad", [{
        _tag: "addFrame",
        frameId: "frame_a",
        title: "Bad",
        representation,
        status: "in-progress",
        geometry: bad
      }])).toThrow()
    }
    const projection = JSON.parse(JSON.stringify(apply(empty(), "change_create", [{
      _tag: "addFrame",
      frameId: "frame_a",
      title: "Good",
      representation,
      status: "in-progress",
      geometry: geometry()
    }])))
    projection.issuedIds.frameIds = []
    expect(() => decodeCanvasProjection(projection)).toThrow()
  })

  it("deletes a Frame while retaining every issued identity", () => {
    const created = apply(empty(), "change_create", [
      { _tag: "addFrame", frameId: "frame_a", title: "Frame", representation, status: "in-progress", geometry: geometry() }
    ])
    const removed = apply(created, "change_remove", [
      { _tag: "removeFrame", frameId: "frame_a", expectedUpdatedByChangeId: "change_create" }
    ])
    expect(removed).toMatchObject({
      frames: [],
      stack: [],
      issuedIds: { frameIds: ["frame_a"] }
    })
  })

  it("rejects duplicate and reused Frame IDs", () => {
    const created = apply(empty(), "change_create", [
      { _tag: "addFrame", frameId: "frame_a", title: "Frame", representation, status: "in-progress", geometry: geometry() }
    ])
    expect(CanvasEngine.apply(created, change("change_duplicate", [
      { _tag: "addFrame", frameId: "frame_a", title: "Again", representation, status: "in-progress", geometry: geometry() }
    ]))).toMatchObject({ _tag: "rejected", failure: { _tag: "id-already-issued" } })

    const removed = apply(created, "change_remove", [
      { _tag: "removeFrame", frameId: "frame_a", expectedUpdatedByChangeId: "change_create" }
    ])
    expect(CanvasEngine.apply(removed, change("change_reuse", [
      { _tag: "addFrame", frameId: "frame_a", title: "Again", representation, status: "in-progress", geometry: geometry() }
    ]))).toMatchObject({ _tag: "rejected", failure: { _tag: "id-already-issued" } })
  })

  it("rejects duplicate stack entries at projection decode", () => {
    const valid = apply(empty(), "change_create", [
      { _tag: "addFrame", frameId: "frame_a", title: "Frame", representation, status: "in-progress", geometry: geometry() }
    ])
    const item = valid.stack[0]
    if (item === undefined) throw new Error("Fixture content is missing")
    expect(() => decodeCanvasProjection({ ...valid, stack: [...valid.stack, item] })).toThrow()
  })

  it("replays Frame edits deterministically", () => {
    const changes = [
      change("change_create", [
        { _tag: "addFrame", frameId: "frame_a", title: "Frame", representation, status: "in-progress", geometry: geometry() }
      ]),
      change("change_edit", [
        { _tag: "setFrameTitle", frameId: "frame_a", expectedChangedByChangeId: "change_create", title: "Edited" }
      ])
    ]
    const first = CanvasEngine.replay(empty(), changes)
    assert(first._tag === "replayed")
    expect(first.projection.frames[0]?.title).toBe("Edited")
    expect(CanvasEngine.replay(empty(), changes)).toEqual(first)
  })

  it("uses one canonical code-point order for active and issued IDs", () => {
    const projection = apply(empty(), "change_order", [
      { _tag: "addFrame", frameId: "frame_a_b", title: "Underscore", representation, status: "in-progress", geometry: geometry() },
      { _tag: "addFrame", frameId: "frame_a-b", title: "Hyphen", representation, status: "in-progress", geometry: geometry() }
    ])
    expect(projection.frames.map(({ frameId }) => frameId)).toEqual(["frame_a-b", "frame_a_b"])
    expect(projection.issuedIds.frameIds).toEqual(["frame_a-b", "frame_a_b"])
    expect(() => decodeCanvasProjection(JSON.parse(JSON.stringify(projection)))).not.toThrow()
  })

  it("treats representation state object key order as semantically irrelevant", () => {
    const initialRepresentation = { ...representation, state: { actor: "npc", source: "checkout" } }
    const equivalentRepresentation = { ...representation, state: { source: "checkout", actor: "npc" } }
    const created = apply(empty(), "change_create", [{
      _tag: "addFrame",
      frameId: "frame_a",
      title: "Frame",
      representation: initialRepresentation,
      status: "in-progress",
      geometry: geometry()
    }])
    const result = CanvasEngine.apply(created, change("change_noop", [{
      _tag: "setFrameRepresentation",
      frameId: "frame_a",
      expectedChangedByChangeId: "change_create",
      representation: equivalentRepresentation
    }]))
    expect(result).toEqual({ _tag: "applied", projection: created })
    if (result._tag === "applied") expect(result.projection).toBe(created)
    expect(created.frames[0]).toMatchObject({
      representationChangedByChangeId: "change_create",
      updatedByChangeId: "change_create"
    })
  })
})
