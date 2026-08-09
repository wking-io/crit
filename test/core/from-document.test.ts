import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { Canvas, CanvasCommand } from "../../src/core/index.js"

const exportWithFrame = () => {
  const canvas = Canvas.create({ id: "review", title: "Review" })
  Effect.runSync(
    Canvas.apply(
      canvas,
      CanvasCommand.addFrame({
        id: "candidate",
        url: "https://checkout.localhost/v1",
        title: "Candidate",
        provenance: { kind: "manual", sourceId: "review:candidate" }
      }),
      CanvasCommand.addNote({
        id: "note",
        text: "Tighten the spacing",
        x: 10,
        y: 20,
        width: 280,
        height: 160
      })
    )
  )
  return Canvas.export(canvas)
}

describe("Canvas.fromDocument", () => {
  it("reopens a trusted document without an error channel", () => {
    const document = exportWithFrame()

    const reopened = Canvas.fromDocument(document)

    expect(Canvas.export(reopened)).toEqual(document)
  })

  it("does not share state with the document it was opened from", () => {
    const document = exportWithFrame()
    const reopened = Canvas.fromDocument(document)

    Effect.runSync(
      Canvas.apply(
        reopened,
        CanvasCommand.addFrame({
          id: "candidate-v2",
          url: "https://checkout.localhost/v2",
          title: "Candidate v2",
          provenance: { kind: "manual", sourceId: "review:candidate-v2" }
        })
      )
    )

    expect(document.frames).toHaveLength(1)
    expect(Canvas.listFrames(reopened)).toHaveLength(2)
  })

  it("treats an invariant violation as a defect, not an error", () => {
    const document = exportWithFrame()
    const corrupted = { ...document, frames: [...document.frames, ...document.frames] }

    expect(() => Canvas.fromDocument(corrupted)).toThrow(
      "Duplicate Canvas item ID: candidate"
    )
  })

  it("renders open-failure messages from the errors themselves", () => {
    const document = exportWithFrame()

    const openFailure = Effect.runSync(
      Effect.flip(
        Canvas.open("review", {
          ...document,
          frames: [...document.frames, ...document.frames]
        })
      )
    )
    expect(openFailure.message).toBe("Duplicate Canvas item ID: candidate")

    const tooLarge = Effect.runSync(
      Effect.flip(
        Canvas.open("review", { ...document, title: "x".repeat(10_000_001) })
      )
    )
    expect(tooLarge.message).toMatch(
      /^Canvas Document is \d+ bytes; maximum is 10000000$/
    )
  })
})
