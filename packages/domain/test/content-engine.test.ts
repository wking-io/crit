import { assert, describe, expect, it } from "vitest"

import { CanvasEngine, decodeCanvasChange, decodeCanvasProjection, engineChange } from "../src/index.js"

const empty = () => decodeCanvasProjection({
  schemaVersion: 2, canvasId: "canvas_review", title: "Review",
  frames: [], notes: [], threads: [], stack: [], stackChangedByChangeId: null,
  issuedIds: { frameIds: [], noteIds: [], threadIds: [], commentIds: [] }
})
const geometry = (x = 0, y = 0) => ({ x, y, width: 100, height: 80 })
const representation = { _tag: "application-route", applicationId: "application_shop", route: "/checkout" }
const person = { _tag: "person" as const, personId: "person_ada", displayName: "Ada" }
const agent = { _tag: "agent" as const, agentId: "agent_codex", displayName: "Codex" }
const change = (changeId: string, commands: readonly unknown[]) => decodeCanvasChange({ canvasId: "canvas_review", changeId, commands })
const apply = (
  projection: ReturnType<typeof empty>,
  changeId: string,
  commands: readonly unknown[],
  author: typeof person | typeof agent = person
) => {
  const result = CanvasEngine.apply(projection, change(changeId, commands), author)
  assert(result._tag === "applied")
  return result.projection
}

describe("authored Canvas content", () => {
  it("composes all content mutations with change provenance and stable ordering", () => {
    const first = apply(empty(), "change_create", [
      { _tag: "add-frame", frameId: "frame_b", title: "Checkout", representation, status: "in-progress", geometry: geometry(10, 20) },
      { _tag: "add-note", noteId: "note_b", text: "Tighten copy", color: "blue", geometry: geometry(15, 25), attachedFrameId: "frame_b" },
      { _tag: "add-comment-thread", threadId: "thread_b", commentId: "comment_b", body: "Why?", anchor: { _tag: "element", frameId: "frame_b", representationChangedByChangeId: "change_create", selector: "#buy", fingerprint: { tagName: "button", evidence: [{ kind: "id", value: "buy" }] }, point: { x: 0.5, y: 0.25 }, fallback: { x: 0.5, y: 0.5 } } }
    ])
    expect(first).toMatchObject({
      stackChangedByChangeId: "change_create",
      stack: [{ _tag: "frame", frameId: "frame_b" }, { _tag: "note", noteId: "note_b" }],
      frames: [{ createdByChangeId: "change_create", updatedByChangeId: "change_create" }],
      notes: [{ createdByChangeId: "change_create", attachedFrameId: "frame_b", author: person, color: "blue" }],
      threads: [{ comments: [{ createdByChangeId: "change_create", author: person }] }]
    })

    const second = apply(first, "change_edit", [
      { _tag: "set-frame-title", frameId: "frame_b", expectedChangedByChangeId: "change_create", title: "Payment" },
      { _tag: "set-frame-status", frameId: "frame_b", expectedChangedByChangeId: "change_create", status: "ready-for-review" },
      { _tag: "set-frame-geometry", frameId: "frame_b", expectedChangedByChangeId: "change_create", geometry: geometry(20, 30) },
      { _tag: "edit-note", noteId: "note_b", expectedText: "Tighten copy", text: "Ship copy" },
      { _tag: "reply-to-comment-thread", threadId: "thread_b", commentId: "comment_a", body: "Because" },
      { _tag: "edit-comment", threadId: "thread_b", commentId: "comment_b", expectedBody: "Why?", body: "Why now?" },
      { _tag: "set-comment-thread-resolution", threadId: "thread_b", expectedChangedByChangeId: "change_create", resolved: true },
      { _tag: "place-canvas-item", item: { _tag: "note", noteId: "note_b" }, after: null, expectedStackChangeId: "change_create" }
    ])
    expect(second.notes[0]?.geometry).toMatchObject({ x: 25, y: 35 })
    expect(second.threads[0]?.comments.map((comment) => comment.commentId)).toEqual(["comment_b", "comment_a"])
    expect(second.stack[0]).toEqual({ _tag: "note", noteId: "note_b" })
    expect(() => decodeCanvasProjection(JSON.parse(JSON.stringify(second)))).not.toThrow()
  })

  it("rejects stale authored content atomically", () => {
    const initial = apply(empty(), "change_create", [{ _tag: "add-note", noteId: "note_a", text: "Old", color: "blue", geometry: geometry(), attachedFrameId: null }])
    const result = CanvasEngine.apply(initial, change("change_stale", [
      { _tag: "edit-note", noteId: "note_a", expectedText: "Old", text: "New" },
      { _tag: "edit-note", noteId: "note_a", expectedText: "Old", text: "Lost" }
    ]), person)
    expect(result).toMatchObject({ _tag: "rejected", failure: { _tag: "precondition-failed", commandIndex: 1, field: "text" } })
    expect(initial.notes[0]?.text).toBe("Old")
  })

  it("preserves stamps for no-ops and lifetime IDs after deletion", () => {
    const created = apply(empty(), "change_create", [{ _tag: "add-note", noteId: "note_a", text: "Same", color: "blue", geometry: geometry(), attachedFrameId: null }])
    const noop = apply(created, "change_noop", [{ _tag: "edit-note", noteId: "note_a", expectedText: "Same", text: "Same" }])
    expect(noop).toBe(created)
    const removed = apply(created, "change_remove", [{ _tag: "remove-note", noteId: "note_a", expectedUpdatedByChangeId: "change_create" }])
    expect(CanvasEngine.apply(removed, change("change_reuse", [{ _tag: "add-note", noteId: "note_a", text: "Again", color: "blue", geometry: geometry(), attachedFrameId: null }]), person)).toMatchObject({ _tag: "rejected", failure: { _tag: "id-already-issued" } })
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
    ]) expect(() => change("change_bad", [{ _tag: "add-note", noteId: "note_a", text: "Bad", color: "blue", geometry: bad, attachedFrameId: null }])).toThrow()
    const projection = JSON.parse(JSON.stringify(apply(empty(), "change_create", [{ _tag: "add-note", noteId: "note_a", text: "Good", color: "blue", geometry: geometry(), attachedFrameId: null }])))
    projection.issuedIds.noteIds = []
    expect(() => decodeCanvasProjection(projection)).toThrow()
  })

  it("validates element fingerprints and normalized points at command decode", () => {
    const base = { _tag: "element", frameId: "frame_a", representationChangedByChangeId: "change_a", selector: "#buy", fingerprint: { tagName: "button", evidence: [{ kind: "id", value: "buy" }] }, point: { x: 0.5, y: 0.25 }, fallback: { x: 0, y: 1 } }
    expect(() => change("change_anchor", [{ _tag: "add-comment-thread", threadId: "thread_a", commentId: "comment_a", body: "Body", anchor: base }])).not.toThrow()
    const badAnchors = [
      { ...base, selector: " " },
      { ...base, point: { x: -0.01, y: 0 } },
      { ...base, point: { x: 0, y: 1.01 } },
      { ...base, fallback: { x: -0.01, y: 0 } },
      { ...base, fallback: { x: 0, y: 1.01 } },
      { ...base, fingerprint: { ...base.fingerprint, tagName: "BUTTON" } },
      { ...base, fingerprint: { ...base.fingerprint, evidence: [] } },
      { ...base, fingerprint: { ...base.fingerprint, evidence: [{ kind: "text", value: "Buy" }, { kind: "id", value: "buy" }] } },
      { ...base, fingerprint: { ...base.fingerprint, evidence: [{ kind: "id", value: "buy" }, { kind: "id", value: "buy" }] } }
    ]
    for (const anchor of badAnchors) expect(() => change("change_bad_anchor", [{ _tag: "add-comment-thread", threadId: "thread_a", commentId: "comment_a", body: "Body", anchor }])).toThrow()
  })

  it("retains element anchors when a Frame representation changes but rejects stale new anchors", () => {
    const anchored = apply(empty(), "change_create", [
      { _tag: "add-frame", frameId: "frame_a", title: "Frame", representation, status: "in-progress", geometry: geometry() },
      { _tag: "add-comment-thread", threadId: "thread_a", commentId: "comment_z", body: "Old anchor", anchor: { _tag: "element", frameId: "frame_a", representationChangedByChangeId: "change_create", selector: "#buy", fingerprint: { tagName: "button", evidence: [{ kind: "id", value: "buy" }] }, point: { x: 0.5, y: 0.25 }, fallback: { x: 0.5, y: 0.5 } } }
    ])
    const changed = apply(anchored, "change_representation", [{ _tag: "set-frame-representation", frameId: "frame_a", expectedChangedByChangeId: "change_create", representation: { ...representation, route: "/cart" } }])
    expect(changed.threads[0]?.anchor).toMatchObject({ representationChangedByChangeId: "change_create" })
    expect(() => decodeCanvasProjection(JSON.parse(JSON.stringify(changed)))).not.toThrow()
    expect(CanvasEngine.apply(changed, change("change_stale_anchor", [{ _tag: "add-comment-thread", threadId: "thread_b", commentId: "comment_y", body: "Stale", anchor: changed.threads[0]?.anchor }]), person)).toMatchObject({ _tag: "rejected", failure: { _tag: "precondition-failed", field: "anchor.representationChangedByChangeId" } })
  })

  it("deletes a Frame coherently while retaining every issued identity", () => {
    const created = apply(empty(), "change_create", [
      { _tag: "add-frame", frameId: "frame_a", title: "Frame", representation, status: "in-progress", geometry: geometry() },
      { _tag: "add-note", noteId: "note_a", text: "Attached", color: "blue", geometry: geometry(), attachedFrameId: "frame_a" },
      { _tag: "add-comment-thread", threadId: "thread_a", commentId: "comment_a", body: "Thread", anchor: { _tag: "frame", frameId: "frame_a", point: { x: 0, y: 1 } } }
    ])
    const removed = apply(created, "change_remove", [{ _tag: "remove-frame", frameId: "frame_a", expectedUpdatedByChangeId: "change_create" }])
    expect(removed).toMatchObject({ frames: [], threads: [], notes: [{ attachedFrameId: null, attachmentChangedByChangeId: "change_remove" }], issuedIds: { frameIds: ["frame_a"], noteIds: ["note_a"], threadIds: ["thread_a"], commentIds: ["comment_a"] } })
  })

  it("distinguishes Frame translation from resize for attached Note geometry", () => {
    const created = apply(empty(), "change_create", [
      { _tag: "add-frame", frameId: "frame_a", title: "Frame", representation, status: "in-progress", geometry: geometry(10, 20) },
      { _tag: "add-note", noteId: "note_a", text: "Note", color: "blue", geometry: geometry(30, 40), attachedFrameId: "frame_a" }
    ])
    const resized = apply(created, "change_resize", [{ _tag: "set-frame-geometry", frameId: "frame_a", expectedChangedByChangeId: "change_create", geometry: { x: 10, y: 20, width: 200, height: 160 } }])
    expect(resized.notes[0]).toMatchObject({ geometry: geometry(30, 40), geometryChangedByChangeId: "change_create" })
    const moved = apply(resized, "change_move", [{ _tag: "set-frame-geometry", frameId: "frame_a", expectedChangedByChangeId: "change_resize", geometry: { x: 15, y: 12, width: 200, height: 160 } }])
    expect(moved.notes[0]).toMatchObject({ geometry: geometry(35, 32), geometryChangedByChangeId: "change_move", updatedByChangeId: "change_move" })
  })

  it("rejects stale late comment edits atomically and preserves reply creation order", () => {
    const created = apply(empty(), "change_create", [
      { _tag: "add-frame", frameId: "frame_a", title: "Frame", representation, status: "in-progress", geometry: geometry() },
      { _tag: "add-comment-thread", threadId: "thread_a", commentId: "comment_z", body: "First", anchor: { _tag: "frame", frameId: "frame_a", point: { x: 0.5, y: 0.5 } } },
      { _tag: "reply-to-comment-thread", threadId: "thread_a", commentId: "comment_a", body: "Second" }
    ])
    expect(created.threads[0]?.comments.map(({ commentId }) => commentId)).toEqual(["comment_z", "comment_a"])
    const result = CanvasEngine.apply(created, change("change_edit", [
      { _tag: "edit-comment", threadId: "thread_a", commentId: "comment_z", expectedBody: "First", body: "Changed" },
      { _tag: "edit-comment", threadId: "thread_a", commentId: "comment_a", expectedBody: "Wrong", body: "Lost" }
    ]), person)
    expect(result).toMatchObject({ _tag: "rejected", failure: { _tag: "precondition-failed", commandIndex: 1 } })
    expect(created.threads[0]?.comments[0]?.body).toBe("First")
  })

  it("rejects duplicate and reused IDs in every namespace", () => {
    const created = apply(empty(), "change_create", [
      { _tag: "add-frame", frameId: "frame_a", title: "Frame", representation, status: "in-progress", geometry: geometry() },
      { _tag: "add-note", noteId: "note_a", text: "Note", color: "blue", geometry: geometry(), attachedFrameId: null },
      { _tag: "add-comment-thread", threadId: "thread_a", commentId: "comment_a", body: "First", anchor: { _tag: "frame", frameId: "frame_a", point: { x: 0.5, y: 0.5 } } }
    ])
    for (const command of [
      { _tag: "add-frame", frameId: "frame_a", title: "Again", representation, status: "in-progress", geometry: geometry() },
      { _tag: "add-note", noteId: "note_a", text: "Again", color: "blue", geometry: geometry(), attachedFrameId: null },
      { _tag: "add-comment-thread", threadId: "thread_a", commentId: "comment_b", body: "Again", anchor: { _tag: "frame", frameId: "frame_a", point: { x: 0.5, y: 0.5 } } },
      { _tag: "reply-to-comment-thread", threadId: "thread_a", commentId: "comment_a", body: "Again" }
    ]) expect(CanvasEngine.apply(created, change("change_duplicate", [command]), person)).toMatchObject({ _tag: "rejected", failure: { _tag: "id-already-issued" } })

    const removed = apply(created, "change_remove", [
      { _tag: "remove-note", noteId: "note_a", expectedUpdatedByChangeId: "change_create" },
      { _tag: "remove-frame", frameId: "frame_a", expectedUpdatedByChangeId: "change_create" }
    ])
    for (const command of [
      { _tag: "add-frame", frameId: "frame_a", title: "Again", representation, status: "in-progress", geometry: geometry() },
      { _tag: "add-note", noteId: "note_a", text: "Again", color: "blue", geometry: geometry(), attachedFrameId: null },
      { _tag: "add-comment-thread", threadId: "thread_a", commentId: "comment_b", body: "Again", anchor: { _tag: "frame", frameId: "frame_a", point: { x: 0.5, y: 0.5 } } },
      { _tag: "add-comment-thread", threadId: "thread_b", commentId: "comment_a", body: "Again", anchor: { _tag: "frame", frameId: "frame_a", point: { x: 0.5, y: 0.5 } } }
    ]) expect(CanvasEngine.apply(removed, change("change_reuse_all", [command]), person)).toMatchObject({ _tag: "rejected", failure: { _tag: "id-already-issued" } })
  })

  it("rejects duplicate stack entries, dangling threads, and duplicate comment IDs at projection decode", () => {
    const valid = apply(empty(), "change_create", [
      { _tag: "add-frame", frameId: "frame_a", title: "Frame", representation, status: "in-progress", geometry: geometry() },
      { _tag: "add-comment-thread", threadId: "thread_a", commentId: "comment_a", body: "First", anchor: { _tag: "frame", frameId: "frame_a", point: { x: 0.5, y: 0.5 } } }
    ])
    const thread = valid.threads[0]
    const item = valid.stack[0]
    if (thread === undefined || item === undefined) throw new Error("Fixture content is missing")
    const corruptions = [
      { ...valid, stack: [...valid.stack, item] },
      { ...valid, threads: [{ ...thread, anchor: { _tag: "frame", frameId: "frame_missing", point: { x: 0.5, y: 0.5 } } }] },
      { ...valid, threads: [{ ...thread, comments: [...thread.comments, thread.comments[0]] }] },
      { ...valid, threads: [{ ...thread, anchor: { _tag: "element", frameId: "frame_a", representationChangedByChangeId: "change_create", selector: "#x", fingerprint: { tagName: "button", evidence: [] }, point: { x: 0, y: 0 }, fallback: { x: 0, y: 0 } } }] }
    ]
    for (const value of corruptions) expect(() => decodeCanvasProjection(value)).toThrow()
  })

  it("replays mixed content deterministically and keeps provenance resolvable before and after acceptance", () => {
    const changes = [
      change("change_create", [{ _tag: "add-frame", frameId: "frame_a", title: "Frame", representation, status: "in-progress", geometry: geometry() }]),
      change("change_note", [{ _tag: "add-note", noteId: "note_a", text: "Note", color: "blue", geometry: geometry(), attachedFrameId: "frame_a" }]),
      change("change_edit", [{ _tag: "edit-note", noteId: "note_a", expectedText: "Note", text: "Edited" }])
    ]
    const pending = new Map([["change_edit", { state: "pending", actor: "agent-local" }]])
    const authored = changes.map((value) => engineChange(value, person))
    const first = CanvasEngine.replay(empty(), authored)
    assert(first._tag === "replayed")
    expect(pending.get(first.projection.notes[0]!.textChangedByChangeId)).toMatchObject({ state: "pending" })
    const accepted = new Map([["change_edit", { state: "accepted", actor: "agent-server" }]])
    expect(accepted.get(first.projection.notes[0]!.textChangedByChangeId)).toMatchObject({ state: "accepted" })
    expect(CanvasEngine.replay(empty(), authored)).toEqual(first)
  })

  it("uses one canonical code-point order for active and issued IDs", () => {
    const projection = apply(empty(), "change_order", [
      { _tag: "add-frame", frameId: "frame_a_b", title: "Underscore", representation, status: "in-progress", geometry: geometry() },
      { _tag: "add-frame", frameId: "frame_a-b", title: "Hyphen", representation, status: "in-progress", geometry: geometry() }
    ])
    expect(projection.frames.map(({ frameId }) => frameId)).toEqual(["frame_a-b", "frame_a_b"])
    expect(projection.issuedIds.frameIds).toEqual(["frame_a-b", "frame_a_b"])
    expect(() => decodeCanvasProjection(JSON.parse(JSON.stringify(projection)))).not.toThrow()
  })

  it("rejects non-finite derived Note translation atomically", () => {
    const created = apply(empty(), "change_create", [
      { _tag: "add-frame", frameId: "frame_a", title: "Frame", representation, status: "in-progress", geometry: geometry(Number.MAX_VALUE, Number.MAX_VALUE) },
      { _tag: "add-note", noteId: "note_a", text: "Note", color: "blue", geometry: geometry(Number.MAX_VALUE, -Number.MAX_VALUE), attachedFrameId: "frame_a" }
    ])
    const result = CanvasEngine.apply(created, change("change_overflow", [
      { _tag: "set-frame-geometry", frameId: "frame_a", expectedChangedByChangeId: "change_create", geometry: geometry(-Number.MAX_VALUE, -Number.MAX_VALUE) }
    ]), person)
    expect(result).toMatchObject({ _tag: "rejected", failure: { _tag: "derived-geometry-invalid", commandIndex: 0, noteId: "note_a" } })
    expect(created.frames[0]?.geometry.x).toBe(Number.MAX_VALUE)
    expect(created.notes[0]?.geometry).toMatchObject({ x: Number.MAX_VALUE, y: -Number.MAX_VALUE })
    expect(() => decodeCanvasProjection(JSON.parse(JSON.stringify(created)))).not.toThrow()
  })

  it("treats representation state object key order as semantically irrelevant", () => {
    const initialRepresentation = { ...representation, state: { actor: "npc", source: "checkout" } }
    const equivalentRepresentation = { ...representation, state: { source: "checkout", actor: "npc" } }
    const created = apply(empty(), "change_create", [{ _tag: "add-frame", frameId: "frame_a", title: "Frame", representation: initialRepresentation, status: "in-progress", geometry: geometry() }])
    const result = CanvasEngine.apply(created, change("change_noop", [{ _tag: "set-frame-representation", frameId: "frame_a", expectedChangedByChangeId: "change_create", representation: equivalentRepresentation }]), person)
    expect(result).toEqual({ _tag: "applied", projection: created })
    if (result._tag === "applied") expect(result.projection).toBe(created)
    expect(created.frames[0]).toMatchObject({ representationChangedByChangeId: "change_create", updatedByChangeId: "change_create" })
  })

  it("stamps Note and Comment authors from the change Actor and keeps them on edit", () => {
    const created = apply(empty(), "change_create", [
      { _tag: "add-frame", frameId: "frame_a", title: "Frame", representation, status: "in-progress", geometry: geometry() },
      { _tag: "add-note", noteId: "note_a", text: "Note", color: "blue", geometry: geometry(), attachedFrameId: null },
      { _tag: "add-comment-thread", threadId: "thread_a", commentId: "comment_a", body: "First", anchor: { _tag: "frame", frameId: "frame_a", point: { x: 0.5, y: 0.5 } } }
    ], agent)
    expect(created.notes[0]?.author).toEqual(agent)
    expect(created.threads[0]?.comments[0]?.author).toEqual(agent)
    const edited = apply(created, "change_edit", [
      { _tag: "edit-note", noteId: "note_a", expectedText: "Note", text: "Edited" },
      { _tag: "reply-to-comment-thread", threadId: "thread_a", commentId: "comment_b", body: "Second" },
      { _tag: "edit-comment", threadId: "thread_a", commentId: "comment_a", expectedBody: "First", body: "Changed" }
    ], person)
    expect(edited.notes[0]).toMatchObject({ author: agent, text: "Edited" })
    expect(edited.threads[0]?.comments[0]).toMatchObject({ author: agent, body: "Changed" })
    expect(edited.threads[0]?.comments[1]).toMatchObject({ author: person, body: "Second" })
  })

  it("requires a Note Color and changes it through a preconditioned command", () => {
    expect(() => change("change_missing", [{ _tag: "add-note", noteId: "note_a", text: "Note", geometry: geometry(), attachedFrameId: null }])).toThrow()
    expect(() => change("change_invalid", [{ _tag: "add-note", noteId: "note_a", text: "Note", color: "pink", geometry: geometry(), attachedFrameId: null }])).toThrow()
    const created = apply(empty(), "change_create", [{ _tag: "add-note", noteId: "note_a", text: "Note", color: "blue", geometry: geometry(), attachedFrameId: null }])
    expect(created.notes[0]).toMatchObject({ color: "blue", colorChangedByChangeId: "change_create" })
    const stale = CanvasEngine.apply(created, change("change_stale", [
      { _tag: "set-note-color", noteId: "note_a", expectedChangedByChangeId: "change_other", color: "green" }
    ]), person)
    expect(stale).toMatchObject({ _tag: "rejected", failure: { _tag: "precondition-failed", field: "colorChangedByChangeId" } })
    const colored = apply(created, "change_color", [{ _tag: "set-note-color", noteId: "note_a", expectedChangedByChangeId: "change_create", color: "green" }])
    expect(colored.notes[0]).toMatchObject({ color: "green", colorChangedByChangeId: "change_color", author: person })
    const noop = apply(colored, "change_same", [{ _tag: "set-note-color", noteId: "note_a", expectedChangedByChangeId: "change_color", color: "green" }])
    expect(noop).toBe(colored)
  })
})
