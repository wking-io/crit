import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import {
  CanvasArrangement,
  CanvasArrangementUnavailable,
  type CanvasArrangementItem
} from "../../src/react/canvas-arrangement.js"

const item = (
  id: string,
  x: number,
  y: number,
  width = 20,
  height = 20
): CanvasArrangementItem => ({ id, x, y, width, height })

const plan = (input: Parameters<typeof CanvasArrangement.plan>[0]) =>
  Effect.runSync(CanvasArrangement.plan(input))

describe("CanvasArrangement", () => {
  it("aligns every edge and center against the collective bounds", () => {
    const items = [item("a", 10, 20, 20, 40), item("b", 80, 100, 40, 20)]
    const positions = (alignment: "left" | "horizontal-center" | "right" | "top" | "vertical-center" | "bottom") =>
      plan({ operation: { _tag: "Align", alignment }, items }).moves

    expect(positions("left")).toEqual([
      { id: "a", x: 10, y: 20 }, { id: "b", x: 10, y: 100 }
    ])
    expect(positions("horizontal-center")).toEqual([
      { id: "a", x: 55, y: 20 }, { id: "b", x: 45, y: 100 }
    ])
    expect(positions("right")).toEqual([
      { id: "a", x: 100, y: 20 }, { id: "b", x: 80, y: 100 }
    ])
    expect(positions("top")).toEqual([
      { id: "a", x: 10, y: 20 }, { id: "b", x: 80, y: 20 }
    ])
    expect(positions("vertical-center")).toEqual([
      { id: "a", x: 10, y: 50 }, { id: "b", x: 80, y: 60 }
    ])
    expect(positions("bottom")).toEqual([
      { id: "a", x: 10, y: 80 }, { id: "b", x: 80, y: 100 }
    ])
  })

  it("preserves outer objects and equalizes edge-to-edge gaps", () => {
    const horizontal = plan({
      operation: { _tag: "Distribute", axis: "horizontal" },
      items: [item("right", 180, 10, 20), item("left", 0, 40, 40), item("middle", 50, 80, 20)]
    }).moves
    expect(horizontal).toEqual([
      { id: "left", x: 0, y: 40 },
      { id: "middle", x: 100, y: 80 },
      { id: "right", x: 180, y: 10 }
    ])

    const vertical = plan({
      operation: { _tag: "Distribute", axis: "vertical" },
      items: [item("bottom", 10, 180, 20, 20), item("top", 40, 0, 20, 40), item("middle", 80, 50, 20, 20)]
    }).moves
    expect(vertical).toEqual([
      { id: "top", x: 40, y: 0 },
      { id: "middle", x: 80, y: 100 },
      { id: "bottom", x: 10, y: 180 }
    ])
  })

  it("chooses a deterministic balanced grid and keeps mixed sizes from overlapping", () => {
    const moves = plan({
      operation: { _tag: "ArrangeGrid" },
      items: [
        item("d", 90, 90, 30, 20),
        item("a", 0, 0, 20, 30),
        item("c", 0, 90, 20, 20),
        item("b", 90, 0, 40, 20)
      ]
    }).moves

    expect(moves).toEqual([
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 90, y: 5 },
      { id: "c", x: 0, y: 90 },
      { id: "d", x: 95, y: 90 }
    ])
  })

  it("expands a grid around the selection center when its items cannot fit", () => {
    const moves = plan({
      operation: { _tag: "ArrangeGrid" },
      items: [
        item("a", 0, 0, 100, 100),
        item("b", 10, 0, 100, 100),
        item("c", 0, 10, 100, 100),
        item("d", 10, 10, 100, 100)
      ]
    }).moves

    expect(moves).toEqual([
      { id: "a", x: -45, y: -45 },
      { id: "b", x: 55, y: -45 },
      { id: "c", x: -45, y: 55 },
      { id: "d", x: 55, y: 55 }
    ])
  })

  it("reports invalid requests through its typed interface", () => {
    const failure = Effect.runSync(Effect.flip(CanvasArrangement.plan({
      operation: { _tag: "Distribute", axis: "horizontal" },
      items: [item("a", 0, 0), item("b", 20, 0)]
    })))

    expect(failure).toBeInstanceOf(CanvasArrangementUnavailable)
    expect(failure.reason).toBe("insufficient-items")
  })
})
