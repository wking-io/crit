import { Effect, Predicate } from "effect"
import { describe, expect, it } from "vitest"

import { Canvas, CanvasCommand } from "../../src/core/index.js"
import {
  FRAME_SIZE_PRESETS,
  completeFrameBreakpointSet,
  duplicateFrameAtPreset
} from "../../src/react/frame-breakpoints.js"

const reviewCanvas = async () => {
  const canvas = Canvas.create({
    id: "responsive-review",
    title: "Responsive review",
    owner: { id: "git:test", name: "Test Author" }
  })
  await Effect.runPromise(Canvas.apply(
    canvas,
    CanvasCommand.addFrame({
      id: "checkout",
      url: "https://shop.example/checkout",
      title: "Checkout",
      status: "ready-for-review",
      provenance: { kind: "manual", sourceId: "test" }
    }),
    CanvasCommand.moveFrame({ id: "checkout", x: 1_000, y: 100 }),
    CanvasCommand.resizeFrame({ id: "checkout", width: 1_280, height: 832 })
  ))
  return canvas
}

describe("Frame breakpoint duplication", () => {
  it("shows one live URL at every missing preset around the source in size order", async () => {
    const canvas = await reviewCanvas()
    let sequence = 0
    const commands = completeFrameBreakpointSet({
      document: Canvas.export(canvas),
      sourceId: "checkout",
      createId: () => `copy-${++sequence}`
    })

    await Effect.runPromise(Canvas.apply(canvas, ...commands))
    const frames = [...Canvas.listFrames(canvas)].sort(
      (left, right) => left.geometry.width - right.geometry.width
    )

    expect(frames.map((frame) => ({
      width: frame.geometry.width,
      height: frame.geometry.height,
      x: frame.geometry.x
    }))).toEqual([
      { width: 402, height: 874, x: -314 },
      { width: 832, height: 1194, x: 128 },
      { width: 1280, height: 832, x: 1000 },
      { width: 1512, height: 982, x: 2320 },
      { width: 2560, height: 1440, x: 3872 }
    ])
    expect(frames.every((frame) => frame.url === "https://shop.example/checkout")).toBe(true)
    expect(frames.every((frame) => frame.title === "Checkout")).toBe(true)
    expect(frames.every((frame) => frame.status === "ready-for-review")).toBe(true)
  })

  it("does not recreate same-URL preset Frames when completing a set", async () => {
    const canvas = await reviewCanvas()
    await Effect.runPromise(Canvas.apply(
      canvas,
      CanvasCommand.addFrame({
        id: "existing-mobile",
        url: "https://shop.example/checkout#details",
        title: "Existing mobile",
        provenance: { kind: "manual", sourceId: "test" }
      }),
      CanvasCommand.resizeFrame({ id: "existing-mobile", width: 402, height: 874 })
    ))
    let sequence = 0

    const commands = completeFrameBreakpointSet({
      document: Canvas.export(canvas),
      sourceId: "checkout",
      createId: () => `copy-${++sequence}`
    })

    expect(commands.filter(Predicate.isTagged("AddFrame"))).toHaveLength(3)
    expect(commands.some((command) =>
      Predicate.isTagged(command, "ResizeFrame") && "width" in command && command.width === 402
    )).toBe(false)
  })

  it("preserves a custom-sized source and adds all five presets", async () => {
    const canvas = await reviewCanvas()
    await Effect.runPromise(Canvas.apply(
      canvas,
      CanvasCommand.resizeFrame({ id: "checkout", width: 1000, height: 700 })
    ))

    const commands = completeFrameBreakpointSet({
      document: Canvas.export(canvas),
      sourceId: "checkout",
      createId: (() => { let id = 0; return () => `copy-${++id}` })()
    })
    await Effect.runPromise(Canvas.apply(canvas, ...commands))

    expect(Canvas.listFrames(canvas)).toHaveLength(6)
    expect(Canvas.listFrames(canvas).some((frame) =>
      frame.id === "checkout" &&
      frame.geometry.width === 1000 &&
      frame.geometry.height === 700
    )).toBe(true)
    for (const preset of FRAME_SIZE_PRESETS) {
      expect(Canvas.listFrames(canvas).some((frame) =>
        frame.geometry.width === preset.width &&
        frame.geometry.height === preset.height
      )).toBe(true)
    }
  })

  it("pushes colliding Frames and their attached Notes outward", async () => {
    const canvas = await reviewCanvas()
    await Effect.runPromise(Canvas.apply(
      canvas,
      CanvasCommand.addFrame({
        id: "right-blocker",
        url: "https://other.example",
        title: "Other",
        provenance: { kind: "manual", sourceId: "test" }
      }),
      CanvasCommand.moveFrame({ id: "right-blocker", x: 2_400, y: 120 }),
      CanvasCommand.resizeFrame({ id: "right-blocker", width: 900, height: 700 }),
      CanvasCommand.addNote({
        id: "attached",
        text: "Attached",
        author: { id: "git:test", name: "Test Author" },
        x: 2_500,
        y: 200
      }),
      CanvasCommand.attachNote({ id: "attached", frameId: "right-blocker" })
    ))

    const commands = completeFrameBreakpointSet({
      document: Canvas.export(canvas),
      sourceId: "checkout",
      createId: (() => { let id = 0; return () => `copy-${++id}` })()
    })
    await Effect.runPromise(Canvas.apply(canvas, ...commands))

    const blocker = Canvas.listFrames(canvas).find((frame) => frame.id === "right-blocker")!
    const note = Canvas.listNotes(canvas).find((item) => item.id === "attached")!
    expect(blocker.geometry.x).toBe(6472)
    expect(note.geometry.x).toBe(6572)
  })

  it("duplicates an equal-width custom Frame to the right", async () => {
    const canvas = await reviewCanvas()
    await Effect.runPromise(Canvas.apply(
      canvas,
      CanvasCommand.resizeFrame({ id: "checkout", width: 402, height: 700 })
    ))
    const mobile = FRAME_SIZE_PRESETS[0]!

    const commands = duplicateFrameAtPreset({
      document: Canvas.export(canvas),
      sourceId: "checkout",
      preset: mobile,
      createId: () => "mobile-copy"
    })
    await Effect.runPromise(Canvas.apply(canvas, ...commands))

    expect(Canvas.listFrames(canvas).find((frame) => frame.id === "mobile-copy")?.geometry)
      .toEqual({ x: 1442, y: 100, width: 402, height: 874 })
  })
})
