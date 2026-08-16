import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import {
  frameRemovalConfirmationDetails,
  noteRemovalConfirmationDetails
} from "../../src/react/canvas-viewport.js"
import {
  confirmedEffect
} from "../../src/react/confirmation-dialog.js"

const details = {
  confirmLabel: "Delete frame",
  description: "This cannot be undone.",
  title: "Delete frame?"
}

describe("confirmation effects", () => {
  it("does not dispatch or clear selection when cancelled", async () => {
    let dispatches = 0
    let selectionClears = 0
    const effect = confirmedEffect(
      async () => false,
      details,
      () => {
        dispatches += 1
        return Effect.sync(() => {
          selectionClears += 1
        })
      }
    )

    expect(dispatches).toBe(0)
    await Effect.runPromise(effect)
    expect(dispatches).toBe(0)
    expect(selectionClears).toBe(0)
  })

  it("dispatches and clears selection exactly once when confirmed", async () => {
    let dispatches = 0
    let selectionClears = 0
    await Effect.runPromise(confirmedEffect(
      async () => true,
      details,
      () => {
        dispatches += 1
        return Effect.sync(() => {
          selectionClears += 1
        })
      }
    ))

    expect(dispatches).toBe(1)
    expect(selectionClears).toBe(1)
  })
})

describe("frame removal confirmation copy", () => {
  it("names a single frame", () => {
    expect(frameRemovalConfirmationDetails([{ title: "Candidate" }]))
      .toEqual({
        confirmLabel: "Delete frame",
        description: "This frame will be removed from the canvas. This cannot be undone.",
        title: "Delete “Candidate”?"
      })
  })

  it("includes the selected frame count", () => {
    expect(frameRemovalConfirmationDetails([
      { title: "One" },
      { title: "Two" },
      { title: "Three" }
    ])).toEqual({
      confirmLabel: "Delete 3 frames",
      description: "The 3 selected frames will be removed from the canvas. This cannot be undone.",
      title: "Delete 3 frames?"
    })
  })
})

describe("note removal confirmation copy", () => {
  it("describes the irreversible note removal", () => {
    expect(noteRemovalConfirmationDetails).toEqual({
      confirmLabel: "Delete note",
      description: "This note will be removed from the canvas. This cannot be undone.",
      title: "Delete note?"
    })
  })
})
