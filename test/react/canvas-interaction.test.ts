import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import { Canvas, CanvasCommand } from "../../src/core/index.js"
import {
  beginCanvasInteraction,
  canvasDragDelta,
  canvasEdgePanVelocity,
  captureCanvasInteractionPointer
} from "../../src/react/canvas-interaction.js"

const reviewDocument = async () => {
  const canvas = Canvas.create({ id: "review", title: "Review", owner: { id: "git:test", name: "Test Author" } })
  await Effect.runPromise(
    Canvas.apply(
      canvas,
      CanvasCommand.addFrame({
        id: "candidate",
        url: "/candidate",
        title: "Candidate",
        provenance: { kind: "manual", sourceId: "test" }
      }),
      CanvasCommand.moveFrame({ id: "candidate", x: 100, y: 100 }),
      CanvasCommand.resizeFrame({ id: "candidate", width: 600, height: 400 }),
      CanvasCommand.addNote({
        id: "attached",
        text: "Attached",
        author: { id: "author", name: "Test Author" },
        x: 150,
        y: 150,
        width: 200,
        height: 120
      }),
      CanvasCommand.attachNote({ id: "attached", frameId: "candidate" }),
      CanvasCommand.addNote({
        id: "loose",
        text: "Loose",
        author: { id: "author", name: "Test Author" },
        x: 900,
        y: 500,
        width: 200,
        height: 120
      })
    )
  )
  return Canvas.export(canvas)
}

describe("Canvas interaction rules", () => {
  it("ramps camera panning toward each viewport edge", () => {
    const bounds = { left: 100, top: 50, right: 900, bottom: 650 }

    expect(canvasEdgePanVelocity({ x: 500, y: 350 }, bounds)).toEqual({ x: 0, y: 0 })
    expect(canvasEdgePanVelocity({ x: 140, y: 90 }, bounds)).toEqual({ x: 450, y: 450 })
    expect(canvasEdgePanVelocity({ x: 860, y: 610 }, bounds)).toEqual({ x: -450, y: -450 })
    expect(canvasEdgePanVelocity({ x: 50, y: 700 }, bounds)).toEqual({ x: 900, y: -900 })
  })

  it("keeps a dragged item under a stationary pointer while the camera pans", () => {
    expect(canvasDragDelta({
      pointer: { x: 860, y: 400 },
      startPointer: { x: 800, y: 400 },
      camera: { x: -40, y: 70 },
      startCamera: { x: 20, y: 40 },
      zoom: 0.5
    })).toEqual({ x: 240, y: -60 })
  })

  it("captures the initiating pointer so iframe boundaries cannot interrupt a drag", () => {
    const captured: Array<number> = []

    captureCanvasInteractionPointer({
      pointerId: 17,
      currentTarget: {
        setPointerCapture: (pointerId) => captured.push(pointerId)
      }
    })

    expect(captured).toEqual([17])
  })

  it("anchors the opposite edge while resizing from every direction", async () => {
    const document = await reviewDocument()
    const frame = document.frames.find((item) => item.id === "candidate")!
    const previewAt = (
      handle: "north-west" | "south-east" | "west",
      x: number,
      y: number
    ) => beginCanvasInteraction({
      document,
      itemId: frame.id,
      startGeometry: frame.geometry,
      kind: { type: "resize", handle }
    }).preview({ x, y }).candidate

    expect(previewAt("north-west", 50, 40)).toEqual({
      x: 150,
      y: 140,
      width: 550,
      height: 360
    })
    expect(previewAt("south-east", 50, 40)).toEqual({
      x: 100,
      y: 100,
      width: 650,
      height: 440
    })
    expect(previewAt("west", 500, 0)).toEqual({
      x: 520,
      y: 100,
      width: 180,
      height: 400
    })
  })

  it("previews attached Notes with a moving Frame and commits one command", async () => {
    const document = await reviewDocument()
    const frame = document.frames[0]!
    const interaction = beginCanvasInteraction({
      document,
      itemId: frame.id,
      startGeometry: frame.geometry,
      kind: { type: "move" }
    })

    const preview = interaction.preview({ x: 40, y: -20 })
    const commands = interaction.finish({ x: 40, y: -20 })

    expect(interaction.affectedIds).toEqual(["candidate", "attached"])
    expect(preview.candidate).toMatchObject({ x: 140, y: 80 })
    expect(preview.attached).toMatchObject({ x: 190, y: 130 })
    expect(commands).toEqual([
      { _tag: "MoveFrame", id: "candidate", x: 140, y: 80 }
    ])
  })

  it("attaches and detaches Notes according to their final center", async () => {
    const document = await reviewDocument()
    const loose = document.notes.find((note) => note.id === "loose")!
    const attached = document.notes.find((note) => note.id === "attached")!
    const attach = beginCanvasInteraction({
      document,
      itemId: loose.id,
      startGeometry: loose.geometry,
      kind: { type: "move" }
    }).finish({ x: -650, y: -300 })
    const detach = beginCanvasInteraction({
      document,
      itemId: attached.id,
      startGeometry: attached.geometry,
      kind: { type: "move" }
    }).finish({ x: 800, y: 500 })

    expect(attach.map((command) => command._tag)).toEqual([
      "MoveNote",
      "AttachNote"
    ])
    expect(attach[1]).toMatchObject({ frameId: "candidate" })
    expect(detach.map((command) => command._tag)).toEqual([
      "MoveNote",
      "DetachNote"
    ])
  })

  it("resets fit-page Frames and emits move plus resize from anchored edges", async () => {
    const source = await reviewDocument()
    const document = {
      ...source,
      frames: source.frames.map((frame) => ({
        ...frame,
        display: { heightMode: "fit-page" as const }
      }))
    }
    const frame = document.frames[0]!
    const interaction = beginCanvasInteraction({
      document,
      itemId: frame.id,
      startGeometry: frame.geometry,
      kind: { type: "resize", handle: "north-west" }
    })

    const preview = interaction.preview({ x: 50, y: 40 })
    const commands = interaction.finish({ x: 50, y: 40 })

    expect(preview.candidate).toEqual({
      x: 150,
      y: 140,
      width: 550,
      height: 360
    })
    expect(preview.attached).toMatchObject({ x: 200, y: 190 })
    expect(commands.map((command) => command._tag)).toEqual([
      "UpdateFrame",
      "MoveFrame",
      "ResizeFrame"
    ])
  })
})
