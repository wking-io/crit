import { describe, expect, it } from "vitest"

import {
  NOTE_CARD_HEIGHT,
  NOTE_CARD_WIDTH,
  measureNoteTextareaHeight,
  notePlacementOrigin,
  notePresentedSize
} from "../../src/react/note-presentation.js"

describe("Note presentation", () => {
  it("keeps a fixed 42-character width and grows height from the text", () => {
    expect(NOTE_CARD_WIDTH).toBe(332)
    expect(NOTE_CARD_HEIGHT).toBe(103)
    expect(notePresentedSize()).toEqual({
      width: 332,
      height: 103
    })
    expect(notePresentedSize(124)).toEqual({
      width: 332,
      height: 155
    })
  })

  it("centers placement on the pointer", () => {
    expect(notePlacementOrigin(200, 100)).toEqual({ x: 34, y: 48.5 })
  })

  it("measures textarea content without shrinking below three rows", () => {
    const editor = { scrollHeight: 40, style: { height: "72px" } }
    expect(measureNoteTextareaHeight(editor)).toBe(72)
    expect(editor.style.height).toBe("72px")

    const taller = { scrollHeight: 124, style: { height: "72px" } }
    expect(measureNoteTextareaHeight(taller)).toBe(124)
    expect(taller.style.height).toBe("72px")
  })
})
