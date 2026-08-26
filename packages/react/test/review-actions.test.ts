import { decodeCanvasProjection } from "@crit/domain"
import { describe, expect, it } from "vitest"

import { CanvasSelection } from "../src/canvas-selection.js"
import {
  ReviewActionInput,
  availableReviewActions,
  resolveReviewAction,
  reviewActionPolicies,
  type ReviewActionContext,
  type ReviewActionId,
  type ReviewSelection
} from "../src/review-actions.js"

const policyById = (id: ReviewActionId) => {
  const policy = reviewActionPolicies.find((entry) => entry.id === id)
  if (policy === undefined) throw new Error(`Missing policy: ${id}`)
  return policy
}

const projection = decodeCanvasProjection({
  schemaVersion: 3,
  canvasId: "canvas_review",
  title: "Review",
  frames: [
    {
      frameId: "frame_a",
      title: "Alpha",
      representation: { _tag: "webUrl", url: "https://example.com/a" },
      status: "in-progress",
      geometry: { x: 10, y: 20, width: 100, height: 80 },
      createdByChangeId: "change_1",
      updatedByChangeId: "change_1",
      titleChangedByChangeId: "change_1",
      representationChangedByChangeId: "change_1",
      statusChangedByChangeId: "change_1",
      geometryChangedByChangeId: "change_1"
    },
    {
      frameId: "frame_b",
      title: "Beta",
      representation: {
        _tag: "artifact",
        artifactId: "artifact_beta",
        digest: `sha256:${"0".repeat(64)}`
      },
      status: "approved",
      geometry: { x: 200, y: 100, width: 120, height: 90 },
      createdByChangeId: "change_1",
      updatedByChangeId: "change_1",
      titleChangedByChangeId: "change_1",
      representationChangedByChangeId: "change_1",
      statusChangedByChangeId: "change_1",
      geometryChangedByChangeId: "change_1"
    }
  ],
  stack: [
    { _tag: "frame", frameId: "frame_a" },
    { _tag: "frame", frameId: "frame_b" }
  ],
  stackChangedByChangeId: "change_1",
  issuedIds: {
    frameIds: ["frame_a", "frame_b"]
  }
})

const itemSelection = (
  items: Parameters<typeof CanvasSelection.make>[0]
): ReviewSelection => ({ _tag: "items", items: CanvasSelection.make(items) })

const context = (
  selection: ReviewSelection,
  input: ReviewActionContext["input"] = ReviewActionInput.none()
): ReviewActionContext => ({
  projection,
  selection,
  input,
  fullscreen: false
})

const commandsFor = (
  id: ReviewActionId,
  actionContext: ReviewActionContext
) => {
  const action = resolveReviewAction(id, actionContext)
  if (action?._tag !== "batch") throw new Error(`Expected ${id} batch`)
  return action.commands
}

describe("review actions", () => {
  it("lists policies available for the current selection", () => {
    const selection = itemSelection([{ _tag: "frame", frameId: "frame_a" }])
    const ids = availableReviewActions({ projection, selection })
      .map((entry) => entry.id)

    expect(ids).toContain("remove")
    expect(ids).toContain("set-frame-status-approved")
    expect(ids).not.toContain("set-frame-status-in-progress")
    const none = availableReviewActions({
      projection,
      selection: itemSelection([])
    }).map((entry) => entry.id)
    expect(none).not.toContain("set-frame-status-approved")
    expect(none).not.toContain("set-frame-status-changes-requested")
    expect(none).not.toContain("enter-fullscreen")
  })

  it("builds mutation batches for status, title, remove, and stacking", () => {
    const frame = context(itemSelection([
      { _tag: "frame", frameId: "frame_a" }
    ]))

    expect(commandsFor("set-frame-status-approved", frame)).toEqual([{
      _tag: "setFrameStatus",
      frameId: "frame_a",
      expectedChangedByChangeId: "change_1",
      status: "approved"
    }])
    expect(commandsFor("set-frame-title", {
      ...frame,
      input: { _tag: "text", text: "Updated" }
    })).toEqual([{
      _tag: "setFrameTitle",
      frameId: "frame_a",
      expectedChangedByChangeId: "change_1",
      title: "Updated"
    }])
    expect(commandsFor("remove", frame)).toEqual([{
      _tag: "removeFrame",
      frameId: "frame_a",
      expectedUpdatedByChangeId: "change_1"
    }])
    expect(commandsFor("bring-to-front", frame)).toEqual([{
      _tag: "placeCanvasItem",
      item: { _tag: "frame", frameId: "frame_a" },
      after: { _tag: "frame", frameId: "frame_b" },
      expectedStackChangeId: "change_1"
    }])
  })

  it("keeps add-frame out of the review policy table", () => {
    expect(reviewActionPolicies.map((entry) => entry.id)).not.toContain("add-frame")
  })

  it("snapshots only selected live Frames", () => {
    const live = itemSelection([{ _tag: "frame", frameId: "frame_a" }])
    const artifact = itemSelection([{ _tag: "frame", frameId: "frame_b" }])
    const mixed = itemSelection([
      { _tag: "frame", frameId: "frame_a" },
      { _tag: "frame", frameId: "frame_b" }
    ])

    expect(policyById("snapshot").available(live, projection)).toBe(true)
    expect(policyById("snapshot").available(itemSelection([]), projection)).toBe(false)
    expect(policyById("snapshot").available(artifact, projection)).toBe(false)
    expect(resolveReviewAction("snapshot", context(mixed))).toEqual({
      _tag: "snapshot",
      request: [{
        title: "Alpha",
        status: "in-progress",
        geometry: { x: 10, y: 20, width: 100, height: 80 },
        representation: { _tag: "webUrl", url: "https://example.com/a" }
      }]
    })
    expect(resolveReviewAction("snapshot", context(mixed))?._tag).not.toBe("batch")
  })

  it("binds review shortcuts from the table", () => {
    expect(policyById("remove").shortcuts).toEqual(["Delete", "Backspace"])
    expect(policyById("exit-fullscreen").shortcuts).toEqual(["Escape"])
    expect(policyById("enter-fullscreen").shortcuts).toEqual(["F"])
    expect(policyById("open-url").shortcuts).toEqual(["O"])
    expect(policyById("snapshot").shortcuts).toEqual(["S"])
    expect(policyById("copy-node-id").shortcuts).toEqual(["Mod+Shift+C"])
    expect(policyById("bring-to-front").shortcuts).toEqual(["Mod+]"])
    expect(policyById("send-to-back").shortcuts).toEqual(["Mod+["])
    expect(policyById("set-frame-status-in-progress").shortcuts).toEqual(["1"])
    expect(policyById("set-frame-status-ready-for-review").shortcuts).toEqual(["2"])
    expect(policyById("set-frame-status-changes-requested").shortcuts).toEqual(["3"])
    expect(policyById("set-frame-status-approved").shortcuts).toEqual(["4"])
    expect(policyById("align-top").shortcuts).toEqual(["Alt+W"])
    expect(policyById("align-bottom").shortcuts).toEqual(["Alt+S"])
    expect(policyById("align-left").shortcuts).toEqual(["Alt+A"])
    expect(policyById("align-right").shortcuts).toEqual(["Alt+D"])
    expect(policyById("align-vertical-center").shortcuts).toEqual(["Alt+V"])
    expect(policyById("align-horizontal-center").shortcuts).toEqual(["Alt+H"])
    expect(policyById("distribute-horizontal").shortcuts).toEqual(["Control+Alt+H"])
    expect(policyById("distribute-vertical").shortcuts).toEqual(["Control+Alt+V"])
    expect(policyById("arrange-grid").shortcuts).toEqual(["Alt+G"])
  })

  it("resolves a policy that has no shortcuts", () => {
    const frame = context(itemSelection([
      { _tag: "frame", frameId: "frame_a" }
    ]))
    expect(policyById("rename-canvas").shortcuts).toEqual([])
    expect(resolveReviewAction("copy-node-id", frame)).toEqual({
      _tag: "effect",
      effect: { _tag: "copy", text: "frame_a" }
    })
  })

  it("maps arrangement and breakpoint plans onto geometry commands", () => {
    const frames = context(itemSelection([
      { _tag: "frame", frameId: "frame_a" },
      { _tag: "frame", frameId: "frame_b" }
    ]))
    expect(commandsFor("align-left", frames)).toEqual([
      {
        _tag: "setFrameGeometry",
        frameId: "frame_a",
        expectedChangedByChangeId: "change_1",
        geometry: { x: 10, y: 20, width: 100, height: 80 }
      },
      {
        _tag: "setFrameGeometry",
        frameId: "frame_b",
        expectedChangedByChangeId: "change_1",
        geometry: { x: 10, y: 100, width: 120, height: 90 }
      }
    ])

    const frame = context(itemSelection([
      { _tag: "frame", frameId: "frame_a" }
    ]))
    expect(commandsFor("resize-frame-mobile", frame)).toEqual([{
      _tag: "setFrameGeometry",
      frameId: "frame_a",
      expectedChangedByChangeId: "change_1",
      geometry: { x: 10, y: 20, width: 402, height: 874 }
    }])
  })

  it("resolves browser-only actions without command batches", () => {
    const frame = context(itemSelection([
      { _tag: "frame", frameId: "frame_a" }
    ]))
    expect(resolveReviewAction("open-url", frame)).toEqual({
      _tag: "effect",
      effect: { _tag: "openUrl", url: "https://example.com/a" }
    })
    expect(resolveReviewAction("copy-node-id", frame)).toEqual({
      _tag: "effect",
      effect: { _tag: "copy", text: "frame_a" }
    })
  })

  it("sets status on every selected Frame that is not already that status", () => {
    const frames = context(itemSelection([
      { _tag: "frame", frameId: "frame_a" },
      { _tag: "frame", frameId: "frame_b" }
    ]))
    expect(commandsFor("set-frame-status-approved", frames)).toEqual([{
      _tag: "setFrameStatus",
      frameId: "frame_a",
      expectedChangedByChangeId: "change_1",
      status: "approved"
    }])
    expect(reviewActionPolicies.map((entry) => entry.id))
      .not.toContain("toggle-pause-offscreen")
  })

})
